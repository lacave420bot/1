import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useUser } from "@/src/store/user";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

type DeliveryMode = "delivery" | "pickup";

type AddressSuggestion = {
  label: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
};

type GeocodingFeature = {
  properties: {
    label?: string;
    housenumber?: string;
    street?: string;
    name?: string;
    postcode?: string;
    city?: string;
  };
};

type GeocodingResponse = {
  features?: GeocodingFeature[];
};

function variantSectionLabel(stockUnit?: string | null): string {
  switch (stockUnit) {
    case "unité":
      return "Choisir la quantité";
    case "ml":
    case "L":
      return "Choisir le volume";
    default:
      return "Choisir le poids";
  }
}

function getEstimatedWindow(mode: DeliveryMode): string {
  if (mode === "pickup") return "Retrait estimé sous 20 à 35 min.";
  return "Prise en charge estimée sous 35 à 55 min.";
}

export default function CheckoutScreen() {
  const router = useRouter();
  const {
    items, subtotal, discount, total, guestId, clear,
    promoCode, promoError, promoValidating, applyPromo, clearPromo,
  } = useCart();
  const { user } = useUser();

  const [mode, setMode] = useState<DeliveryMode>("delivery");
  const [deliveryDisabledToday, setDeliveryDisabledToday] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [address, setAddress] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notes, setNotes] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{
    id: string;
    total: number;
    delivery_mode: DeliveryMode;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch shop hours once to detect "delivery disabled today" and auto-switch to pickup.
  useEffect(() => {
    let alive = true;
    api.getShopHours()
      .then((res) => {
        if (!alive) return;
        const disabled = !!res.delivery_disabled_today;
        setDeliveryDisabledToday(disabled);
        if (disabled) setMode("pickup");
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Address autocomplete via French government API
  const searchAddress = useCallback((query: string) => {
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (query.trim().length < 3) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    addressDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query.trim())}&limit=5`
        );
        const data: GeocodingResponse = await res.json();
        const suggestions: AddressSuggestion[] = (data.features || []).map((f) => ({
          label: f.properties?.label || "",
          housenumber: f.properties?.housenumber || "",
          street: f.properties?.street || f.properties?.name || "",
          postcode: f.properties?.postcode || "",
          city: f.properties?.city || "",
        }));
        setAddressSuggestions(suggestions);
        setShowSuggestions(suggestions.length > 0);
      } catch {
        setAddressSuggestions([]);
        setShowSuggestions(false);
      }
    }, 350);
  }, []);

  const handleAddressChange = useCallback((text: string) => {
    setAddress(text);
    searchAddress(text);
  }, [searchAddress]);

  const selectAddress = useCallback((suggestion: AddressSuggestion) => {
    setAddress(suggestion.label);
    setShowSuggestions(false);
    setAddressSuggestions([]);
  }, []);

  const canSubmit =
    name.trim().length > 0 &&
    items.length > 0 &&
    (mode === "pickup" || address.trim().length > 0);

  const submitPromo = async () => {
    if (!promoInput.trim()) return;
    const ok = await applyPromo(promoInput);
    if (ok) setPromoInput("");
  };

  const submit = async () => {
    if (!canSubmit) {
      setError(
        mode === "delivery"
          ? "Veuillez remplir le nom et l'adresse."
          : "Veuillez remplir votre nom."
      );
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const order = await api.createOrder({
        guest_id: guestId,
        customer_name: name.trim(),
        address: mode === "delivery" ? address.trim() : "",
        phone: phone.trim(),
        notes: notes.trim(),
        delivery_mode: mode,
        promo_code: promoCode || null,
        items: items.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          variant_label: l.variantLabel,
        })),
      });
      setSuccess({
        id: order.id,
        total: order.total,
        delivery_mode: (order.delivery_mode || mode) as DeliveryMode,
      });
      clear();
    } catch (e: any) {
      setError(e?.message || "Erreur lors de la validation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    const isPickup = success.delivery_mode === "pickup";
    return (
      <SafeAreaView style={styles.successWrap} testID="checkout-success">
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={64} color="#fff" />
        </View>
        <Text style={styles.successTitle}>Commande confirmée !</Text>
        <Text style={styles.successDesc}>
          Votre commande #{success.id.slice(0, 8).toUpperCase()} est en préparation.
        </Text>
        <View style={styles.successModePill}>
          <Ionicons
            name={isPickup ? "storefront" : "bicycle"}
            size={16}
            color={colors.onSurface}
          />
          <Text style={styles.successModeText}>
            {isPickup ? "Retrait sur place" : "Livraison à domicile"}
          </Text>
        </View>
        <Text style={styles.successTotal}>Total : {formatPrice(success.total)}</Text>
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
          {/* Delivery mode selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mode de récupération</Text>
            {deliveryDisabledToday && (
              <View style={styles.deliveryUnavailableBanner}>
                <Ionicons name="alert-circle" size={18} color="#FB923C" />
                <Text style={styles.deliveryUnavailableText}>
                  La livraison est indisponible aujourd&apos;hui — commandes uniquement en retrait sur place.
                </Text>
              </View>
            )}
            <View style={styles.modeRow}>
              <Pressable
                style={[
                  styles.modeBtn,
                  mode === "delivery" && styles.modeBtnActive,
                  deliveryDisabledToday && styles.modeBtnDisabled,
                ]}
                onPress={() => !deliveryDisabledToday && setMode("delivery")}
                disabled={deliveryDisabledToday}
                testID="checkout-mode-delivery"
              >
                <Ionicons
                  name="bicycle"
                  size={22}
                  color={
                    deliveryDisabledToday
                      ? colors.muted
                      : mode === "delivery"
                      ? "#fff"
                      : colors.muted
                  }
                />
                <Text style={[styles.modeLabel, mode === "delivery" && styles.modeLabelActive]}>
                  Livraison
                </Text>
                <Text style={[styles.modeSub, mode === "delivery" && styles.modeSubActive]}>
                  {deliveryDisabledToday ? "Indisponible" : "À domicile"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === "pickup" && styles.modeBtnActive]}
                onPress={() => setMode("pickup")}
                testID="checkout-mode-pickup"
              >
                <Ionicons
                  name="storefront"
                  size={22}
                  color={mode === "pickup" ? "#fff" : colors.muted}
                />
                <Text style={[styles.modeLabel, mode === "pickup" && styles.modeLabelActive]}>
                  Sur place 🦁
                </Text>
                <Text style={[styles.modeSub, mode === "pickup" && styles.modeSubActive]}>
                  Click &amp; Collect
                </Text>
              </Pressable>
            </View>
            {mode === "pickup" && (
              <View style={styles.pickupNote}>
                <Ionicons name="information-circle" size={18} color={colors.brand} />
                <Text style={styles.pickupNoteText}>
                  Vous serez contacté dès que votre commande sera prête à être retirée à la boutique.
                </Text>
              </View>
            )}
          </View>

          {/* Customer information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vos informations</Text>
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
              <Text style={styles.label}>
                Téléphone {mode === "pickup" ? "(recommandé)" : "(facultatif)"}
              </Text>
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
            {mode === "delivery" && (
              <View style={styles.field}>
                <Text style={styles.label}>Adresse de livraison</Text>
                <View>
                  <TextInput
                    value={address}
                    onChangeText={handleAddressChange}
                    placeholder="Tapez votre adresse…"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    testID="checkout-address"
                    onBlur={() => {
                      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                      blurTimeoutRef.current = setTimeout(() => setShowSuggestions(false), 200);
                    }}
                    onFocus={() => {
                      if (addressSuggestions.length > 0) setShowSuggestions(true);
                    }}
                  />
                  {showSuggestions && addressSuggestions.length > 0 && (
                    <View style={styles.suggestionsContainer}>
                      {addressSuggestions.map((s, i) => (
                        <Pressable
                          key={`${s.label}-${i}`}
                          style={({ pressed }) => [
                            styles.suggestionItem,
                            pressed && styles.suggestionItemPressed,
                            i < addressSuggestions.length - 1 && styles.suggestionDivider,
                          ]}
                          onPress={() => selectAddress(s)}
                          testID={`address-suggestion-${i}`}
                        >
                          <Ionicons name="location-outline" size={16} color={colors.brand} style={{ marginTop: 2 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.suggestionText} numberOfLines={1}>
                              {s.housenumber ? `${s.housenumber} ${s.street}` : s.street}
                            </Text>
                            <Text style={styles.suggestionSubtext} numberOfLines={1}>
                              {s.postcode} {s.city}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}
            <View style={styles.field}>
              <Text style={styles.label}>Notes (facultatif)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={
                  mode === "delivery"
                    ? "Code interphone, étage…"
                    : "Préférence de retrait, remarque…"
                }
                placeholderTextColor={colors.muted}
                style={styles.input}
                testID="checkout-notes"
              />
            </View>
          </View>

          {/* Promo code */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Code promo</Text>
            {promoCode ? (
              <View style={styles.promoApplied} testID="checkout-promo-applied">
                <View style={styles.promoLeft}>
                  <View style={styles.promoIconWrap}>
                    <Ionicons name="pricetag" size={16} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.promoCode}>{promoCode}</Text>
                    <Text style={styles.promoDiscount}>
                      − {formatPrice(discount)} appliqués
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={clearPromo}
                  hitSlop={8}
                  style={styles.promoRemoveBtn}
                  testID="checkout-promo-remove"
                >
                  <Ionicons name="close" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.promoRow}>
                <TextInput
                  value={promoInput}
                  onChangeText={(t) => setPromoInput(t.toUpperCase())}
                  placeholder="SAISIR LE CODE"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[styles.input, { flex: 1 }]}
                  onSubmitEditing={submitPromo}
                  testID="checkout-promo-input"
                />
                <Pressable
                  style={[
                    styles.promoApplyBtn,
                    (!promoInput.trim() || promoValidating) && styles.promoApplyBtnDisabled,
                  ]}
                  disabled={!promoInput.trim() || promoValidating}
                  onPress={submitPromo}
                  testID="checkout-promo-apply"
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
              <Text style={styles.promoError} testID="checkout-promo-error">
                {promoError}
              </Text>
            )}
          </View>

          {/* Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Résumé</Text>
            {items.map((l) => (
              <View key={`${l.product.id}-${l.variantLabel}`} style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {l.quantity}× {l.product.name} ({l.variantLabel})
                </Text>
                <Text style={styles.itemPrice}>
                  {formatPrice(l.unitPrice * l.quantity)}
                </Text>
              </View>
            ))}
            <View style={styles.divider} />
            {discount > 0 && (
              <>
                <View style={styles.itemRow}>
                  <Text style={styles.itemLabel}>Sous-total</Text>
                  <Text style={styles.itemPrice} testID="checkout-subtotal">
                    {formatPrice(subtotal)}
                  </Text>
                </View>
                <View style={styles.itemRow}>
                  <Text style={styles.itemLabel}>
                    Réduction {promoCode ? `(${promoCode})` : ""}
                  </Text>
                  <Text style={[styles.itemPrice, { color: colors.success }]} testID="checkout-discount">
                    − {formatPrice(discount)}
                  </Text>
                </View>
                <View style={styles.divider} />
              </>
            )}
            <View style={styles.itemRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue} testID="checkout-total">
                {formatPrice(total)}
              </Text>
            </View>
            <View style={styles.paymentNote}>
              <Ionicons
                name={mode === "pickup" ? "wallet-outline" : "cash-outline"}
                size={18}
                color={colors.onSurfaceTertiary}
              />
              <Text style={styles.paymentNoteText}>
                {mode === "pickup"
                  ? "Paiement sur place au moment du retrait"
                  : "Paiement à la livraison"}
              </Text>
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
              <Text style={styles.ctaText}>
                {mode === "pickup" ? "Réserver" : "Commander"} · {formatPrice(total)}
              </Text>
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
  modeRow: { flexDirection: "row", gap: spacing.md },
  modeBtn: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    gap: 4,
    borderWidth: 2,
    borderColor: "transparent",
  },
  modeBtnActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  modeBtnDisabled: { opacity: 0.4 },
  deliveryUnavailableBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(251,146,60,0.12)",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(251,146,60,0.3)",
    marginBottom: spacing.sm,
  },
  deliveryUnavailableText: {
    color: "#FDBA74",
    fontSize: font.sm,
    fontWeight: "600",
    flex: 1,
  },
  modeLabel: { color: colors.onSurface, fontWeight: "700", fontSize: font.base, marginTop: 2 },
  modeLabelActive: { color: "#fff" },
  modeSub: { color: colors.muted, fontSize: font.sm },
  modeSubActive: { color: "rgba(255,255,255,0.85)" },
  pickupNote: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.brandSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: "flex-start",
  },
  pickupNoteText: { color: colors.onBrandSecondary, fontSize: font.sm, flex: 1, lineHeight: 18 },
  promoRow: { flexDirection: "row", gap: spacing.sm },
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
  promoCode: { color: colors.onSurface, fontWeight: "800", fontSize: font.base, letterSpacing: 0.5 },
  promoDiscount: { color: "#4ADE80", fontSize: font.sm, fontWeight: "600", marginTop: 2 },
  promoRemoveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  promoError: { color: colors.error, fontSize: font.sm, fontWeight: "500" },
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
  paymentNoteText: { color: colors.onSurfaceTertiary, fontSize: font.sm, fontWeight: "500", flex: 1 },
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
  successModePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  successModeText: { color: colors.onSurface, fontWeight: "700", fontSize: font.base },
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
  suggestionsContainer: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  suggestionItemPressed: {
    backgroundColor: colors.brandSecondary,
  },
  suggestionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  suggestionText: {
    color: colors.onSurface,
    fontSize: font.base,
    fontWeight: "600" as const,
  },
  suggestionSubtext: {
    color: colors.muted,
    fontSize: font.sm,
    marginTop: 1,
  },
});
