import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatPrice } from "@/src/store/cart";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

const STEPS = [
  { key: "En préparation", label: "En préparation", icon: "restaurant-outline", iconDone: "restaurant" },
  { key: "En livraison", label: "En livraison", icon: "bicycle-outline", iconDone: "bicycle" },
  { key: "Livré", label: "Livré", icon: "home-outline", iconDone: "home" },
] as const;

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const o = await api.getOrder(id);
      setOrder(o);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Commande introuvable.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 15s while not delivered so the timeline advances
  useEffect(() => {
    if (!order || order.status === "Livré") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(load, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [order, load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} testID="order-detail-loading">
        <ActivityIndicator size="large" color={colors.brand} />
      </SafeAreaView>
    );
  }

  if (error || !order) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error || "Commande introuvable."}</Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => router.back()}
          testID="order-detail-back"
        >
          <Text style={styles.retryText}>Retour</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const activeIndex = STEPS.findIndex((s) => s.key === order.status);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="order-detail-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
          testID="order-detail-back-btn"
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Détail commande</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Order summary header */}
        <View style={styles.headerCard}>
          <Text style={styles.orderNumber} testID="order-detail-id">
            Commande #{order.id.slice(0, 8).toUpperCase()}
          </Text>
          <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: order.status === "Livré" ? colors.success : colors.brand },
              ]}
            />
            <Text style={styles.statusText} testID="order-detail-status">
              {order.status}
            </Text>
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suivi de la commande</Text>
          <View style={styles.timeline}>
            {STEPS.map((step, i) => {
              const done = i <= activeIndex;
              const current = i === activeIndex && order.status !== "Livré";
              const isLast = i === STEPS.length - 1;
              return (
                <View key={step.key} style={styles.stepRow} testID={`timeline-step-${i}`}>
                  <View style={styles.stepIconCol}>
                    <View
                      style={[
                        styles.stepCircle,
                        done && styles.stepCircleDone,
                        current && styles.stepCirclePulse,
                      ]}
                    >
                      <Ionicons
                        name={done ? (step.iconDone as any) : (step.icon as any)}
                        size={20}
                        color={done ? "#fff" : colors.muted}
                      />
                    </View>
                    {!isLast && (
                      <View
                        style={[
                          styles.stepLine,
                          done && i < activeIndex && styles.stepLineDone,
                        ]}
                      />
                    )}
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>
                      {step.label}
                    </Text>
                    <Text style={styles.stepSub}>
                      {i === 0 && "Nous préparons votre commande."}
                      {i === 1 && "Notre livreur est en route."}
                      {i === 2 && "Bon appétit !"}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Delivery info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Livraison</Text>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={18} color={colors.muted} />
            <Text style={styles.infoText}>{order.customer_name}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={18} color={colors.muted} />
            <Text style={styles.infoText}>{order.phone}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={18} color={colors.muted} />
            <Text style={[styles.infoText, { flex: 1 }]}>{order.address}</Text>
          </View>
          {order.notes ? (
            <View style={styles.infoRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.muted} />
              <Text style={[styles.infoText, { flex: 1 }]}>{order.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Articles ({order.items.length})</Text>
          {order.items.map((it) => (
            <View key={it.product_id} style={styles.itemRow} testID={`order-item-${it.product_id}`}>
              <Image source={{ uri: it.image }} style={styles.itemImg} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {it.name}
                </Text>
                <Text style={styles.itemQty}>
                  {it.quantity} × {formatPrice(it.price)}
                </Text>
              </View>
              <Text style={styles.itemTotal}>{formatPrice(it.price * it.quantity)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.section}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Sous-total</Text>
            <Text style={styles.sumValue}>{formatPrice(order.subtotal)}</Text>
          </View>
          {order.points_used > 0 && (
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Fidélité utilisée</Text>
              <Text style={[styles.sumValue, { color: colors.brand }]}>
                − {formatPrice(order.points_used)}
              </Text>
            </View>
          )}
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Livraison</Text>
            <Text style={styles.sumValue}>
              {order.delivery_fee === 0 ? "Offerte" : formatPrice(order.delivery_fee)}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.sumRow}>
            <Text style={styles.totalLabel}>Total payé</Text>
            <Text style={styles.totalValue}>{formatPrice(order.total)}</Text>
          </View>
          {order.points_earned > 0 && (
            <View style={styles.earnRow}>
              <Ionicons name="gift" size={16} color={colors.brand} />
              <Text style={styles.earnText}>
                + {formatPrice(order.points_earned)} de fidélité crédités
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
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
  headerCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  orderNumber: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  orderDate: { fontSize: font.sm, color: colors.muted },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    marginTop: spacing.xs,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: font.sm },
  section: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  sectionTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  timeline: { gap: 0 },
  stepRow: { flexDirection: "row", gap: spacing.md },
  stepIconCol: { alignItems: "center", width: 40 },
  stepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.border,
  },
  stepCircleDone: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  stepCirclePulse: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  stepLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    minHeight: 36,
    marginVertical: 4,
  },
  stepLineDone: { backgroundColor: colors.brand },
  stepBody: { flex: 1, paddingTop: 6, paddingBottom: spacing.lg },
  stepLabel: { fontSize: font.base, fontWeight: "600", color: colors.muted },
  stepLabelDone: { color: colors.onSurface, fontWeight: "700" },
  stepSub: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoText: { color: colors.onSurface, fontSize: font.base },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemImg: { width: 48, height: 48, borderRadius: radius.md },
  itemName: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  itemQty: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  itemTotal: { color: colors.onSurface, fontWeight: "700", fontSize: font.base },
  sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sumLabel: { color: colors.muted, fontSize: font.base },
  sumValue: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  divider: { height: 1, backgroundColor: colors.divider },
  totalLabel: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  totalValue: { color: colors.brand, fontSize: font.xl, fontWeight: "800" },
  earnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  earnText: { color: colors.onBrandTertiary, fontSize: font.sm, fontWeight: "600", flex: 1 },
  errorText: { color: colors.error, fontSize: font.base },
  retryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  retryText: { color: "#fff", fontWeight: "700" },
});
