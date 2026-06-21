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
        <Text style={styles.headerTitle}>Mes commandes</Text>
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
            <View key={o.id} style={styles.card} testID={`order-card-${o.id}`}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardOrderId}>
                    Commande #{o.id.slice(0, 8).toUpperCase()}
                  </Text>
                  <Text style={styles.cardDate}>{formatDate(o.created_at)}</Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>{o.status}</Text>
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
                <Text style={styles.cardItemsCount}>
                  {o.items.reduce((a, b) => a + b.quantity, 0)} articles
                </Text>
                <Text style={styles.cardTotal}>{formatPrice(o.total)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerTitle: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
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
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardOrderId: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  cardDate: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  statusBadge: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: font.sm },
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
});
