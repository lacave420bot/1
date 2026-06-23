import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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

import { api, type DayHours, type ShopHoursResponse, type WeeklyHours } from "@/src/api";
import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

const DAYS: { key: keyof WeeklyHours; label: string }[] = [
  { key: "monday", label: "Lundi" },
  { key: "tuesday", label: "Mardi" },
  { key: "wednesday", label: "Mercredi" },
  { key: "thursday", label: "Jeudi" },
  { key: "friday", label: "Vendredi" },
  { key: "saturday", label: "Samedi" },
  { key: "sunday", label: "Dimanche" },
];

function maskHHMM(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValidHHMM(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export default function ShopHoursScreen() {
  const router = useRouter();
  const { isAuthenticated, ready: adminReady } = useAdmin();
  const [data, setData] = useState<ShopHoursResponse | null>(null);
  const [hours, setHours] = useState<WeeklyHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingToday, setTogglingToday] = useState(false);

  // New closure form
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [addingClosure, setAddingClosure] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getShopHours();
      setData(res);
      setHours(res.hours);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  useFocusEffect(useCallback(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]));

  if (!adminReady) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      </SafeAreaView>
    );
  }
  if (!isAuthenticated) {
    router.replace("/admin/login");
    return null;
  }

  const updateDay = (key: keyof WeeklyHours, partial: Partial<DayHours>) => {
    if (!hours) return;
    setHours({ ...hours, [key]: { ...hours[key], ...partial } });
  };

  const toggleDayOpen = (key: keyof WeeklyHours) => {
    if (!hours) return;
    const current = hours[key];
    if (current.open && current.close) {
      // Switch to closed
      updateDay(key, { open: null, close: null });
    } else {
      updateDay(key, { open: "10:00", close: "19:00" });
    }
  };

  const save = async () => {
    if (!hours) return;
    // Client-side validation
    for (const d of DAYS) {
      const h = hours[d.key];
      const hasOpen = !!h.open;
      const hasClose = !!h.close;
      if (hasOpen !== hasClose) {
        Alert.alert("Erreur", `${d.label} : indiquez ouverture et fermeture, ou laissez vide.`);
        return;
      }
      if (hasOpen && !isValidHHMM(h.open)) {
        Alert.alert("Erreur", `${d.label} : heure d'ouverture invalide (HH:MM).`);
        return;
      }
      if (hasClose && !isValidHHMM(h.close)) {
        Alert.alert("Erreur", `${d.label} : heure de fermeture invalide (HH:MM).`);
        return;
      }
      if (hasOpen && hasClose && h.open === h.close) {
        Alert.alert("Erreur", `${d.label} : fermeture doit être différente de l'ouverture.`);
        return;
      }
      // Note: close < open (overnight) is allowed
    }
    try {
      setSaving(true);
      await api.adminUpdateShopHours(hours);
      Alert.alert("Enregistré", "Horaires mis à jour avec succès.");
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Sauvegarde impossible");
    } finally {
      setSaving(false);
    }
  };

  const toggleClosedToday = async (closed: boolean) => {
    try {
      setTogglingToday(true);
      await api.adminSetClosedToday(closed);
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Action impossible");
    } finally {
      setTogglingToday(false);
    }
  };

  const addClosure = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      Alert.alert("Erreur", "Format de date attendu : AAAA-MM-JJ (par ex. 2026-08-01).");
      return;
    }
    if (end < start) {
      Alert.alert("Erreur", "La date de fin doit être après la date de début.");
      return;
    }
    try {
      setAddingClosure(true);
      await api.adminAddShopClosure(start, end, reason);
      setStart("");
      setEnd("");
      setReason("");
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Ajout impossible");
    } finally {
      setAddingClosure(false);
    }
  };

  const deleteClosure = async (id: string) => {
    const doDelete = async () => {
      try {
        await api.adminDeleteShopClosure(id);
        await load();
      } catch (e: any) {
        Alert.alert("Erreur", e?.message || "Suppression impossible");
      }
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm("Supprimer cette plage de fermeture ?")) {
        doDelete();
      }
    } else {
      Alert.alert("Confirmer", "Supprimer cette plage de fermeture ?", [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-shop-hours-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Horaires de la boutique</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {loading && !data ? (
            <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
          ) : (
            <>
              {/* Current status */}
              {data?.status && (
                <View style={[styles.statusCard, data.status.is_open ? styles.statusCardOpen : styles.statusCardClosed]}>
                  <Ionicons
                    name={data.status.is_open ? "checkmark-circle" : "close-circle"}
                    size={26}
                    color={data.status.is_open ? "#4ADE80" : "#FCA5A5"}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statusTitle}>
                      {data.status.is_open ? "🟢 Boutique ouverte" : "🔴 Boutique fermée"}
                    </Text>
                    <Text style={styles.statusSubtitle}>{data.status.reason}</Text>
                  </View>
                </View>
              )}

              {/* Closed today toggle */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionTitle}>Fermé exceptionnellement aujourd&apos;hui</Text>
                    <Text style={styles.sectionHint}>
                      Active ce bouton pour fermer la boutique pour le reste de la journée.
                    </Text>
                  </View>
                  {togglingToday ? (
                    <ActivityIndicator color={colors.brand} />
                  ) : (
                    <Switch
                      value={!!data?.closed_today}
                      onValueChange={toggleClosedToday}
                      trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
                      testID="closed-today-switch"
                    />
                  )}
                </View>
              </View>

              {/* Weekly hours */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Horaires hebdomadaires</Text>
                <Text style={styles.sectionHint}>Désactive un jour pour le marquer fermé.</Text>
                {DAYS.map(({ key, label }) => {
                  const d = hours?.[key];
                  const isOpen = !!d?.open && !!d?.close;
                  const isOvernight = isOpen && d && d.open && d.close && d.open > d.close;
                  return (
                    <View key={key} style={styles.dayRow}>
                      <View style={styles.dayHeader}>
                        <Text style={styles.dayLabel}>{label}</Text>
                        <Switch
                          value={isOpen}
                          onValueChange={() => toggleDayOpen(key)}
                          trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
                          testID={`day-toggle-${key}`}
                        />
                      </View>
                      {isOpen ? (
                        <View style={styles.dayInputsWrap}>
                          <View style={styles.dayInputs}>
                            <TextInput
                              value={d?.open || ""}
                              onChangeText={(t) => updateDay(key, { open: maskHHMM(t) })}
                              placeholder="10:00"
                              placeholderTextColor={colors.muted}
                              style={styles.timeInput}
                              keyboardType="number-pad"
                              maxLength={5}
                              testID={`day-open-${key}`}
                            />
                            <Text style={styles.timeSeparator}>→</Text>
                            <TextInput
                              value={d?.close || ""}
                              onChangeText={(t) => updateDay(key, { close: maskHHMM(t) })}
                              placeholder="19:00"
                              placeholderTextColor={colors.muted}
                              style={styles.timeInput}
                              keyboardType="number-pad"
                              maxLength={5}
                              testID={`day-close-${key}`}
                            />
                          </View>
                          {isOvernight && (
                            <Text style={styles.overnightHint}>
                              🌙 Ferme le lendemain à {d?.close}
                            </Text>
                          )}
                        </View>
                      ) : (
                        <Text style={styles.closedText}>Fermé</Text>
                      )}
                    </View>
                  );
                })}
                <Pressable
                  onPress={save}
                  disabled={saving}
                  style={[styles.saveBtn, saving && styles.btnDisabled]}
                  testID="save-hours-btn"
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Enregistrer les horaires</Text>
                  )}
                </Pressable>
              </View>

              {/* Closures */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Plages d&apos;indisponibilité</Text>
                <Text style={styles.sectionHint}>Programme à l&apos;avance vos jours/périodes de fermeture (vacances, jours fériés…).</Text>

                {(data?.closures || []).length === 0 && (
                  <Text style={styles.emptyClosures}>Aucune fermeture programmée.</Text>
                )}
                {(data?.closures || []).map((c) => (
                  <View key={c.id} style={styles.closureRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.closureDates}>
                        {c.start_date === c.end_date
                          ? `Le ${c.start_date}`
                          : `Du ${c.start_date} au ${c.end_date}`}
                      </Text>
                      {!!c.reason && <Text style={styles.closureReason}>{c.reason}</Text>}
                    </View>
                    <Pressable
                      onPress={() => deleteClosure(c.id)}
                      hitSlop={8}
                      style={styles.closureDelBtn}
                      testID={`closure-delete-${c.id}`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                    </Pressable>
                  </View>
                ))}

                {/* Add closure form */}
                <View style={styles.addClosureBox}>
                  <Text style={styles.addClosureTitle}>Ajouter une fermeture</Text>
                  <View style={styles.row}>
                    <TextInput
                      value={start}
                      onChangeText={setStart}
                      placeholder="Début · AAAA-MM-JJ"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, { flex: 1 }]}
                      autoCorrect={false}
                      autoCapitalize="none"
                      testID="closure-start"
                    />
                    <TextInput
                      value={end}
                      onChangeText={setEnd}
                      placeholder="Fin · AAAA-MM-JJ"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, { flex: 1 }]}
                      autoCorrect={false}
                      autoCapitalize="none"
                      testID="closure-end"
                    />
                  </View>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Raison (optionnel) — ex : Vacances d'été"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    testID="closure-reason"
                  />
                  <Pressable
                    onPress={addClosure}
                    disabled={addingClosure}
                    style={[styles.addClosureBtn, addingClosure && styles.btnDisabled]}
                    testID="closure-add-btn"
                  >
                    {addingClosure ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="add-circle-outline" size={18} color="#fff" />
                        <Text style={styles.addClosureBtnText}>Ajouter</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  statusCardOpen: { backgroundColor: "#0F2A20", borderColor: "#1A4D38" },
  statusCardClosed: { backgroundColor: "#2A1414", borderColor: "#5C1F1F" },
  statusTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  statusSubtitle: { color: colors.muted, fontSize: font.sm, marginTop: 2 },

  section: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  sectionHint: { color: colors.muted, fontSize: font.sm },

  dayRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayLabel: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  dayInputsWrap: { gap: 4 },
  dayInputs: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  timeInput: {
    backgroundColor: colors.surfaceTertiary,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    minWidth: 90,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    fontSize: font.base,
    fontWeight: "600",
  },
  timeSeparator: { color: colors.muted, fontSize: font.base, fontWeight: "700" },
  overnightHint: { color: "#A78BFA", fontSize: font.xs, fontWeight: "600", marginTop: 2 },
  closedText: { color: colors.muted, fontStyle: "italic" },

  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: font.base },
  btnDisabled: { opacity: 0.6 },

  emptyClosures: { color: colors.muted, fontStyle: "italic", paddingVertical: spacing.sm },
  closureRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  closureDates: { color: colors.onSurface, fontWeight: "700", fontSize: font.base },
  closureReason: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  closureDelBtn: {
    width: 32, height: 32, borderRadius: radius.pill,
    backgroundColor: "rgba(239,68,68,0.08)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(239,68,68,0.18)",
  },

  addClosureBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  addClosureTitle: { color: colors.onSurface, fontWeight: "700", fontSize: font.base },
  row: { flexDirection: "row", gap: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  addClosureBtn: {
    flexDirection: "row",
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addClosureBtnText: { color: "#fff", fontWeight: "700" },
});
