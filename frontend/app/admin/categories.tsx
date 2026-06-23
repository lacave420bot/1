import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type Category } from "@/src/api";
import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

type Draft = { id: string; name: string; icon: string; image: string; isNew?: boolean };
const EMPTY: Draft = { id: "", name: "", icon: "leaf", image: "" };

export default function AdminCategoriesScreen() {
  const router = useRouter();
  const { isAuthenticated, ready: adminReady } = useAdmin();
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setLoading(true); setItems(await api.getCategories()); }
    catch (e: any) { setErr(e?.message); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { if (isAuthenticated) load(); }, [load, isAuthenticated]));

  useEffect(() => {
    if (adminReady && !isAuthenticated) router.replace("/admin/login");
  }, [adminReady, isAuthenticated, router]);

  if (!adminReady || !isAuthenticated) return null;

  const openCreate = () => { setDraft({ ...EMPTY, isNew: true }); setErr(null); setModalOpen(true); };
  const openEdit = (c: Category) => {
    setDraft({ id: c.id, name: c.name, icon: c.icon, image: c.image });
    setErr(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!draft.id.trim() || !draft.name.trim()) {
      setErr("Identifiant et nom obligatoires.");
      return;
    }
    if (draft.isNew && !/^[a-z0-9_-]+$/.test(draft.id)) {
      setErr("L'identifiant doit être en minuscules sans espace (ex: fleurs-cbd).");
      return;
    }
    try {
      setSaving(true);
      setErr(null);
      const body = {
        id: draft.id,
        name: draft.name.trim(),
        icon: draft.icon.trim() || "leaf",
        image: draft.image.trim() || "https://images.unsplash.com/photo-1603909223429-69bb7101f420",
        kind: "cbd",
      };
      if (draft.isNew) await api.adminCreateCategory(body as Category);
      else await api.adminUpdateCategory(draft.id, body);
      setModalOpen(false);
      load();
    } catch (e: any) {
      setErr(e?.message || "Erreur");
    } finally { setSaving(false); }
  };

  const doDelete = (c: Category) => {
    const confirm = async () => {
      try { await api.adminDeleteCategory(c.id); load(); }
      catch (e: any) { Alert.alert("Impossible", e?.message || "Suppression échouée"); }
    };
    if (Platform.OS === "web") {
      if (window.confirm(`Supprimer la catégorie "${c.name}" ?`)) confirm();
    } else {
      Alert.alert("Supprimer ?", `Supprimer "${c.name}" ?`, [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: confirm },
      ]);
    }
  };

  // Move a category up (-1) or down (+1) in the list and persist via PUT /admin/categories/reorder.
  const move = async (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    // Optimistic UI update
    setItems(next);
    try {
      await api.adminReorderCategories(next.map((c) => c.id));
    } catch (e: any) {
      // Rollback on failure
      setItems(items);
      Alert.alert("Erreur", e?.message || "Impossible de réordonner");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-categories-screen">
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Catégories</Text>
        <Pressable style={styles.addHeaderBtn} onPress={openCreate} testID="admin-categories-add">
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {items.map((c, idx) => (
            <View key={c.id} style={styles.row} testID={`admin-cat-${c.id}`}>
              <View style={styles.reorderCol}>
                <Pressable
                  onPress={() => move(idx, -1)}
                  disabled={idx === 0}
                  hitSlop={6}
                  style={[styles.reorderBtn, idx === 0 && styles.reorderBtnDisabled]}
                  testID={`admin-cat-up-${c.id}`}
                >
                  <Ionicons name="chevron-up" size={16} color={idx === 0 ? colors.muted : colors.onSurface} />
                </Pressable>
                <Pressable
                  onPress={() => move(idx, 1)}
                  disabled={idx === items.length - 1}
                  hitSlop={6}
                  style={[styles.reorderBtn, idx === items.length - 1 && styles.reorderBtnDisabled]}
                  testID={`admin-cat-down-${c.id}`}
                >
                  <Ionicons name="chevron-down" size={16} color={idx === items.length - 1 ? colors.muted : colors.onSurface} />
                </Pressable>
              </View>
              <View style={styles.catIcon}>
                <Ionicons name={c.icon as any} size={20} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{c.name}</Text>
                <Text style={styles.rowSub}>icône {c.icon}</Text>
              </View>
              <Pressable onPress={() => openEdit(c)} style={styles.iconBtn} testID={`admin-cat-edit-${c.id}`} hitSlop={6}>
                <Ionicons name="create-outline" size={18} color={colors.brand} />
              </Pressable>
              <Pressable onPress={() => doDelete(c)} style={styles.iconBtn} testID={`admin-cat-delete-${c.id}`} hitSlop={6}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{draft.isNew ? "Nouvelle catégorie" : "Modifier"}</Text>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
              <View style={{ gap: 4 }}>
                <Text style={styles.label}>Identifiant {draft.isNew ? "(unique, sans espace)" : "(non modifiable)"}</Text>
                <TextInput
                  value={draft.id}
                  onChangeText={(t) => setDraft({ ...draft, id: t.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                  style={[styles.input, !draft.isNew && { opacity: 0.6 }]}
                  editable={!!draft.isNew}
                  autoCapitalize="none"
                  testID="cat-draft-id"
                />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={styles.label}>Nom affiché *</Text>
                <TextInput value={draft.name} onChangeText={(t) => setDraft({ ...draft, name: t })} style={styles.input} testID="cat-draft-name" />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={styles.label}>Icône (Ionicons : leaf, water, cube, cafe, sparkles, paw, construct, cloud, basket, pricetag…)</Text>
                <TextInput value={draft.icon} onChangeText={(t) => setDraft({ ...draft, icon: t })} style={styles.input} autoCapitalize="none" testID="cat-draft-icon" />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={styles.label}>URL Image</Text>
                <TextInput value={draft.image} onChangeText={(t) => setDraft({ ...draft, image: t })} style={styles.input} placeholder="https://..." placeholderTextColor={colors.muted} autoCapitalize="none" testID="cat-draft-image" />
              </View>
              {err && <Text style={styles.err}>{err}</Text>}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Pressable style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={save} disabled={saving} testID="cat-draft-save">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{draft.isNew ? "Créer" : "Enregistrer"}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", ...shadows.card },
  addHeaderBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  reorderCol: { gap: 4, alignItems: "center", justifyContent: "center" },
  reorderBtn: {
    width: 28,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderBtnDisabled: { opacity: 0.3 },
  catIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "90%", borderTopWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  label: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  err: { color: colors.error, fontSize: font.sm, fontWeight: "600" },
  modalFooter: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.muted, fontWeight: "600" },
  saveBtn: { flex: 2, height: 48, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: font.base },
});
