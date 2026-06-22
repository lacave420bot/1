import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
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

// Cross-platform confirmation: native Alert on iOS/Android, window.confirm on web.
function confirmAction(title: string, message: string, onConfirm: () => void, confirmLabel: string = "Supprimer") {
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Annuler", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}

const STATUS_CHOICES = ["En cours", "Terminée", "Annulée"] as const;

type StatusKey = "all" | "En cours" | "Terminée" | "Annulée";

const STAT_FILTERS: { id: StatusKey; label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "all",      label: "Toutes",   color: "#FFFFFF", bg: "#1F2937", icon: "list" },
  { id: "En cours", label: "En cours", color: "#7AB1FF", bg: "#11233F", icon: "time" },
  { id: "Terminée", label: "Terminées", color: "#4ADE80", bg: "#0F2A20", icon: "checkmark-circle" },
  { id: "Annulée",  label: "Annulées", color: "#FCA5A5", bg: "#3F1414", icon: "close-circle" },
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
  const { isAuthenticated, ready: adminReady } = useAdmin();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusKey>("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const [updating, setUpdating] = useState(false);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      const list = await api.adminListOrders();
      setOrders(list);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (adminReady && !isAuthenticated) router.replace("/admin/login");
  }, [adminReady, isAuthenticated, router]);

  const filtered = useMemo(() => {
    if (filter === "all") return orders;
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length, "En cours": 0, "Terminée": 0, "Annulée": 0 };
    orders.forEach((o) => {
      if (c[o.status] !== undefined) c[o.status] += 1;
    });
    return c;
  }, [orders]);

  if (!adminReady) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
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
      // Auto-close the modal after marking as finished or cancelled
      if (status === "Terminée" || status === "Annulée") {
        setSelected(null);
      } else {
        setSelected(updated);
      }
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Mise à jour échouée");
    } finally {
      setUpdating(false);
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.map((o) => o.id)));
  };

  const performBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      setDeleting(true);
      await api.adminBulkDeleteOrders(ids);
      setOrders((prev) => prev.filter((o) => !selectedIds.has(o.id)));
      exitSelectMode();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Suppression échouée");
    } finally {
      setDeleting(false);
    }
  };

  const confirmBulkDelete = () => {
    const n = selectedIds.size;
    if (n === 0) return;
    confirmAction(
      `Supprimer ${n} commande${n > 1 ? "s" : ""} ?`,
      "Cette action est définitive.",
      performBulkDelete,
    );
  };

  const confirmDeleteOne = (order: Order) => {
    confirmAction(
      `Supprimer #${order.id.slice(0, 8).toUpperCase()} ?`,
      "Cette action est définitive.",
      async () => {
        try {
          await api.adminDeleteOrder(order.id);
          setOrders((prev) => prev.filter((o) => o.id !== order.id));
          setSelected(null);
        } catch (e: any) {
          Alert.alert("Erreur", e?.message || "Suppression échouée");
        }
      },
    );
  };

  const confirmCancel = (order: Order) => {
    confirmAction(
      "Annuler la commande ?",
      `La commande #${order.id.slice(0, 8).toUpperCase()} de ${order.customer_name} sera marquée comme annulée.`,
      () => updateStatus("Annulée"),
      "Annuler la commande",
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-orders-screen">
      <View style={styles.header}>
        {selectMode ? (
          <Pressable style={styles.backBtn} onPress={exitSelectMode} hitSlop={8} testID="admin-orders-cancel-select">
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
        ) : (
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/home");
            }}
            hitSlop={8}
            testID="admin-orders-back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
        )}
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>
            {selectMode ? `${selectedIds.size} sélectionnée${selectedIds.size > 1 ? "s" : ""}` : "Commandes"}
          </Text>
          <Text style={styles.headerSub}>
            {selectMode
              ? `${filtered.length} affichée${filtered.length > 1 ? "s" : ""}`
              : `${orders.length} au total`}
          </Text>
        </View>
        {selectMode ? (
          <Pressable
            style={styles.headerActionBtn}
            onPress={selectAllVisible}
            hitSlop={8}
            testID="admin-orders-select-all"
          >
            <Ionicons name="checkmark-done" size={20} color={colors.onSurface} />
          </Pressable>
        ) : (
          <Pressable
            style={styles.headerActionBtn}
            onPress={() => setSelectMode(true)}
            hitSlop={8}
            testID="admin-orders-enter-select"
            disabled={orders.length === 0}
          >
            <Ionicons name="checkbox-outline" size={20} color={orders.length === 0 ? colors.muted : colors.onSurface} />
          </Pressable>
        )}
      </View>

      {/* Clickable colored stat filter cards */}
      <View style={styles.statsRow}>
        {STAT_FILTERS.map((s) => {
          const active = filter === s.id;
          const count = counts[s.id] ?? 0;
          return (
            <Pressable
              key={s.id}
              onPress={() => setFilter(s.id)}
              style={[
                styles.statBox,
                { backgroundColor: active ? s.bg : colors.surfaceSecondary, borderColor: active ? s.color : colors.border },
              ]}
              testID={`admin-orders-filter-${s.id}`}
            >
              <Ionicons name={s.icon} size={16} color={s.color} />
              <Text style={[styles.statValue, { color: s.color }]}>{count}</Text>
              <Text style={[styles.statLabel, active && { color: s.color }]} numberOfLines={1}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: selectMode ? 140 : spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        >
          {filtered.map((o) => {
            const sc = statusColor(o.status);
            const isSelected = selectedIds.has(o.id);
            return (
              <Pressable
                key={o.id}
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => {
                  if (selectMode) toggleSelect(o.id);
                  else setSelected(o);
                }}
                onLongPress={() => {
                  if (!selectMode) {
                    setSelectMode(true);
                    setSelectedIds(new Set([o.id]));
                  }
                }}
                delayLongPress={300}
                testID={`admin-order-${o.id}`}
              >
                <View style={styles.cardHeader}>
                  {selectMode && (
                    <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                      {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  )}
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
                  <View style={styles.cardFooterLeft}>
                    <Text style={styles.cardItems}>{o.items.length} article(s)</Text>
                    <View style={[
                      styles.modeBadgeSmall,
                      (o.delivery_mode === "pickup") ? styles.modeBadgePickup : styles.modeBadgeDelivery,
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
                  <Text style={styles.cardTotal}>{formatPrice(o.total)}</Text>
                </View>
              </Pressable>
            );
          })}
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <View style={styles.bulkBar} testID="admin-orders-bulk-bar">
          <Pressable
            style={[styles.bulkDeleteBtn, (selectedIds.size === 0 || deleting) && styles.bulkDeleteBtnDisabled]}
            disabled={selectedIds.size === 0 || deleting}
            onPress={confirmBulkDelete}
            testID="admin-orders-bulk-delete"
          >
            {deleting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="trash" size={18} color="#fff" />
                <Text style={styles.bulkDeleteText}>
                  Supprimer {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Text>
              </>
            )}
          </Pressable>
        </View>
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
              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}>
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

                {/* Quick actions: cancel + delete */}
                <View style={styles.actionsRow}>
                  {selected.status !== "Annulée" && (
                    <Pressable
                      style={[styles.cancelBtn, updating && styles.btnDisabled]}
                      disabled={updating}
                      onPress={() => confirmCancel(selected)}
                      testID="admin-order-cancel-btn"
                    >
                      <Ionicons name="close-circle-outline" size={18} color="#FCA5A5" />
                      <Text style={styles.cancelBtnText}>Annuler</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.deleteBtn, updating && styles.btnDisabled]}
                    disabled={updating}
                    onPress={() => confirmDeleteOne(selected)}
                    testID="admin-order-delete-btn"
                  >
                    <Ionicons name="trash-outline" size={18} color="#fff" />
                    <Text style={styles.deleteBtnText}>Supprimer</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  headerActionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", ...shadows.card },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  headerSub: { fontSize: font.sm, color: colors.muted, marginTop: 2 },

  statsRow: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    gap: 2,
    borderWidth: 1.5,
    minHeight: 78,
    justifyContent: "center",
  },
  statValue: { fontSize: font.xl, fontWeight: "800" },
  statLabel: { fontSize: font.xs, color: colors.muted, marginTop: 2, fontWeight: "600" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.muted, fontSize: font.base },

  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardSelected: { borderColor: colors.brand, backgroundColor: "rgba(34,103,238,0.10)" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  orderId: { color: colors.onSurface, fontSize: font.base, fontWeight: "800" },
  orderName: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  orderDate: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: font.sm, fontWeight: "700" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cardFooterLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  cardItems: { color: colors.muted, fontSize: font.sm },
  cardTotal: { color: colors.brand, fontSize: font.lg, fontWeight: "800" },
  modeBadgeSmall: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  modeBadgeDelivery: { backgroundColor: "#11233F", borderColor: "#1F3C66" },
  modeBadgePickup: { backgroundColor: "#0F2A20", borderColor: "#1A4D38" },
  modeBadgeText: { color: colors.onSurface, fontSize: font.xs, fontWeight: "700" },

  bulkBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1, borderTopColor: colors.divider,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl,
  },
  bulkDeleteBtn: {
    backgroundColor: "#DC2626",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.pill,
  },
  bulkDeleteBtnDisabled: { opacity: 0.4 },
  bulkDeleteText: { color: "#fff", fontWeight: "800", fontSize: font.base },

  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "92%", borderTopWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800" },
  modeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1,
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

  actionsRow: { flexDirection: "row", gap: spacing.sm },
  cancelBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#3F1414",
    borderWidth: 1,
    borderColor: "#7F1D1D",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  cancelBtnText: { color: "#FCA5A5", fontWeight: "700", fontSize: font.base },
  deleteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#DC2626",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  deleteBtnText: { color: "#fff", fontWeight: "800", fontSize: font.base },
  btnDisabled: { opacity: 0.5 },
});
