// v1.0.3
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeInRight,
  FadeIn,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/src/components/AnimatedPressable";
import { api, type Category, type Order, type Product, minVariantPrice } from "@/src/api";
import { useCart, formatPrice } from "@/src/store/cart";
import { useAdmin } from "@/src/store/admin";
import { useLoyalty } from "@/src/store/loyalty";
import { colors, font, gradients, radius, shadows, spacing } from "@/src/theme";

type ActionTile = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  bg: string;
  fg: string;
  onPress: () => void;
  badge?: number;
};

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMin = Math.floor((now - d.getTime()) / 60000);
    if (diffMin < 1) return "À l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffMin < 1440) return `il y a ${Math.floor(diffMin / 60)} h`;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

export default function HomeScreen() {
  const router = useRouter();
  const { count, guestId } = useCart();
  const { isAuthenticated: isAdmin } = useAdmin();
  const { refresh: refreshLoyalty } = useLoyalty(guestId);

  const [categories, setCategories] = useState<Category[]>([]);
  const [popular, setPopular] = useState<Product[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [cats, pop] = await Promise.all([
        api.getCategories(),
        api.getProducts({ popular: true }),
      ]);
      setCategories(cats);
      setPopular(pop);
      // Only load orders list for the admin (PIN-authenticated)
      if (isAdmin) {
        try {
          const adminOrders = await api.adminListOrders();
          setRecentOrders(adminOrders.slice(0, 3));
        } catch {
          setRecentOrders([]);
        }
      } else {
        setRecentOrders([]);
      }
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      refreshLoyalty();
      if (isAdmin) {
        api.adminListOrders().then((o) => setRecentOrders(o.slice(0, 3))).catch(() => {});
      } else {
        setRecentOrders([]);
      }
    }, [isAdmin, refreshLoyalty]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshLoyalty()]);
    setRefreshing(false);
  }, [load, refreshLoyalty]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} testID="home-loading">
        <ActivityIndicator color={colors.brand} size="large" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>Erreur de chargement.</Text>
        <Pressable style={styles.retryBtn} onPress={load} testID="home-retry-btn">
          <Text style={styles.retryText}>Réessayer</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const actions: ActionTile[] = [
    {
      id: "catalog",
      label: "Catalogue",
      icon: "grid",
      bg: "#11233F",
      fg: "#7AB1FF",
      onPress: () => router.push("/(tabs)/catalog"),
    },
    {
      id: "cart",
      label: "Panier",
      icon: "bag-handle",
      bg: "#1A1A2E",
      fg: "#B19CFF",
      onPress: () => router.push("/(tabs)/cart"),
      badge: count,
    },
    {
      id: "orders",
      label: "Commandes",
      icon: "receipt",
      bg: "#0F2A20",
      fg: "#4ADE80",
      onPress: () => router.push(isAdmin ? "/admin/orders" : "/admin/login"),
    },
    {
      id: "promo",
      label: "Promotions",
      icon: "pricetag",
      bg: "#2A1A12",
      fg: "#FB923C",
      onPress: () => router.push({ pathname: "/(tabs)/catalog" }),
    },
  ];

  return (
    <View style={styles.root} testID="home-screen">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.topBrand}>La Cave 420 🫶🏽</Text>
          </View>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push(isAdmin ? "/admin/orders" : "/admin/login")}
            testID="home-bell-btn"
            hitSlop={8}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.onSurface} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push("/settings")}
            testID="home-settings-btn"
            hitSlop={8}
          >
            <Ionicons name="settings-outline" size={20} color={colors.onSurface} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surface }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
          />
        }
      >
        {/* Action grid */}
        <Animated.View
          entering={FadeInDown.duration(500).delay(150)}
          style={styles.actionsRow}
        >
          {actions.map((a, i) => (
            <Animated.View
              key={a.id}
              entering={FadeInDown.duration(450).delay(200 + i * 60)}
              style={{ flex: 1 }}
            >
              <AnimatedPressable
                style={styles.actionTile}
                onPress={a.onPress}
                testID={`home-action-${a.id}`}
                scale={0.92}
              >
                <View style={[styles.actionIconWrap, { backgroundColor: a.bg }]}>
                  <Ionicons name={a.icon} size={22} color={a.fg} />
                  {a.badge && a.badge > 0 ? (
                    <View style={styles.actionBadge}>
                      <Text style={styles.actionBadgeText}>{a.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </AnimatedPressable>
            </Animated.View>
          ))}
        </Animated.View>

        {/* Compliance card */}
        <Animated.View
          entering={FadeIn.duration(500).delay(450)}
          style={styles.complianceCard}
        >
          <View style={styles.complianceIcon}>
            <Ionicons name="shield-checkmark" size={18} color="#4ADE80" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.complianceTitle}>Produits conformes</Text>
            <Text style={styles.complianceSub}>
              THC &lt; 0,3 % · Réservé aux 18 ans et +
            </Text>
          </View>
        </Animated.View>

        {/* Categories */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Catégories</Text>
          <Pressable onPress={() => router.push("/(tabs)/catalog")}>
            <Text style={styles.linkText}>Voir tout</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
        >
          {categories.map((c, i) => (
            <Animated.View
              key={c.id}
              entering={FadeInRight.duration(400).delay(500 + i * 50)}
            >
              <AnimatedPressable
                style={styles.catCard}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/catalog",
                    params: { category_id: c.id },
                  })
                }
                testID={`home-category-${c.id}`}
                scale={0.92}
              >
                <View style={styles.catIconWrap}>
                  <Ionicons name={c.icon as any} size={24} color={colors.onSurface} />
                </View>
                <Text style={styles.catName} numberOfLines={1}>
                  {c.name}
                </Text>
              </AnimatedPressable>
            </Animated.View>
          ))}
        </ScrollView>

        {/* Popular */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Populaires</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
        >
          {popular.map((item, i) => (
            <Animated.View
              key={item.id}
              entering={FadeInRight.duration(450).delay(700 + i * 60)}
            >
              <AnimatedPressable
                style={styles.popularCard}
                onPress={() => router.push(`/product/${item.id}`)}
                testID={`home-popular-${item.id}`}
                scale={0.96}
              >
                <Image source={{ uri: item.image }} style={styles.popularImage} contentFit="cover" />
                <View style={styles.popularBody}>
                  <Text style={styles.productTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.productDesc} numberOfLines={1}>
                    {item.unit || item.description}
                  </Text>
                  <View style={styles.popularFooter}>
                    <Text style={styles.productPrice}>dès {formatPrice(minVariantPrice(item))}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </View>
                </View>
              </AnimatedPressable>
            </Animated.View>
          ))}
        </ScrollView>

        {/* Activity feed — recent orders */}
        {recentOrders.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Activité</Text>
              <Pressable onPress={() => router.push("/admin/orders")}>
                <Text style={styles.linkText}>Tout voir</Text>
              </Pressable>
            </View>
            <Animated.View
              entering={FadeInDown.duration(500).delay(900)}
              style={styles.activityList}
            >
              {recentOrders.map((o) => (
                <AnimatedPressable
                  key={o.id}
                  style={styles.activityRow}
                  onPress={() => router.push(`/order/${o.id}`)}
                  testID={`home-activity-${o.id}`}
                  scale={0.98}
                >
                  <View
                    style={[
                      styles.activityIcon,
                      {
                        backgroundColor:
                          o.status === "Livré" ? "#0F2A20" : "#11233F",
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        o.status === "Livré"
                          ? "checkmark-circle"
                          : o.status === "En livraison"
                          ? "bicycle"
                          : "restaurant"
                      }
                      size={20}
                      color={o.status === "Livré" ? "#4ADE80" : "#7AB1FF"}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activityTitle}>
                      Commande #{o.id.slice(0, 6).toUpperCase()}
                    </Text>
                    <Text style={styles.activitySub}>
                      {o.status} · {formatRelativeDate(o.created_at)}
                    </Text>
                  </View>
                  <Text style={styles.activityAmount}>−{formatPrice(o.total)}</Text>
                </AnimatedPressable>
              ))}
            </Animated.View>
          </>
        )}

        <View style={{ height: count > 0 ? 110 : spacing.xl }} />
      </ScrollView>

      {/* Floating cart bar */}
      {count > 0 && (
        <Pressable
          style={styles.floatingCart}
          onPress={() => router.push("/(tabs)/cart")}
          testID="home-floating-cart"
        >
          <LinearGradient
            colors={gradients.heroBlue}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.floatingCartInner}
          >
            <View style={styles.floatingCartLeft}>
              <View style={styles.floatingCartBadge}>
                <Text style={styles.floatingCartBadgeText}>{count}</Text>
              </View>
              <Text style={styles.floatingCartText}>Voir le panier</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  topBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: font.lg, fontWeight: "800" },
  topBrand: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: { paddingBottom: spacing.xxl },

  // Hero
  hero: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.xl,
    overflow: "hidden",
    ...shadows.floating,
  },
  heroGrad: { padding: spacing.xl, gap: spacing.sm },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: font.base, fontWeight: "600" },
  heroAmount: {
    color: "#fff",
    fontSize: font.xxxl,
    fontWeight: "800",
    letterSpacing: -1,
  },
  heroSub: { color: "rgba(255,255,255,0.75)", fontSize: font.sm },
  heroFooterRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroChip: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  heroChipText: { color: "#fff", fontSize: font.sm, fontWeight: "600" },

  // Actions grid
  actionsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  actionTile: { flex: 1, alignItems: "center", gap: spacing.sm },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
  actionBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  actionLabel: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600" },

  // Compliance
  complianceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  complianceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0F2A20",
    alignItems: "center",
    justifyContent: "center",
  },
  complianceTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  complianceSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },

  // Sections
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },
  linkText: { color: colors.brand, fontSize: font.base, fontWeight: "700" },

  // Categories
  catRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  catCard: { width: 76, alignItems: "center", gap: spacing.sm, flexShrink: 0 },
  catIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  catName: { fontSize: font.sm, color: colors.onSurface, textAlign: "center", fontWeight: "500" },

  // Popular
  popularCard: {
    width: 180,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  popularImage: { width: "100%", height: 110 },
  popularBody: { padding: spacing.md, gap: 4 },
  popularFooter: {
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  productTitle: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  productDesc: { fontSize: font.sm, color: colors.muted },
  productPrice: { fontSize: font.lg, fontWeight: "800", color: colors.onSurface },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },

  // Activity
  activityList: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  activityTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  activitySub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  activityAmount: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },

  // Floating cart
  floatingCart: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    borderRadius: radius.pill,
    overflow: "hidden",
    ...shadows.floating,
  },
  floatingCartInner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  floatingCartLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  floatingCartBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingCartBadgeText: { color: "#fff", fontSize: font.sm, fontWeight: "800" },
  floatingCartText: { color: "#fff", fontWeight: "700", fontSize: font.lg },

  errorTitle: { color: colors.error, fontSize: font.lg, fontWeight: "600", marginBottom: spacing.md },
  retryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  retryText: { color: "#fff", fontWeight: "700" },
});
