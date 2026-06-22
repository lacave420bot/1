import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type Order } from "@/src/api";
import { useCart, formatPrice } from "@/src/store/cart";
import { useUser } from "@/src/store/user";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function OrdersScreen() {
  const router = useRouter();
  const { guestId, ready } = useCart();
  const { isAuthenticated, user } = useUser();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready || !guestId) return;
    try {
      setLoading(true);
      setError(null);
      const list = await api.getOrders(guestId);
      setOrders(list);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, [ready, guestId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="orders-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Mes commandes</Text>
          <Text style={styles.headerSub}>
            {isAuthenticated && user ? `Connecté · ${user.name || ""}` : "Historique de cet appareil"}
          </Text>
        </View>
        {!isAuthenticated && (
          <Pressable
            style={styles.loginBtn}
            onPress={() => router.push("/login")}
            testID="orders-login-shortcut"
            hitSlop={8}
          >
            <Ionicons name="paper-plane" size={14} color="#2AABEE" />
            <Text style={styles.loginBtnText}>Connexion</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.adminBtn}
          onPress={() => router.push("/admin/orders")}
          testID="orders-admin-shortcut"
          hitSlop={8}
        >
          <Ionicons name="shield-checkmark" size={16} color={colors.brand} />
          <Text style={styles.adminBtnText}>Gestion</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center} testID="orders-loading">
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={load} testID="orders-retry-btn">
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="receipt-outline" size={48} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>Aucune commande passée.</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => router.push("/(tabs)/catalog")}
            testID="orders-empty-discover"
          >
            <Text style={styles.retryText}>Découvrir le catalogue</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {orders.map((o) => (
            <Pressable
              key={o.id}
              style={styles.card}
              onPress={() => router.push(`/order/${o.id}`)}
              testID={`order-card-${o.id}`}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardOrderId}>
                    Commande #{o.id.slice(0, 8).toUpperCase()}
                  </Text>
                  <Text style={styles.cardDate}>{formatDate(o.created_at)}</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    o.status === "Terminée" && styles.statusBadgeDone,
                    o.status === "Annulée" && styles.statusBadgeCancelled,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      o.status === "Terminée" && styles.statusTextDone,
                      o.status === "Annulée" && styles.statusTextCancelled,
                    ]}
                  >
                    {o.status}
                  </Text>
                </View>
              </View>

              <View style={styles.itemsRow}>
                {o.items.slice(0, 4).map((it) => (
                  <Image
                    key={it.product_id}
                    source={{ uri: it.image }}
                    style={styles.itemThumb}
                    contentFit="cover"
                  />
                ))}
                {o.items.length > 4 && (
                  <View style={styles.itemMore}>
                    <Text style={styles.itemMoreText}>+{o.items.length - 4}</Text>
                  </View>
                )}
              </View>

              <View style={styles.cardFooter}>
                <View style={styles.cardFooterLeft}>
                  <Text style={styles.cardItemsCount}>
                    {o.items.reduce((a, b) => a + b.quantity, 0)} articles
                  </Text>
                  <View style={[
                    styles.modeBadge,
                    o.delivery_mode === "pickup" ? styles.modeBadgePickup : styles.modeBadgeDelivery,
                  ]}>
                    <Ionicons
                      name={o.delivery_mode === "pickup" ? "storefront" : "bicycle"}
                      size={11}
                      color={colors.onSurface}
                    />
                    <Text style={styles.modeBadgeText}>
                      {o.delivery_mode === "pickup" ? "Sur place" : "Livraison"}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardFooterRight}>
                  <Text style={styles.cardTotal}>{formatPrice(o.total)}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerTitle: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  headerSub: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  adminBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  adminBtnText: { color: colors.brand, fontWeight: "700", fontSize: font.sm },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0E2733",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#2AABEE",
    marginRight: spacing.xs,
  },
  loginBtnText: { color: "#2AABEE", fontWeight: "700", fontSize: font.sm },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  errorText: { color: colors.error, fontSize: font.base },
  retryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  retryText: { color: "#fff", fontWeight: "700" },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  emptyTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  cardOrderId: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  cardDate: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  statusBadge: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusBadgeDone: { backgroundColor: "#0F2A20" },
  statusBadgeCancelled: { backgroundColor: "#3F1414" },
  statusText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: font.sm },
  statusTextDone: { color: "#4ADE80" },
  statusTextCancelled: { color: "#FCA5A5" },
  cardFooterLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  cardFooterRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemsRow: { flexDirection: "row", gap: spacing.sm },
  itemThumb: { width: 48, height: 48, borderRadius: radius.md },
  itemMore: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  itemMoreText: { color: colors.onSurface, fontWeight: "700" },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.md,
  },
  cardItemsCount: { color: colors.muted, fontSize: font.base },
  cardTotal: { color: colors.brand, fontSize: font.lg, fontWeight: "800" },
  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  modeBadgeDelivery: { backgroundColor: "#11233F", borderColor: "#1F3C66" },
  modeBadgePickup: { backgroundColor: "#0F2A20", borderColor: "#1A4D38" },
  modeBadgeText: { color: colors.onSurface, fontSize: font.xs, fontWeight: "700" },
});
