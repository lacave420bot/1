import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type PromoCode } from "@/src/api";
import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

type DraftKind = "percent" | "amount";

type Draft = {
  id?: string;
  code: string;
  kind: DraftKind;
  value: string;            // percent (1-100) or € amount
  min_subtotal: string;     // applies only when > 0
  max_uses: string;         // empty = unlimited
  expires_at: string;       // YYYY-MM-DD or empty
  enabled: boolean;
};

const EMPTY: Draft = {
  code: "",
  kind: "percent",
  value: "",
  min_subtotal: "",
  max_uses: "",
  expires_at: "",
  enabled: true,
};

function confirmAction(title: string, message: string, onConfirm: () => void, confirmLabel = "Supprimer") {
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Annuler", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "Pas d'expiration";
  try {
    const d = new Date(iso);
    return `Expire le ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}`;
  } catch {
    return iso;
  }
}

export default function AdminPromoCodesScreen() {
  const router = useRouter();
  const { isAuthenticated, ready: adminReady } = useAdmin();

  const [list, setList] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      const data = await api.adminListPromos();
      setList(data);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (adminReady && !isAuthenticated) router.replace("/admin/login");
  }, [adminReady, isAuthenticated, router]);

  const sorted = useMemo(
    () => [...list].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.code.localeCompare(b.code)),
    [list],
  );

  if (!adminReady) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      </SafeAreaView>
    );
  }
  if (!isAuthenticated) return null;

  const openCreate = () => {
    setDraft({ ...EMPTY, enabled: true });
    setErr(null);
    setModalOpen(true);
  };

  const openEdit = (p: PromoCode) => {
    setDraft({
      id: p.id,
      code: p.code,
      kind: (p.kind === "percent" ? "percent" : "amount"),
      value: String(p.value).replace(".", ","),
      min_subtotal: p.min_subtotal > 0 ? String(p.min_subtotal).replace(".", ",") : "",
      max_uses: p.max_uses == null ? "" : String(p.max_uses),
      expires_at: (p.expires_at || "").slice(0, 10),
      enabled: p.enabled,
    });
    setErr(null);
    setModalOpen(true);
  };

  const save = async () => {
    const code = draft.code.trim().toUpperCase();
    if (!code) { setErr("Code requis."); return; }
    const value = parseFloat(draft.value.replace(",", "."));
    if (isNaN(value) || value <= 0) { setErr("Valeur invalide."); return; }
    if (draft.kind === "percent" && value > 100) { setErr("Pourcentage entre 1 et 100."); return; }
    const min = draft.min_subtotal.trim() ? parseFloat(draft.min_subtotal.replace(",", ".")) : 0;
    const max_uses = draft.max_uses.trim() ? Math.max(1, parseInt(draft.max_uses, 10)) : null;
    let expires_at: string | null = null;
    if (draft.expires_at.trim()) {
      const m = draft.expires_at.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) { setErr("Date d'expiration : format AAAA-MM-JJ"); return; }
      expires_at = `${draft.expires_at}T23:59:00+00:00`;
    }
    try {
      setSaving(true); setErr(null);
      const body = {
        code,
        kind: draft.kind,
        value,
        min_subtotal: isNaN(min) ? 0 : min,
        max_uses,
        expires_at,
        enabled: draft.enabled,
      };
      if (draft.id) {
        await api.adminUpdatePromo(draft.id, body);
      } else {
        await api.adminCreatePromo(body);
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (p: PromoCode) => {
    confirmAction(
      `Supprimer ${p.code} ?`,
      "Cette action est définitive. Les commandes existantes ne seront pas affectées.",
      async () => {
        try {
          await api.adminDeletePromo(p.id);
          await load();
        } catch (e: any) {
          Alert.alert("Erreur", e?.message || "Suppression échouée");
        }
      },
    );
  };

  const toggleEnabled = async (p: PromoCode) => {
    try {
      await api.adminUpdatePromo(p.id, { enabled: !p.enabled });
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Mise à jour échouée");
    }
  };

  const renderValue = (p: PromoCode): string => {
    if (p.kind === "percent") return `−${p.value}%`;
    return `−${p.value.toFixed(2).replace(".", ",")} €`;
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-promos-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin"))}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Codes Promo</Text>
        <Pressable style={styles.addBtn} onPress={openCreate} hitSlop={8} testID="promo-add">
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : sorted.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="pricetag-outline" size={48} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>Aucun code promo</Text>
          <Text style={styles.emptySub}>Créez votre premier code pour offrir des réductions à vos clients.</Text>
          <Pressable style={styles.emptyCta} onPress={openCreate} testID="promo-add-empty">
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.emptyCtaText}>Nouveau code</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
          {sorted.map((p) => (
            <Pressable
              key={p.id}
              style={[styles.card, !p.enabled && { opacity: 0.55 }]}
              onPress={() => openEdit(p)}
              testID={`promo-card-${p.code}`}
            >
              <View style={styles.cardRow}>
                <View style={styles.valuePill}>
                  <Text style={styles.valuePillText}>{renderValue(p)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardCode}>{p.code}</Text>
                  <Text style={styles.cardSub}>
                    {p.min_subtotal > 0 ? `Min. ${p.min_subtotal.toFixed(2).replace(".", ",")} €` : "Sans minimum"}
                    {" · "}
                    {p.max_uses ? `${p.times_used}/${p.max_uses} utilisations` : `${p.times_used} utilisations`}
                  </Text>
                  <Text style={styles.cardMeta}>{formatExpiry(p.expires_at)}</Text>
                </View>
                <Switch
                  value={p.enabled}
                  onValueChange={() => toggleEnabled(p)}
                  trackColor={{ true: colors.brand, false: colors.surfaceTertiary }}
                  thumbColor="#fff"
                  testID={`promo-toggle-${p.code}`}
                />
              </View>
              <View style={styles.cardActions}>
                <Pressable
                  style={styles.smallBtnNeutral}
                  onPress={() => openEdit(p)}
                  hitSlop={6}
                  testID={`promo-edit-${p.code}`}
                >
                  <Ionicons name="create-outline" size={14} color={colors.onSurface} />
                  <Text style={styles.smallBtnText}>Modifier</Text>
                </Pressable>
                <Pressable
                  style={styles.smallBtnDanger}
                  onPress={() => remove(p)}
                  hitSlop={6}
                  testID={`promo-delete-${p.code}`}
                >
                  <Ionicons name="trash-outline" size={14} color="#FCA5A5" />
                  <Text style={[styles.smallBtnText, { color: "#FCA5A5" }]}>Supprimer</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Editor modal */}
      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{draft.id ? "Modifier le code" : "Nouveau code"}</Text>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={8} testID="promo-close">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={{ maxHeight: "85%" }}
            >
              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}>
                <Field label="Code">
                  <TextInput
                    value={draft.code}
                    onChangeText={(t) => setDraft({ ...draft, code: t.toUpperCase() })}
                    placeholder="WELCOME10"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.input}
                    testID="promo-code-input"
                  />
                </Field>

                <Field label="Type">
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Pressable
                      style={[styles.kindBtn, draft.kind === "percent" && styles.kindBtnActive]}
                      onPress={() => setDraft({ ...draft, kind: "percent" })}
                      testID="promo-kind-percent"
                    >
                      <Ionicons name="trending-down" size={16} color={draft.kind === "percent" ? "#fff" : colors.muted} />
                      <Text style={[styles.kindText, draft.kind === "percent" && { color: "#fff" }]}>
                        Pourcentage
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.kindBtn, draft.kind === "amount" && styles.kindBtnActive]}
                      onPress={() => setDraft({ ...draft, kind: "amount" })}
                      testID="promo-kind-amount"
                    >
                      <Ionicons name="cash" size={16} color={draft.kind === "amount" ? "#fff" : colors.muted} />
                      <Text style={[styles.kindText, draft.kind === "amount" && { color: "#fff" }]}>
                        Montant fixe
                      </Text>
                    </Pressable>
                  </View>
                </Field>

                <Field label={draft.kind === "percent" ? "Pourcentage (1-100)" : "Montant en €"}>
                  <TextInput
                    value={draft.value}
                    onChangeText={(t) => setDraft({ ...draft, value: t })}
                    placeholder={draft.kind === "percent" ? "10" : "5"}
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    testID="promo-value-input"
                  />
                </Field>

                <Field label="Panier minimum en € (facultatif)">
                  <TextInput
                    value={draft.min_subtotal}
                    onChangeText={(t) => setDraft({ ...draft, min_subtotal: t })}
                    placeholder="30"
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    testID="promo-min-input"
                  />
                </Field>

                <Field label="Nombre max d'utilisations (vide = illimité)">
                  <TextInput
                    value={draft.max_uses}
                    onChangeText={(t) => setDraft({ ...draft, max_uses: t.replace(/[^0-9]/g, "") })}
                    placeholder="100"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={styles.input}
                    testID="promo-max-uses-input"
                  />
                </Field>

                <Field label="Date d'expiration (AAAA-MM-JJ, facultatif)">
                  <TextInput
                    value={draft.expires_at}
                    onChangeText={(t) => setDraft({ ...draft, expires_at: t })}
                    placeholder="2026-12-31"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    style={styles.input}
                    testID="promo-expires-input"
                  />
                </Field>

                <View style={styles.switchRow}>
                  <Text style={styles.label}>Code actif</Text>
                  <Switch
                    value={draft.enabled}
                    onValueChange={(v) => setDraft({ ...draft, enabled: v })}
                    trackColor={{ true: colors.brand, false: colors.surfaceTertiary }}
                    thumbColor="#fff"
                    testID="promo-enabled-switch"
                  />
                </View>

                {!!err && <Text style={styles.error}>{err}</Text>}

                <Pressable
                  style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                  disabled={saving}
                  onPress={save}
                  testID="promo-save"
                >
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Ionicons name="save" size={18} color="#fff" />
                      <Text style={styles.saveText}>Enregistrer</Text>
                    </View>
                  )}
                </Pressable>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    ...shadows.card,
  },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
    ...shadows.card,
  },
  headerTitle: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.brandSecondary,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  emptySub: { color: colors.muted, fontSize: font.base, textAlign: "center", paddingHorizontal: spacing.lg },
  emptyCta: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: font.base },

  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  valuePill: {
    backgroundColor: "#2A1F0E",
    borderColor: "#FBBF24",
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    minWidth: 76,
    alignItems: "center",
  },
  valuePillText: { color: "#FBBF24", fontWeight: "800", fontSize: font.base },
  cardCode: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800", letterSpacing: 0.5 },
  cardSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  cardMeta: { color: colors.muted, fontSize: font.sm, marginTop: 2, fontStyle: "italic" },
  cardActions: { flexDirection: "row", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  smallBtnNeutral: {
    flex: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
  },
  smallBtnDanger: {
    flex: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: spacing.sm,
    backgroundColor: "#1F0A0A",
    borderWidth: 1,
    borderColor: "#7F1D1D",
    borderRadius: radius.md,
  },
  smallBtnText: { color: colors.onSurface, fontWeight: "700", fontSize: font.sm },

  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "92%", borderTopWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },

  label: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: font.base,
    color: colors.onSurface,
  },
  kindBtn: {
    flex: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  kindBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  kindText: { color: colors.muted, fontWeight: "700", fontSize: font.base },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  error: { color: colors.error, fontSize: font.base, fontWeight: "600" },
  saveBtn: {
    backgroundColor: colors.brand,
    height: 50,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  saveText: { color: "#fff", fontWeight: "800", fontSize: font.base },
});
