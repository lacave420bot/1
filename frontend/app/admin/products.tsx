import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
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

import { api, type Category, type Product } from "@/src/api";
import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

type Draft = {
  id?: string;
  name: string;
  description: string;
  price: string;
  image: string;
  category_id: string;
  unit: string;
  popular: boolean;
  promo: boolean;
  variants: { label: string; price: string }[];
};

const EMPTY: Draft = {
  name: "",
  description: "",
  price: "",
  image: "",
  category_id: "",
  unit: "",
  popular: false,
  promo: false,
  variants: [],
};

const DEFAULT_VARIANTS_PRESET = [
  { label: "1 g", price: "9" },
  { label: "5 g", price: "40" },
  { label: "10 g", price: "75" },
  { label: "25 g", price: "175" },
  { label: "50 g", price: "320" },
];

export default function AdminProductsScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAdmin();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [p, c] = await Promise.all([api.getProducts(), api.getCategories()]);
      setProducts(p);
      setCategories(c);
    } catch (e: any) {
      setErr(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!isAuthenticated) {
    router.replace("/admin/login");
    return null;
  }

  const openCreate = () => {
    setDraft({ ...EMPTY, category_id: categories[0]?.id || "", variants: [...DEFAULT_VARIANTS_PRESET] });
    setErr(null);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description,
      price: String(p.price),
      image: p.image,
      category_id: p.category_id,
      unit: p.unit || "",
      popular: !!p.popular,
      promo: !!p.promo,
      variants: (p.variants || []).map((v) => ({ label: v.label, price: String(v.price) })),
    });
    setErr(null);
    setModalOpen(true);
  };

  const openDuplicate = (p: Product) => {
    setDraft({
      // No id => create mode
      name: `${p.name} (copie)`,
      description: p.description,
      price: String(p.price),
      image: p.image,
      category_id: p.category_id,
      unit: p.unit || "",
      popular: !!p.popular,
      promo: !!p.promo,
      variants: (p.variants || []).map((v) => ({ label: v.label, price: String(v.price) })),
    });
    setErr(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.price.trim() || !draft.category_id) {
      setErr("Nom, prix et catégorie sont obligatoires.");
      return;
    }
    const priceNum = parseFloat(draft.price.replace(",", "."));
    if (isNaN(priceNum) || priceNum < 0) {
      setErr("Prix invalide.");
      return;
    }
    try {
      setSaving(true);
      setErr(null);
      const variants = draft.variants
        .filter((v) => v.label.trim() && v.price.trim())
        .map((v) => ({ label: v.label.trim(), price: parseFloat(v.price.replace(",", ".")) || 0 }));
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        price: priceNum,
        image: draft.image.trim() || "https://images.unsplash.com/photo-1603909223429-69bb7101f420",
        category_id: draft.category_id,
        unit: draft.unit.trim() || undefined,
        popular: draft.popular,
        promo: draft.promo,
        variants,
      };
      if (draft.id) {
        await api.adminUpdateProduct(draft.id, body);
      } else {
        await api.adminCreateProduct(body);
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      setErr(e?.message || "Erreur d'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = (p: Product) => {
    const confirm = async () => {
      try {
        await api.adminDeleteProduct(p.id);
        load();
      } catch (e: any) {
        Alert.alert("Erreur", e?.message || "Suppression échouée");
      }
    };
    if (Platform.OS === "web") {
      if (window.confirm(`Supprimer "${p.name}" ?`)) confirm();
    } else {
      Alert.alert("Supprimer ?", `Supprimer "${p.name}" ?`, [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: confirm },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-products-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Produits</Text>
        <Pressable style={styles.addHeaderBtn} onPress={openCreate} testID="admin-products-add">
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {products.map((p) => (
            <View key={p.id} style={styles.row} testID={`admin-product-${p.id}`}>
              <Image source={{ uri: p.image }} style={styles.thumb} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {p.price.toFixed(2).replace(".", ",")} € · {p.unit || "—"}
                </Text>
                <View style={styles.tagsRow}>
                  {p.popular && <View style={[styles.tag, { backgroundColor: "#11233F" }]}><Text style={[styles.tagText, { color: "#7AB1FF" }]}>Populaire</Text></View>}
                  {p.promo && <View style={[styles.tag, { backgroundColor: "#2A1A12" }]}><Text style={[styles.tagText, { color: "#FB923C" }]}>Promo</Text></View>}
                </View>
              </View>
              <Pressable
                onPress={() => openEdit(p)}
                style={styles.iconBtn}
                testID={`admin-product-edit-${p.id}`}
                hitSlop={6}
              >
                <Ionicons name="create-outline" size={18} color={colors.brand} />
              </Pressable>
              <Pressable
                onPress={() => openDuplicate(p)}
                style={styles.iconBtn}
                testID={`admin-product-duplicate-${p.id}`}
                hitSlop={6}
              >
                <Ionicons name="copy-outline" size={18} color="#B19CFF" />
              </Pressable>
              <Pressable
                onPress={() => doDelete(p)}
                style={styles.iconBtn}
                testID={`admin-product-delete-${p.id}`}
                hitSlop={6}
              >
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
              <Text style={styles.modalTitle}>
                {draft.id ? "Modifier le produit" : "Nouveau produit"}
              </Text>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
              <Field label="Nom *">
                <TextInput value={draft.name} onChangeText={(t) => setDraft({ ...draft, name: t })} style={styles.input} testID="draft-name" />
              </Field>
              <Field label="Description">
                <TextInput value={draft.description} onChangeText={(t) => setDraft({ ...draft, description: t })} style={[styles.input, { minHeight: 70 }]} multiline testID="draft-desc" />
              </Field>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}><Field label="Prix € *">
                  <TextInput value={draft.price} onChangeText={(t) => setDraft({ ...draft, price: t })} keyboardType="decimal-pad" style={styles.input} testID="draft-price" />
                </Field></View>
                <View style={{ flex: 1 }}><Field label="Unité (1 g, 10 ml...)">
                  <TextInput value={draft.unit} onChangeText={(t) => setDraft({ ...draft, unit: t })} style={styles.input} testID="draft-unit" />
                </Field></View>
              </View>
              <Field label="Catégorie *">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}>
                  {categories.map((c) => {
                    const active = draft.category_id === c.id;
                    return (
                      <Pressable key={c.id} style={[styles.chip, active && styles.chipActive]} onPress={() => setDraft({ ...draft, category_id: c.id })} testID={`draft-cat-${c.id}`}>
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Field>
              <Field label="URL Image">
                <TextInput value={draft.image} onChangeText={(t) => setDraft({ ...draft, image: t })} style={styles.input} placeholder="https://..." placeholderTextColor={colors.muted} testID="draft-image" autoCapitalize="none" />
              </Field>

              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[styles.label, { fontSize: font.base, fontWeight: "800", color: colors.onSurface }]}>
                    Tarifs par poids
                  </Text>
                  <Pressable onPress={() => setDraft({ ...draft, variants: [...DEFAULT_VARIANTS_PRESET] })} testID="draft-variants-preset">
                    <Text style={{ color: colors.brand, fontWeight: "700", fontSize: font.sm }}>Préréglage CBD</Text>
                  </Pressable>
                </View>
                {draft.variants.map((v, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                    <TextInput
                      value={v.label}
                      onChangeText={(t) => {
                        const next = [...draft.variants];
                        next[i] = { ...next[i], label: t };
                        setDraft({ ...draft, variants: next });
                      }}
                      placeholder="1 g"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, { flex: 1 }]}
                      testID={`draft-variant-label-${i}`}
                    />
                    <TextInput
                      value={v.price}
                      onChangeText={(t) => {
                        const next = [...draft.variants];
                        next[i] = { ...next[i], price: t };
                        setDraft({ ...draft, variants: next });
                      }}
                      placeholder="9.00"
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      style={[styles.input, { width: 90 }]}
                      testID={`draft-variant-price-${i}`}
                    />
                    <Pressable
                      onPress={() => setDraft({ ...draft, variants: draft.variants.filter((_, idx) => idx !== i) })}
                      style={styles.iconBtn}
                      testID={`draft-variant-del-${i}`}
                      hitSlop={6}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  onPress={() => setDraft({ ...draft, variants: [...draft.variants, { label: "", price: "" }] })}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm }}
                  testID="draft-variant-add"
                >
                  <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
                  <Text style={{ color: colors.brand, fontWeight: "700" }}>Ajouter un poids</Text>
                </Pressable>
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Populaire</Text>
                <Switch value={draft.popular} onValueChange={(v) => setDraft({ ...draft, popular: v })} testID="draft-popular" />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>En promotion</Text>
                <Switch value={draft.promo} onValueChange={(v) => setDraft({ ...draft, promo: v })} testID="draft-promo" />
              </View>
              {err && <Text style={styles.err}>{err}</Text>}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Pressable style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={save} disabled={saving} testID="draft-save">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{draft.id ? "Enregistrer" : "Créer"}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", ...shadows.card },
  addHeaderBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  rowTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  tagsRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  tagText: { fontSize: 10, fontWeight: "700" },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "92%", borderTopWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  label: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600" },
  chipTextActive: { color: "#fff", fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border },
  switchLabel: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  err: { color: colors.error, fontSize: font.sm, fontWeight: "600" },
  modalFooter: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.muted, fontWeight: "600" },
  saveBtn: { flex: 2, height: 48, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: font.base },
});
