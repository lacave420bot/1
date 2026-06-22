import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type Order } from "@/src/api";
import { formatPrice } from "@/src/store/cart";
import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

const STATUS_CHOICES = ["En cours", "Terminée", "Annulée"] as const;
const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "En cours", label: "En cours" },
  { id: "Terminée", label: "Terminées" },
  { id: "Annulée", label: "Annulées" },
];

function statusColor(s: string): { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (s) {
    case "Terminée":
      return { bg: "#0F2A20", fg: "#4ADE80", icon: "checkmark-circle" };
    case "Annulée":
      return { bg: "#3F1414", fg: "#FCA5A5", icon: "close-circle" };
    default:
      return { bg: "#11233F", fg: "#7AB1FF", icon: "time" };
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminOrdersScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAdmin();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const list = await api.adminListOrders();
      setOrders(list);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    if (filter === "all") return orders;
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      "En préparation": 0,
      "En livraison": 0,
      Livré: 0,
      Annulée: 0,
    };
    orders.forEach((o) => {
      if (c[o.status] !== undefined) c[o.status] += 1;
    });
    return c;
  }, [orders]);

  if (!isAuthenticated) {
    router.replace("/admin/login");
    return null;
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const updateStatus = async (status: string) => {
    if (!selected) return;
    try {
      setUpdating(true);
      const updated = await api.adminUpdateOrderStatus(selected.id, status);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setSelected(updated);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Mise à jour échouée");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-orders-screen">
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Commandes</Text>
          <Text style={styles.headerSub}>{orders.length} au total</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <Stat label="Prépa." value={counts["En préparation"]} color="#FB923C" />
        <Stat label="Livraison" value={counts["En livraison"]} color="#7AB1FF" />
        <Stat label="Livrées" value={counts["Livré"]} color="#4ADE80" />
        <Stat label="Annulées" value={counts["Annulée"]} color="#FCA5A5" />
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        style={{ flexGrow: 0 }}
      >
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f.id)}
              testID={`admin-orders-filter-${f.id}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="receipt-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>Aucune commande dans ce filtre.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        >
          {filtered.map((o) => {
            const sc = statusColor(o.status);
            return (
              <Pressable
                key={o.id}
                style={styles.card}
                onPress={() => setSelected(o)}
                testID={`admin-order-${o.id}`}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orderId}>#{o.id.slice(0, 8).toUpperCase()}</Text>
                    <Text style={styles.orderName}>{o.customer_name}</Text>
                    <Text style={styles.orderDate}>{formatDate(o.created_at)}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                    <Ionicons name={sc.icon} size={12} color={sc.fg} />
                    <Text style={[styles.statusText, { color: sc.fg }]}>{o.status}</Text>
                  </View>
                </View>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardItems}>{o.items.length} article(s)</Text>
                  <Text style={styles.cardTotal}>{formatPrice(o.total)}</Text>
                </View>
              </Pressable>
            );
          })}
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      )}

      {/* Detail modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selected ? `#${selected.id.slice(0, 8).toUpperCase()}` : ""}
              </Text>
              <Pressable onPress={() => setSelected(null)} hitSlop={8} testID="admin-order-close">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            {selected && (
              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
                <View style={styles.section}>
                  <View style={styles.modeHeader}>
                    <Text style={styles.sectionTitle}>Client</Text>
                    <View style={[
                      styles.modePill,
                      (selected.delivery_mode === "pickup") ? styles.modePillPickup : styles.modePillDelivery,
                    ]}>
                      <Ionicons
                        name={selected.delivery_mode === "pickup" ? "storefront" : "bicycle"}
                        size={12}
                        color={colors.onSurface}
                      />
                      <Text style={styles.modePillText}>
                        {selected.delivery_mode === "pickup" ? "Sur place" : "Livraison"}
                      </Text>
                    </View>
                  </View>
                  <Info icon="person-outline" text={selected.customer_name} />
                  {!!selected.phone && <Info icon="call-outline" text={selected.phone} />}
                  {selected.delivery_mode !== "pickup" && !!selected.address && (
                    <Info icon="location-outline" text={selected.address} />
                  )}
                  {!!selected.notes && <Info icon="document-text-outline" text={selected.notes} />}
                  <Info
                    icon="time-outline"
                    text={formatDate(selected.created_at)}
                  />
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Articles</Text>
                  {selected.items.map((it) => (
                    <View key={it.product_id} style={styles.itemRow}>
                      <Image source={{ uri: it.image }} style={styles.itemImg} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName} numberOfLines={1}>{it.name}{it.variant_label ? ` · ${it.variant_label}` : ""}</Text>
                        <Text style={styles.itemQty}>{it.quantity} × {formatPrice(it.price)}</Text>
                      </View>
                      <Text style={styles.itemTotal}>{formatPrice(it.price * it.quantity)}</Text>
                    </View>
                  ))}
                  <View style={styles.divider} />
                  <Row label="Sous-total" value={formatPrice(selected.subtotal)} />
                  {selected.discount_amount > 0 && (
                    <Row
                      label={`Réduction${selected.promo_code ? ` (${selected.promo_code})` : ""}`}
                      value={`− ${formatPrice(selected.discount_amount)}`}
                      valueColor={colors.success}
                    />
                  )}
                  <Row label="Total payé" value={formatPrice(selected.total)} bold />
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Modifier le statut</Text>
                  <View style={styles.statusGrid}>
                    {STATUS_CHOICES.map((s) => {
                      const sc = statusColor(s);
                      const active = selected.status === s;
                      return (
                        <Pressable
                          key={s}
                          disabled={updating}
                          style={[
                            styles.statusOption,
                            { borderColor: active ? sc.fg : colors.border, backgroundColor: active ? sc.bg : colors.surfaceSecondary },
                          ]}
                          onPress={() => updateStatus(s)}
                          testID={`admin-order-status-${s}`}
                        >
                          <Ionicons name={sc.icon} size={18} color={sc.fg} />
                          <Text style={[styles.statusOptionText, { color: active ? sc.fg : colors.onSurface }]}>
                            {s}
                          </Text>
                          {active && <Ionicons name="checkmark" size={16} color={sc.fg} />}
                        </Pressable>
                      );
                    })}
                  </View>
                  {updating && (
                    <View style={{ alignItems: "center", paddingVertical: spacing.sm }}>
                      <ActivityIndicator size="small" color={colors.brand} />
                    </View>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Info({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={colors.muted} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

function Row({ label, value, bold, valueColor }: { label: string; value: string; bold?: boolean; valueColor?: string }) {
  return (
    <View style={styles.totalsRow}>
      <Text style={[styles.totalsLabel, bold && { color: colors.onSurface, fontWeight: "800", fontSize: font.lg }]}>{label}</Text>
      <Text style={[styles.totalsValue, bold && { fontSize: font.xl, fontWeight: "800", color: colors.brand }, valueColor && { color: valueColor }]}>
        {value}
      </Text>
    </View>
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
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", ...shadows.card },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  headerSub: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  statsRow: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { fontSize: font.xl, fontWeight: "800" },
  statLabel: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  chipsRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.xs, paddingBottom: spacing.md },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600" },
  chipTextActive: { color: "#fff", fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.muted, fontSize: font.base },

  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  orderId: { color: colors.onSurface, fontSize: font.base, fontWeight: "800" },
  orderName: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  orderDate: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: font.sm, fontWeight: "700" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cardItems: { color: colors.muted, fontSize: font.sm },
  cardTotal: { color: colors.brand, fontSize: font.lg, fontWeight: "800" },

  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "92%", borderTopWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800" },
  modeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  modePillDelivery: { backgroundColor: "#11233F", borderColor: "#1F3C66" },
  modePillPickup: { backgroundColor: "#0F2A20", borderColor: "#1A4D38" },
  modePillText: { color: colors.onSurface, fontSize: font.sm, fontWeight: "700" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoText: { color: colors.onSurface, fontSize: font.base, flex: 1 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  itemImg: { width: 44, height: 44, borderRadius: radius.md },
  itemName: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  itemQty: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  itemTotal: { color: colors.onSurface, fontWeight: "700" },
  divider: { height: 1, backgroundColor: colors.divider },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalsLabel: { color: colors.muted, fontSize: font.base },
  totalsValue: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  statusGrid: { gap: spacing.sm },
  statusOption: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1.5 },
  statusOptionText: { flex: 1, fontSize: font.base, fontWeight: "700" },
});
