import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type Product } from "@/src/api";
import { useCart, formatPrice } from "@/src/store/cart";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addItem } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [variantIdx, setVariantIdx] = useState(0);

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        setLoading(true);
        setError(null);
        const p = await api.getProduct(id);
        setProduct(p);
      } catch (e: any) {
        setError(e?.message || "Produit introuvable.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} testID="product-loading">
        <ActivityIndicator size="large" color={colors.brand} />
      </SafeAreaView>
    );
  }

  if (error || !product) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error || "Produit introuvable."}</Text>
        <Pressable style={styles.retryBtn} onPress={() => router.back()} testID="product-back-btn">
          <Text style={styles.retryText}>Retour</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Parse grams from variant label ("1 g" → 1, "10 g" → 10), or use explicit `grams` field
  const variantGrams = (v: { label?: string; grams?: number | null } | null | undefined): number | null => {
    if (!v) return null;
    if (typeof v.grams === "number" && v.grams > 0) return v.grams;
    const m = (v.label || "").match(/([\d]+(?:[.,][\d]+)?)\s*g/i);
    if (!m) return null;
    const n = parseFloat(m[1].replace(",", "."));
    return isNaN(n) ? null : n;
  };

  // Determine if a variant is currently available (gram-stock priority, fallback to per-variant stock)
  const variantAvailableQty = (v: any): number | null => {
    if (!v) return 0;
    const total = (product as any)?.total_stock_grams;
    const grams = variantGrams(v);
    if (typeof total === "number" && grams && grams > 0) {
      return Math.floor((total + 1e-6) / grams);
    }
    if (v.stock == null) return null; // unlimited
    return Math.max(0, Number(v.stock) || 0);
  };

  const handleAdd = () => {
    const v = product.variants && product.variants.length > 0 ? product.variants[variantIdx] : null;
    if (!v) return;
    const avail = variantAvailableQty(v);
    if (avail !== null && avail < qty) return; // out of stock
    addItem(product, v.label, v.price, qty);
    router.back();
  };
  const currentVariant = product?.variants && product.variants.length > 0 ? product.variants[variantIdx] : null;
  const displayPrice = currentVariant ? currentVariant.price : product?.price ?? 0;

  // Stock status for the currently selected variant
  const currentAvail = variantAvailableQty(currentVariant);
  const totalG = (product as any)?.total_stock_grams as number | null | undefined;
  const lowThrG = ((product as any)?.low_stock_threshold_grams as number | null | undefined) ?? 5;
  const isOutOfStock = currentAvail !== null && currentAvail <= 0;
  const isLowStock =
    !isOutOfStock &&
    typeof totalG === "number" &&
    totalG > 0 &&
    totalG <= lowThrG;
  const maxQty = currentAvail === null ? 999 : Math.max(1, currentAvail);

  return (
    <View style={styles.root} testID="product-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Image source={{ uri: product.image }} style={styles.hero} contentFit="cover" />
          <LinearGradient
            colors={["rgba(0,0,0,0.5)", "transparent"]}
            style={styles.heroGradient}
          />
          <SafeAreaView style={styles.heroHeader} edges={["top"]}>
            <Pressable
              style={styles.backBtn}
              onPress={() => router.back()}
              testID="product-back-arrow"
            >
              <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            </Pressable>
          </SafeAreaView>
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{product.name}</Text>
              {product.unit && <Text style={styles.unit}>{product.unit}</Text>}
            </View>
            <Text style={styles.price}>{formatPrice(displayPrice)}</Text>
          </View>
          {product.promo && (
            <View style={styles.promoBadge}>
              <Text style={styles.promoBadgeText}>Offre spéciale</Text>
            </View>
          )}
          {isOutOfStock && (
            <View style={[styles.stockBadge, styles.stockBadgeOut]} testID="product-stock-out">
              <Ionicons name="close-circle" size={14} color="#FCA5A5" />
              <Text style={[styles.stockBadgeText, { color: "#FCA5A5" }]}>Rupture de stock</Text>
            </View>
          )}
          {isLowStock && !isOutOfStock && (
            <View style={[styles.stockBadge, styles.stockBadgeLow]} testID="product-stock-low">
              <Ionicons name="flash" size={14} color="#FBBF24" />
              <Text style={[styles.stockBadgeText, { color: "#FBBF24" }]}>Stock limité</Text>
            </View>
          )}
          {product.variants && product.variants.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>
                {(() => {
                  switch (product.stock_unit) {
                    case "unité": return "Choisir la quantité";
                    case "ml": case "L": return "Choisir le volume";
                    default: return "Choisir le poids";
                  }
                })()}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {product.variants.map((v, i) => {
                  const active = i === variantIdx;
                  const avail = variantAvailableQty(v);
                  const sold = avail !== null && avail <= 0;
                  return (
                    <Pressable
                      key={v.label}
                      onPress={() => { if (!sold) setVariantIdx(i); }}
                      disabled={sold}
                      testID={`product-variant-${v.label}`}
                      style={{
                        borderWidth: 1.5,
                        borderColor: sold ? "#7F1D1D" : (active ? colors.brand : colors.border),
                        backgroundColor: sold
                          ? "#1F0A0A"
                          : (active ? colors.brandSecondary : colors.surfaceSecondary),
                        borderRadius: 999,
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        alignItems: "center",
                        opacity: sold ? 0.6 : 1,
                      }}
                    >
                      <Text style={{
                        color: sold ? "#FCA5A5" : (active ? colors.brand : colors.onSurface),
                        fontWeight: "800",
                        fontSize: 14,
                        textDecorationLine: sold ? "line-through" : "none",
                      }}>{v.label}</Text>
                      <Text style={{
                        color: sold ? "#FCA5A5" : (active ? colors.brand : colors.muted),
                        fontSize: 12,
                        fontWeight: "600",
                        marginTop: 2,
                      }}>
                        {sold ? "Rupture" : formatPrice(v.price)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
          <Text style={styles.sectionLabel}>Description</Text>
          <Text style={styles.description}>{product.description}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.stepper}>
          <Pressable
            style={styles.stepperBtn}
            onPress={() => setQty((q) => Math.max(1, q - 1))}
            hitSlop={6}
            testID="product-dec"
          >
            <Ionicons name="remove" size={18} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.stepperQty} testID="product-qty">{qty}</Text>
          <Pressable
            style={[styles.stepperBtn, qty >= maxQty && { opacity: 0.4 }]}
            onPress={() => setQty((q) => Math.min(maxQty, q + 1))}
            hitSlop={6}
            disabled={qty >= maxQty}
            testID="product-inc"
          >
            <Ionicons name="add" size={18} color={colors.onSurface} />
          </Pressable>
        </View>
        <Pressable
          style={[styles.addBtn, (isOutOfStock || !!product?.coming_soon) && styles.addBtnDisabled]}
          onPress={handleAdd}
          disabled={isOutOfStock || !!product?.coming_soon}
          testID="product-add-btn"
        >
          <Ionicons
            name={product?.coming_soon ? "rocket" : isOutOfStock ? "ban" : "bag-add"}
            size={18}
            color="#fff"
          />
          <Text style={styles.addBtnText}>
            {product?.coming_soon
              ? "🚧 Bientôt disponible"
              : isOutOfStock
              ? "Rupture"
              : `Ajouter · ${formatPrice(displayPrice * qty)}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  heroWrap: { height: 340, position: "relative" },
  hero: { width: "100%", height: "100%" },
  heroGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 120 },
  heroHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(15,15,15,0.7)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  body: { padding: spacing.lg, gap: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  unit: { fontSize: font.base, color: colors.muted, marginTop: 2 },
  price: { fontSize: font.xxl, fontWeight: "800", color: colors.brand },
  promoBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  promoBadgeText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: font.sm },
  sectionLabel: {
    fontSize: font.base,
    fontWeight: "700",
    color: colors.onSurface,
    marginTop: spacing.md,
  },
  description: { fontSize: font.base, color: colors.onSurfaceTertiary, lineHeight: 22 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    height: 52,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperQty: { minWidth: 28, textAlign: "center", fontWeight: "700", color: colors.onSurface },
  addBtn: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.floating,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: font.lg },
  addBtnDisabled: { backgroundColor: "#7F1D1D", opacity: 0.85 },
  stockBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  stockBadgeOut: { backgroundColor: "#3F1414", borderColor: "#7F1D1D" },
  stockBadgeLow: { backgroundColor: "#2A1F0E", borderColor: "#8B6914" },
  stockBadgeText: { fontSize: font.sm, fontWeight: "700" },
  errorText: { color: colors.error, fontSize: font.base },
  retryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  retryText: { color: "#fff", fontWeight: "700" },
});
