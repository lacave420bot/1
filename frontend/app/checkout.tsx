import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
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

import { api } from "@/src/api";
import { useCart, formatPrice } from "@/src/store/cart";
import { useLoyalty } from "@/src/store/loyalty";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function CheckoutScreen() {
  const router = useRouter();
  const { items, subtotal, guestId, clear } = useCart();
  const { loyalty, refresh: refreshLoyalty } = useLoyalty(guestId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [usePoints, setUsePoints] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{
    id: string;
    total: number;
    points_earned: number;
    points_used: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availablePoints = loyalty?.points_balance ?? 0;
  const pointsApplied = usePoints ? Math.min(availablePoints, subtotal) : 0;
  const discountedSubtotal = Math.max(0, subtotal - pointsApplied);
  const total = Math.round(discountedSubtotal * 100) / 100;
  const pointsToEarn = Math.floor(discountedSubtotal / 10);

  const canSubmit = name.trim() && address.trim() && items.length > 0;

  const submit = async () => {
    if (!canSubmit) {
      setError("Veuillez remplir tous les champs requis.");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const order = await api.createOrder({
        guest_id: guestId,
        customer_name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        use_points: pointsApplied,
        items: items.map((l) => ({ product_id: l.product.id, quantity: l.quantity, variant_label: l.variantLabel })),
      });
      setSuccess({
        id: order.id,
        total: order.total,
        points_earned: order.points_earned,
        points_used: order.points_used,
      });
      clear();
      refreshLoyalty();
    } catch (e: any) {
      setError(e?.message || "Erreur lors de la validation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={styles.successWrap} testID="checkout-success">
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={64} color="#fff" />
        </View>
        <Text style={styles.successTitle}>Commande confirmée !</Text>
        <Text style={styles.successDesc}>
          Votre commande #{success.id.slice(0, 8).toUpperCase()} est en préparation.
        </Text>
        <Text style={styles.successTotal}>Total : {formatPrice(success.total)}</Text>
        {success.points_earned > 0 && (
          <View style={styles.successLoyalty} testID="checkout-success-loyalty">
            <Ionicons name="gift" size={18} color={colors.brand} />
            <Text style={styles.successLoyaltyText}>
              Vous gagnez {formatPrice(success.points_earned)} en fidélité
            </Text>
          </View>
        )}
        <Pressable
          style={styles.successBtn}
          onPress={() => router.replace(`/order/${success.id}`)}
          testID="checkout-view-orders"
        >
          <Text style={styles.successBtnText}>Suivre ma commande</Text>
        </Pressable>
        <Pressable onPress={() => router.replace("/(tabs)/home")} testID="checkout-continue">
          <Text style={styles.linkText}>Continuer les achats</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} testID="checkout-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
          testID="checkout-back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Validation</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 200 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Informations</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Nom complet</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Jean Dupont"
                placeholderTextColor={colors.muted}
                style={styles.input}
                testID="checkout-name"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Téléphone (facultatif)</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="06 12 34 56 78"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                style={styles.input}
                testID="checkout-phone"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Adresse de livraison</Text>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="12 rue de la Paix, 75002 Paris"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.multiline]}
                multiline
                numberOfLines={3}
                testID="checkout-address"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Notes (facultatif)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Code interphone, étage…"
                placeholderTextColor={colors.muted}
                style={styles.input}
                testID="checkout-notes"
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Résumé</Text>
            {items.map((l) => (
              <View key={l.product.id} style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {l.quantity}× {l.product.name} ({l.variantLabel})
                </Text>
                <Text style={styles.itemPrice}>
                  {formatPrice(l.unitPrice * l.quantity)}
                </Text>
              </View>
            ))}
            <View style={styles.divider} />
            <View style={styles.itemRow}>
              <Text style={styles.itemLabel}>Sous-total</Text>
              <Text style={styles.itemPrice}>{formatPrice(subtotal)}</Text>
            </View>
            {availablePoints > 0 && (
              <Pressable
                style={[styles.pointsRow, usePoints && styles.pointsRowActive]}
                onPress={() => setUsePoints((v) => !v)}
                testID="checkout-use-points"
              >
                <View style={styles.pointsLeft}>
                  <View style={[styles.checkbox, usePoints && styles.checkboxActive]}>
                    {usePoints && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pointsTitle}>Utiliser ma fidélité</Text>
                    <Text style={styles.pointsSub}>
                      {formatPrice(availablePoints)} disponibles
                    </Text>
                  </View>
                </View>
                {pointsApplied > 0 && (
                  <Text style={styles.pointsDiscount}>− {formatPrice(pointsApplied)}</Text>
                )}
              </Pressable>
            )}
            <View style={styles.divider} />
            <View style={styles.itemRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatPrice(total)}</Text>
            </View>
            {pointsToEarn > 0 && (
              <View style={styles.earnRow}>
                <Ionicons name="gift-outline" size={16} color={colors.brand} />
                <Text style={styles.earnText}>
                  Vous gagnerez {formatPrice(pointsToEarn)} en fidélité
                </Text>
              </View>
            )}
            <View style={styles.paymentNote}>
              <Ionicons name="cash-outline" size={18} color={colors.onSurfaceTertiary} />
              <Text style={styles.paymentNoteText}>Paiement à la livraison</Text>
            </View>
          </View>

          {error && (
            <Text style={styles.errorInline} testID="checkout-error">
              {error}
            </Text>
          )}
        </ScrollView>

        <View style={styles.ctaBar}>
          <Pressable
            style={[styles.cta, (!canSubmit || submitting) && styles.ctaDisabled]}
            disabled={!canSubmit || submitting}
            onPress={submit}
            testID="checkout-confirm-btn"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>Confirmer la commande</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  section: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  sectionTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  field: { gap: spacing.xs },
  label: { fontSize: font.sm, color: colors.muted, fontWeight: "500" },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: font.base,
    color: colors.onSurface,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  itemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemName: { color: colors.onSurface, fontSize: font.base, flex: 1, marginRight: spacing.md },
  itemPrice: { color: colors.onSurface, fontWeight: "600", fontSize: font.base },
  itemLabel: { color: colors.muted, fontSize: font.base },
  divider: { height: 1, backgroundColor: colors.divider },
  totalLabel: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  totalValue: { color: colors.brand, fontSize: font.xl, fontWeight: "800" },
  paymentNote: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  paymentNoteText: { color: colors.onSurfaceTertiary, fontSize: font.sm, fontWeight: "500" },
  pointsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  pointsRowActive: { borderColor: colors.brand },
  pointsLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxActive: { backgroundColor: colors.brand },
  pointsTitle: { color: colors.onSurface, fontWeight: "700", fontSize: font.base },
  pointsSub: { color: colors.onSurfaceTertiary, fontSize: font.sm, marginTop: 2 },
  pointsDiscount: { color: colors.brand, fontWeight: "800", fontSize: font.base },
  earnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  earnText: { color: colors.onBrandTertiary, fontSize: font.sm, fontWeight: "600", flex: 1 },
  successLoyalty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  successLoyaltyText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: font.base },
  errorInline: { color: colors.error, fontSize: font.base, fontWeight: "600" },
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
    paddingBottom: spacing.xl,
  },
  cta: {
    backgroundColor: colors.brand,
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: font.lg },
  successWrap: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  successTitle: { fontSize: font.xxl, fontWeight: "800", color: colors.onSurface },
  successDesc: { color: colors.muted, fontSize: font.base, textAlign: "center" },
  successTotal: { color: colors.brand, fontSize: font.xl, fontWeight: "700", marginTop: spacing.sm },
  successBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  successBtnText: { color: "#fff", fontWeight: "700", fontSize: font.base },
  linkText: { color: colors.muted, fontSize: font.base, marginTop: spacing.sm, textDecorationLine: "underline" },
});
