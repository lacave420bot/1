import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type Product } from "@/src/api";
import { AnimatedPressable } from "@/src/components/AnimatedPressable";
import { useCart, formatPrice, lineKey } from "@/src/store/cart";
import { useUser } from "@/src/store/user";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

// Parse grams from variant label ("1 g" → 1, "10 g" → 10), or use explicit `grams` field
function parseGrams(label?: string | null, gramsField?: number | null): number | null {
  if (typeof gramsField === "number" && gramsField > 0) return gramsField;
  if (!label) return null;
  const m = label.match(/([\d]+(?:[.,][\d]+)?)\s*g/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return isNaN(n) ? null : n;
}

type LineStatus =
  | { type: "ok" }
  | { type: "out"; reason: "deleted" | "variant" | "stock" }
  | { type: "adjust"; max: number };

export default function CartScreen() {
  const router = useRouter();
  const { isAuthenticated } = useUser();
  const {
    items, setQuantity, removeItem, updateLine,
    subtotal, discount, total, count,
    promoCode, promoError, promoValidating, applyPromo, clearPromo,
  } = useCart();

  const [latestProducts, setLatestProducts] = useState<Record<string, Product | null>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [promoInput, setPromoInput] = useState("");

  const uniqueProductIds = useMemo(
    () => Array.from(new Set(items.map((l) => l.product.id))),
    [items],
  );

  const refresh = useCallback(async () => {
    if (uniqueProductIds.length === 0) {
      setLatestProducts({});
      return;
    }
    setRefreshing(true);
    try {
      const results = await Promise.allSettled(
        uniqueProductIds.map((id) => api.getProduct(id)),
      );
      const map: Record<string, Product | null> = {};
      uniqueProductIds.forEach((id, i) => {
        const r = results[i];
        map[id] = r.status === "fulfilled" ? r.value : null;
      });
      setLatestProducts(map);

      // Silent sync: update unitPrice / image / name on each line if changed
      items.forEach((line) => {
        const fresh = map[line.product.id];
        if (!fresh) return;
        const freshVariant = fresh.variants?.find((v) => v.label === line.variantLabel);
        const newPrice = freshVariant ? freshVariant.price : fresh.price;
        const imgChanged = fresh.image && fresh.image !== line.product.image;
        const nameChanged = fresh.name && fresh.name !== line.product.name;
        if (newPrice !== line.unitPrice || imgChanged || nameChanged) {
          const k = lineKey(line.product.id, line.variantLabel);
          updateLine(k, {
            product: { ...line.product, image: fresh.image, name: fresh.name },
            unitPrice: newPrice,
          });
        }
      });
    } finally {
      setRefreshing(false);
    }
  }, [uniqueProductIds, items, updateLine]);

  // Refresh on mount
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh whenever the cart tab regains focus
  useFocusEffect(
    useCallback(() => {
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uniqueProductIds.join("|")]),
  );

  // Compute per-line status (out of stock / quantity to adjust)
  const lineStatuses = useMemo(() => {
    const map = new Map<string, LineStatus>();
    for (const line of items) {
      const key = lineKey(line.product.id, line.variantLabel);
      const fresh = latestProducts[line.product.id];
      if (fresh === undefined) {
        // Still loading -> assume ok to avoid flicker
        map.set(key, { type: "ok" });
        continue;
      }
      if (fresh === null) {
        map.set(key, { type: "out", reason: "deleted" });
        continue;
      }
      const variant = fresh.variants?.find((v) => v.label === line.variantLabel);
      if (!variant && fresh.variants && fresh.variants.length > 0) {
        map.set(key, { type: "out", reason: "variant" });
        continue;
      }
      const grams = parseGrams(line.variantLabel, variant?.grams);
      const totalG = fresh.total_stock_grams;
      if (typeof totalG === "number" && grams && grams > 0) {
        const maxQty = Math.floor((totalG + 1e-6) / grams);
        if (maxQty <= 0) map.set(key, { type: "out", reason: "stock" });
        else if (line.quantity > maxQty) map.set(key, { type: "adjust", max: maxQty });
        else map.set(key, { type: "ok" });
        continue;
      }
      if (variant?.stock != null) {
        const maxQty = Math.max(0, Number(variant.stock) || 0);
        if (maxQty <= 0) map.set(key, { type: "out", reason: "stock" });
        else if (line.quantity > maxQty) map.set(key, { type: "adjust", max: maxQty });
        else map.set(key, { type: "ok" });
        continue;
      }
      map.set(key, { type: "ok" });
    }
    return map;
  }, [items, latestProducts]);

  const hasBlockingIssue = useMemo(() => {
    for (const s of lineStatuses.values()) if (s.type !== "ok") return true;
    return false;
  }, [lineStatuses]);

  const submitPromo = async () => {
    if (!promoInput.trim()) return;
    const ok = await applyPromo(promoInput);
    if (ok) setPromoInput("");
  };

  // ---------- Empty cart ----------
  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]} testID="cart-screen-empty">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Panier</Text>
        </View>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="bag-handle-outline" size={64} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>Votre panier est vide</Text>
          <Text style={styles.emptyDesc}>
            Découvrez nos produits frais et passez votre première commande.
          </Text>
          <Pressable
            style={styles.emptyBtn}
            onPress={() => router.push("/(tabs)/catalog")}
            testID="cart-empty-discover-btn"
          >
            <Text style={styles.emptyBtnText}>Découvrir nos produits</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Cart with items ----------
  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="cart-screen">
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Panier</Text>
          {refreshing && (
            <ActivityIndicator size="small" color={colors.muted} testID="cart-refreshing" />
          )}
        </View>
        <Text style={styles.headerSubtitle}>
          {count} {count > 1 ? "articles" : "article"}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 240 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {items.map((line) => {
            const { product, variantLabel, unitPrice, quantity } = line;
            const lk = lineKey(product.id, variantLabel);
            const status = lineStatuses.get(lk) || ({ type: "ok" } as LineStatus);
            const isOut = status.type === "out";
            const isAdjust = status.type === "adjust";
            const isWarn = isOut || isAdjust;

            return (
              <View
                key={lk}
                style={[styles.row, isOut && styles.rowOut, isAdjust && styles.rowAdjust]}
                testID={`cart-item-${lk}`}
              >
                <View style={styles.rowMain}>
                  <Image
                    source={{ uri: product.image }}
                    style={[styles.rowImg, isOut && styles.rowImgDim]}
                    contentFit="cover"
                  />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text style={styles.rowUnit}>{variantLabel}</Text>
                    <Text
                      style={[
                        styles.rowPrice,
                        isOut && { color: colors.muted, textDecorationLine: "line-through" },
                      ]}
                    >
                      {formatPrice(unitPrice)}
                    </Text>
                  </View>
                  <View style={styles.stepperCol}>
                    {!isOut && (
                      <View style={styles.stepper}>
                        <Pressable
                          style={styles.stepperBtn}
                          onPress={() => setQuantity(lk, quantity - 1)}
                          hitSlop={6}
                          testID={`cart-dec-${product.id}`}
                        >
                          <Ionicons name="remove" size={16} color={colors.onSurface} />
                        </Pressable>
                        <Text style={styles.stepperQty} testID={`cart-qty-${product.id}`}>
                          {quantity}
                        </Text>
                        <Pressable
                          style={[styles.stepperBtn, isAdjust && { opacity: 0.35 }]}
                          onPress={() => setQuantity(lk, quantity + 1)}
                          hitSlop={6}
                          disabled={isAdjust}
                          testID={`cart-inc-${product.id}`}
                        >
                          <Ionicons name="add" size={16} color={colors.onSurface} />
                        </Pressable>
                      </View>
                    )}
                    <Pressable
                      onPress={() => removeItem(lk)}
                      hitSlop={10}
                      style={({ pressed }) => [
                        styles.removeBtn,
                        pressed && styles.removeBtnPressed,
                      ]}
                      testID={`cart-remove-${product.id}`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                    </Pressable>
                  </View>
                </View>

                {isWarn && (
                  <View
                    style={[
                      styles.warnBox,
                      isOut ? styles.warnBoxOut : styles.warnBoxAdjust,
                    ]}
                  >
                    <Ionicons
                      name={isOut ? "alert-circle" : "flash"}
                      size={16}
                      color={isOut ? "#FCA5A5" : "#FBBF24"}
                    />
                    <Text
                      style={[
                        styles.warnText,
                        { color: isOut ? "#FCA5A5" : "#FBBF24" },
                      ]}
                    >
                      {isOut
                        ? status.reason === "deleted"
                          ? "Produit retiré du catalogue."
                          : status.reason === "variant"
                          ? "Cette quantité n'est plus proposée."
                          : "Rupture de stock."
                        : `Il ne reste que ${(status as { type: "adjust"; max: number }).max} dispo.`}
                    </Text>
                    <Pressable
                      style={[
                        styles.warnBtn,
                        isOut ? styles.warnBtnOut : styles.warnBtnAdjust,
                      ]}
                      onPress={() => {
                        if (isOut) removeItem(lk);
                        else
                          setQuantity(
                            lk,
                            (status as { type: "adjust"; max: number }).max,
                          );
                      }}
                      testID={
                        isOut ? `cart-remove-out-${product.id}` : `cart-adjust-${product.id}`
                      }
                    >
                      <Text style={styles.warnBtnText}>
                        {isOut ? "Retirer" : "Ajuster"}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}

          {/* Promo code */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="pricetag-outline" size={18} color={colors.onSurface} />
              <Text style={styles.sectionTitle}>Code promo</Text>
            </View>
            {promoCode ? (
              <View style={styles.promoApplied} testID="cart-promo-applied">
                <View style={styles.promoLeft}>
                  <View style={styles.promoIconWrap}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.promoCodeText}>{promoCode}</Text>
                    <Text style={styles.promoDiscountText}>
                      − {formatPrice(discount)} appliqués
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={clearPromo}
                  hitSlop={8}
                  style={styles.promoRemoveBtn}
                  testID="cart-promo-remove"
                >
                  <Ionicons name="close" size={16} color={colors.muted} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.promoRow}>
                <TextInput
                  value={promoInput}
                  onChangeText={(t) => setPromoInput(t.toUpperCase())}
                  placeholder="VOTRE CODE"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.promoInput}
                  onSubmitEditing={submitPromo}
                  returnKeyType="done"
                  testID="cart-promo-input"
                />
                <Pressable
                  style={[
                    styles.promoApplyBtn,
                    (!promoInput.trim() || promoValidating) && styles.promoApplyBtnDisabled,
                  ]}
                  disabled={!promoInput.trim() || promoValidating}
                  onPress={submitPromo}
                  testID="cart-promo-apply"
                >
                  {promoValidating ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.promoApplyText}>Appliquer</Text>
                  )}
                </Pressable>
              </View>
            )}
            {!!promoError && !promoCode && (
              <Text style={styles.promoErrorText} testID="cart-promo-error">
                {promoError}
              </Text>
            )}
          </View>

          {/* Login REQUIRED card */}
          {!isAuthenticated && (
            <Pressable
              style={styles.loginRequiredCard}
              onPress={() => router.push("/login")}
              testID="cart-login-required"
            >
              <View style={styles.loginRequiredIconWrap}>
                <Ionicons name="lock-closed" size={20} color="#2AABEE" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.loginRequiredTitle}>
                  🔐 Connexion requise
                </Text>
                <Text style={styles.loginRequiredText}>
                  Connectez-vous via Telegram pour pouvoir commander et recevoir le suivi de votre commande en direct.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#2AABEE" />
            </Pressable>
          )}

          {/* Summary */}
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Sous-total</Text>
              <Text style={styles.summaryValue} testID="cart-subtotal">
                {formatPrice(subtotal)}
              </Text>
            </View>
            {discount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Réduction {promoCode ? `(${promoCode})` : ""}
                </Text>
                <Text
                  style={[styles.summaryValue, { color: colors.success }]}
                  testID="cart-discount"
                >
                  − {formatPrice(discount)}
                </Text>
              </View>
            )}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue} testID="cart-total">
                {formatPrice(total)}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.ctaBar}>
          {hasBlockingIssue && (
            <View style={styles.ctaWarn} testID="cart-blocking-warn">
              <Ionicons name="alert-circle" size={14} color="#FCA5A5" />
              <Text style={styles.ctaWarnText}>
                Veuillez ajuster les articles signalés.
              </Text>
            </View>
          )}
          {!isAuthenticated ? (
            <AnimatedPressable
              style={[styles.ctaBtn, styles.ctaBtnLogin]}
              scale={0.97}
              haptic="medium"
              onPress={() => router.push("/login")}
              testID="cart-login-cta"
            >
              <View style={styles.ctaInner}>
                <Ionicons name="paper-plane" size={18} color="#fff" />
                <Text style={styles.ctaText}>Se connecter pour commander</Text>
              </View>
            </AnimatedPressable>
          ) : (
            <AnimatedPressable
              style={[styles.ctaBtn, hasBlockingIssue && styles.ctaBtnDisabled]}
              scale={0.97}
              haptic="medium"
              disabled={hasBlockingIssue}
              onPress={() => router.push("/checkout")}
              testID="cart-checkout-btn"
            >
              <Text style={styles.ctaText}>
                Passer la commande · {formatPrice(total)}
              </Text>
            </AnimatedPressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerTitle: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  headerSubtitle: { fontSize: font.sm, color: colors.muted, marginTop: 2 },

  // Line row
  row: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  rowOut: {
    borderWidth: 1,
    borderColor: "#7F1D1D",
    backgroundColor: "#1A0F0F",
  },
  rowAdjust: {
    borderWidth: 1,
    borderColor: "#8B6914",
  },
  rowMain: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
  },
  rowImg: { width: 64, height: 64, borderRadius: radius.md },
  rowImgDim: { opacity: 0.45 },
  rowInfo: { flex: 1, gap: 4 },
  rowTitle: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  rowUnit: { fontSize: font.sm, color: colors.muted },
  rowPrice: { fontSize: font.base, fontWeight: "700", color: colors.brand },
  stepperCol: { alignItems: "flex-end", gap: spacing.sm },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    height: 32,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperQty: {
    minWidth: 22,
    textAlign: "center",
    fontWeight: "700",
    color: colors.onSurface,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: "rgba(239,68,68,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.18)",
  },
  removeBtnPressed: { backgroundColor: "rgba(239,68,68,0.18)" },

  // Inline warn box (under a line)
  warnBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  warnBoxOut: { backgroundColor: "rgba(127,29,29,0.18)" },
  warnBoxAdjust: { backgroundColor: "rgba(139,105,20,0.16)" },
  warnText: { flex: 1, fontSize: font.sm, fontWeight: "600" },
  warnBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  warnBtnOut: { backgroundColor: "#7F1D1D" },
  warnBtnAdjust: { backgroundColor: "#8B6914" },
  warnBtnText: { color: "#fff", fontWeight: "700", fontSize: font.sm },

  // Section card (used for promo)
  section: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },

  // Login REQUIRED card (guest users must authenticate to checkout)
  loginRequiredCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "rgba(42,171,238,0.10)",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(42,171,238,0.35)",
    padding: spacing.md,
  },
  loginRequiredIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(42,171,238,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  loginRequiredTitle: { color: colors.onSurface, fontWeight: "700", fontSize: font.base },
  loginRequiredText: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },

  // Promo
  promoRow: { flexDirection: "row", gap: spacing.sm },
  promoInput: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: font.base,
    color: colors.onSurface,
    letterSpacing: 1,
  },
  promoApplyBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  promoApplyBtnDisabled: { opacity: 0.5 },
  promoApplyText: { color: "#fff", fontWeight: "700" },
  promoApplied: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0F2A20",
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#1A4D38",
  },
  promoLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  promoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1A4D38",
    alignItems: "center",
    justifyContent: "center",
  },
  promoCodeText: {
    color: colors.onSurface,
    fontWeight: "800",
    fontSize: font.base,
    letterSpacing: 0.5,
  },
  promoDiscountText: {
    color: "#4ADE80",
    fontSize: font.sm,
    fontWeight: "600",
    marginTop: 2,
  },
  promoRemoveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  promoErrorText: { color: colors.error, fontSize: font.sm, fontWeight: "500" },

  // Summary
  summary: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: { color: colors.muted, fontSize: font.base },
  summaryValue: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  summaryDivider: { height: 1, backgroundColor: colors.divider, marginVertical: 2 },
  totalLabel: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  totalValue: { color: colors.brand, fontSize: font.xl, fontWeight: "800" },

  // CTA bar
  ctaBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  ctaWarn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  ctaWarnText: { color: "#FCA5A5", fontSize: font.sm, fontWeight: "600" },
  ctaBtn: {
    backgroundColor: colors.brand,
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnDisabled: { backgroundColor: colors.surfaceTertiary, opacity: 0.85 },
  ctaBtnLogin: { backgroundColor: "#2AABEE" },
  ctaInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ctaText: { color: "#fff", fontSize: font.lg, fontWeight: "700" },

  // Empty
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyIconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  emptyDesc: { color: colors.muted, fontSize: font.base, textAlign: "center" },
  emptyBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: font.base },
});
