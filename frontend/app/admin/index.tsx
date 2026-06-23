import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type AdminAnalytics } from "@/src/api";
import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

function formatEuros(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export default function AdminIndex() {
  const router = useRouter();
  const { logout, isAuthenticated } = useAdmin();
  const [stats, setStats] = useState<AdminAnalytics | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const loadStats = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setLoadingStats(true);
      const s = await api.adminAnalytics();
      setStats(s);
    } catch {
      // silent — keep last stats if any
    } finally {
      setLoadingStats(false);
    }
  }, [isAuthenticated]);

  useFocusEffect(useCallback(() => { loadStats(); }, [loadStats]));

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.body}>
          <Text style={styles.title}>Connexion requise</Text>
          <Pressable
            style={styles.cta}
            onPress={() => router.replace("/admin/login")}
            testID="admin-need-login"
          >
            <Text style={styles.ctaText}>Se connecter</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const items = [
    { id: "orders", label: "Commandes", icon: "receipt", bg: "#0F2A20", fg: "#4ADE80", path: "/admin/orders" },
    { id: "products", label: "Produits", icon: "cube", bg: "#11233F", fg: "#7AB1FF", path: "/admin/products" },
    { id: "categories", label: "Catégories", icon: "grid", bg: "#1A1A2E", fg: "#B19CFF", path: "/admin/categories" },
    { id: "promo-codes", label: "Codes Promo", icon: "pricetag", bg: "#2A1F0E", fg: "#FBBF24", path: "/admin/promo-codes" },
    { id: "shop-hours", label: "Horaires de la boutique", icon: "time", bg: "#11283A", fg: "#5EEAD4", path: "/admin/shop-hours" },
    { id: "telegram", label: "Notifications Telegram", icon: "paper-plane", bg: "#11233F", fg: "#7AB1FF", path: "/admin/telegram" },
    { id: "pin", label: "Changer le PIN", icon: "key", bg: "#2A1A12", fg: "#FB923C", path: "/admin/change-pin" },
  ] as const;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-index-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Administration</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {/* Analytics dashboard */}
        <View style={styles.statsWrap}>
          <View style={styles.statsHeader}>
            <Text style={styles.statsTitle}>Aperçu</Text>
            {loadingStats && <ActivityIndicator size="small" color={colors.muted} />}
          </View>

          <View style={styles.statsGrid}>
            <Pressable
              style={[styles.statCard, styles.statCardWide]}
              onPress={() => router.push("/admin/orders?period=today")}
              testID="stat-card-today"
            >
              <View style={styles.statHeader}>
                <Ionicons name="today" size={16} color="#4ADE80" />
                <Text style={styles.statLabel}>Recettes aujourd&apos;hui</Text>
              </View>
              <Text style={styles.statValue} testID="stat-revenue-today">
                {stats ? formatEuros(stats.revenue_today) : "—"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.statCard, styles.statCardWide]}
              onPress={() => router.push("/admin/orders?period=week")}
              testID="stat-card-week"
            >
              <View style={styles.statHeader}>
                <Ionicons name="calendar" size={16} color="#7AB1FF" />
                <Text style={styles.statLabel}>Cette semaine</Text>
              </View>
              <Text style={styles.statValue} testID="stat-revenue-week">
                {stats ? formatEuros(stats.revenue_week) : "—"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.statCard}
              onPress={() => router.push("/admin/orders?filter=active")}
              testID="stat-card-pending"
            >
              <View style={styles.statHeader}>
                <Ionicons name="time" size={16} color="#FBBF24" />
                <Text style={styles.statLabel}>En attente</Text>
              </View>
              <Text style={[styles.statValue, styles.statValueSmall]} testID="stat-pending">
                {stats ? `${stats.pending_orders}` : "—"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.statCard}
              onPress={() => router.push("/admin/products?stock=out")}
              testID="stat-card-out"
            >
              <View style={styles.statHeader}>
                <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
                <Text style={styles.statLabel}>Rupture</Text>
              </View>
              <Text style={[styles.statValue, styles.statValueSmall]} testID="stat-out-of-stock">
                {stats ? `${stats.out_of_stock_products}` : "—"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.statCard}
              onPress={() => router.push("/admin/products?stock=low")}
              testID="stat-card-low"
            >
              <View style={styles.statHeader}>
                <Ionicons name="warning" size={16} color="#FB923C" />
                <Text style={styles.statLabel}>Stock bas</Text>
              </View>
              <Text style={[styles.statValue, styles.statValueSmall]} testID="stat-low-stock">
                {stats ? `${stats.low_stock_variants}` : "—"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.statCard}
              onPress={() => router.push("/admin/products?filter=coming_soon")}
              testID="stat-card-coming-soon"
            >
              <View style={styles.statHeader}>
                <Ionicons name="rocket" size={16} color="#A78BFA" />
                <Text style={styles.statLabel}>À venir</Text>
              </View>
              <Text style={[styles.statValue, styles.statValueSmall]} testID="stat-coming-soon">
                {stats ? `${stats.coming_soon_products}` : "—"}
              </Text>
            </Pressable>
          </View>
        </View>

        {items.map((it) => (
          <Pressable
            key={it.id}
            style={styles.row}
            onPress={() => router.push(it.path)}
            testID={`admin-menu-${it.id}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: it.bg }]}>
              <Ionicons name={it.icon as any} size={20} color={it.fg} />
            </View>
            <Text style={styles.rowLabel}>{it.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}

        <Pressable
          style={[styles.row, { borderColor: colors.error }]}
          onPress={async () => {
            await logout();
            router.replace("/(tabs)/home");
          }}
          testID="admin-logout"
        >
          <View style={[styles.iconWrap, { backgroundColor: "#3F1414" }]}>
            <Ionicons name="log-out-outline" size={20} color="#FCA5A5" />
          </View>
          <Text style={[styles.rowLabel, { color: colors.error }]}>Déconnexion</Text>
        </Pressable>
      </ScrollView>
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    ...shadows.card,
  },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  title: { color: colors.onSurface, fontSize: font.xl, fontWeight: "700" },

  // Analytics
  statsWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  statsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statsTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    flexBasis: "30%",
    flexGrow: 1,
  },
  statCardWide: { flexBasis: "47%" },
  statHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  statLabel: { color: colors.muted, fontSize: font.xs, fontWeight: "600" },
  statValue: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800", fontVariant: ["tabular-nums"] },
  statValueSmall: { fontSize: font.xl, textAlign: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  cta: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  ctaText: { color: "#fff", fontWeight: "700" },
});
