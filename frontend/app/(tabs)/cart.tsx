import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCart, formatPrice } from "@/src/store/cart";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function CartScreen() {
  const router = useRouter();
  const { items, setQuantity, removeItem, subtotal, deliveryFee, total } = useCart();

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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="cart-screen">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Panier</Text>
        <Text style={styles.headerSubtitle}>
          {items.length} {items.length > 1 ? "articles" : "article"}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 220 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Free-delivery progress banner */}
        {(() => {
          const target = 30;
          const remaining = Math.max(0, target - subtotal);
          const pct = Math.min(1, subtotal / target);
          const reached = remaining === 0;
          return (
            <View
              style={[styles.progressBanner, reached && styles.progressBannerDone]}
              testID="cart-free-delivery-banner"
            >
              <View style={styles.progressHeader}>
                <Ionicons
                  name={reached ? "checkmark-circle" : "bicycle"}
                  size={20}
                  color={reached ? colors.success : colors.brand}
                />
                <Text style={styles.progressText}>
                  {reached
                    ? "Bravo ! Livraison gratuite débloquée"
                    : `Plus que ${formatPrice(remaining)} pour la livraison gratuite`}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${pct * 100}%`, backgroundColor: reached ? colors.success : colors.brand },
                  ]}
                />
              </View>
            </View>
          );
        })()}

        {items.map(({ product, quantity }) => (
          <View key={product.id} style={styles.row} testID={`cart-item-${product.id}`}>
            <Image source={{ uri: product.image }} style={styles.rowImg} contentFit="cover" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {product.name}
              </Text>
              {product.unit && <Text style={styles.rowUnit}>{product.unit}</Text>}
              <Text style={styles.rowPrice}>{formatPrice(product.price)}</Text>
            </View>
            <View style={styles.stepperCol}>
              <Pressable
                onPress={() => removeItem(product.id)}
                hitSlop={8}
                testID={`cart-remove-${product.id}`}
              >
                <Ionicons name="trash-outline" size={18} color={colors.muted} />
              </Pressable>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => setQuantity(product.id, quantity - 1)}
                  hitSlop={6}
                  testID={`cart-dec-${product.id}`}
                >
                  <Ionicons name="remove" size={16} color={colors.onSurface} />
                </Pressable>
                <Text style={styles.stepperQty} testID={`cart-qty-${product.id}`}>
                  {quantity}
                </Text>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => setQuantity(product.id, quantity + 1)}
                  hitSlop={6}
                  testID={`cart-inc-${product.id}`}
                >
                  <Ionicons name="add" size={16} color={colors.onSurface} />
                </Pressable>
              </View>
            </View>
          </View>
        ))}

        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Sous-total</Text>
            <Text style={styles.summaryValue} testID="cart-subtotal">
              {formatPrice(subtotal)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Livraison</Text>
            <Text style={styles.summaryValue} testID="cart-delivery">
              {deliveryFee === 0 ? "Offerte" : formatPrice(deliveryFee)}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue} testID="cart-total">
              {formatPrice(total)}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.ctaBar}>
        <Pressable
          style={styles.ctaBtn}
          onPress={() => router.push("/checkout")}
          testID="cart-checkout-btn"
        >
          <Text style={styles.ctaText}>Passer la commande · {formatPrice(total)}</Text>
        </Pressable>
      </View>
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
  headerTitle: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  headerSubtitle: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  row: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    ...shadows.card,
  },
  rowImg: { width: 64, height: 64, borderRadius: radius.md },
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
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperQty: { minWidth: 22, textAlign: "center", fontWeight: "700", color: colors.onSurface },
  summary: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.md,
    ...shadows.card,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { color: colors.muted, fontSize: font.base },
  summaryValue: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  summaryHint: { color: colors.brand, fontSize: font.sm, fontStyle: "italic" },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  totalLabel: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  totalValue: { color: colors.brand, fontSize: font.xl, fontWeight: "800" },
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
  },
  ctaBtn: {
    backgroundColor: colors.brand,
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#fff", fontSize: font.lg, fontWeight: "700" },
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
  progressBanner: {
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressBannerDone: {
    backgroundColor: "#0F2A20",
    borderColor: "#1A4D38",
  },
  progressHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progressText: { color: colors.onSurface, fontSize: font.base, fontWeight: "700", flex: 1 },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: radius.pill },
});
