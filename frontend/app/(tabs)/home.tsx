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
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/src/components/AnimatedPressable";
import { api, type Category, type Product, type ShopHoursResponse, isLowStock, minVariantPrice } from "@/src/api";
import { useCart, formatPrice } from "@/src/store/cart";
import { useAdmin } from "@/src/store/admin";
import { useLoyalty } from "@/src/store/loyalty";
import { colors, font, gradients, radius, shadows, spacing } from "@/src/theme";

export default function HomeScreen() {
  const router = useRouter();
  const { count, guestId } = useCart();
  const { isAuthenticated: isAdmin } = useAdmin();
  const { loyalty, refresh: refreshLoyalty } = useLoyalty(guestId);

  const [categories, setCategories] = useState<Category[]>([]);
  const [popular, setPopular] = useState<Product[]>([]);
  const [comingSoon, setComingSoon] = useState<Product[]>([]);
  const [promoList, setPromoList] = useState<Product[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [shopStatus, setShopStatus] = useState<ShopHoursResponse["status"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [cats, all, shop] = await Promise.all([
        api.getCategories(),
        api.getProducts(),
        api.getShopHours().catch(() => null),
      ]);
      setCategories(cats);
      // Derive sections from a single product list
      setPopular(all.filter((p) => p.popular && !p.coming_soon));
      setComingSoon(all.filter((p) => p.coming_soon));
      setPromoList(all.filter((p) => p.promo && !p.coming_soon));
      setLowStock(all.filter((p) => isLowStock(p)));
      if (shop) setShopStatus(shop.status);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      refreshLoyalty();
    }, [refreshLoyalty]),
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

  return (
    <View style={styles.root} testID="home-screen">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.topBar}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.topBrand}>La Cave 420 🫶🏽</Text>
            {shopStatus && (() => {
              const closingSoon = shopStatus.is_open && !!shopStatus.closing_soon;
              const pillStyle = !shopStatus.is_open
                ? styles.shopStatusClosed
                : closingSoon
                ? styles.shopStatusClosingSoon
                : styles.shopStatusOpen;
              const dotColor = !shopStatus.is_open ? "#FCA5A5" : closingSoon ? "#FB923C" : "#4ADE80";
              const textColor = !shopStatus.is_open ? "#FCA5A5" : closingSoon ? "#FDBA74" : "#86EFAC";
              const mins = shopStatus.closes_in_minutes ?? 0;
              const label = !shopStatus.is_open
                ? shopStatus.reason
                : closingSoon
                ? `⚠️ Ferme bientôt · dans ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? String(mins % 60).padStart(2, "0") : ""}`}`
                : `Ouvert · ${shopStatus.reason}`;
              return (
                <Pressable
                  onPress={() => router.push("/shop-hours")}
                  style={[styles.shopStatusPill, pillStyle]}
                  testID="home-shop-status"
                >
                  <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                  <Text style={[styles.shopStatusText, { color: textColor }]} numberOfLines={1}>
                    {label}
                  </Text>
                </Pressable>
              );
            })()}
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
        {/* Cagnotte banner — replaces the old action tiles */}
        <Animated.View
          entering={FadeInDown.duration(500).delay(150)}
        >
          <Pressable
            style={styles.loyaltyBanner}
            onPress={() => router.push("/(tabs)/catalog")}
            testID="home-loyalty-banner"
          >
            <View style={styles.loyaltyIconWrap}>
              <Ionicons name="gift" size={26} color="#FBBF24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.loyaltyTitle}>
                Cagnotte fidélité 🎁
              </Text>
              <Text style={styles.loyaltyAmount}>
                {(loyalty?.points_balance ?? 0).toFixed(2).replace(".", ",")} €
              </Text>
              <Text style={styles.loyaltyHint}>
                Gagnez 1 € de cagnotte tous les 10 € commandés
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </Pressable>
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
        {popular.length > 0 && (
          <>
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
                      <Text style={styles.productTitle} numberOfLines={2}>
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
          </>
        )}

        {/* En promotion */}
        {promoList.length > 0 && (
          <ProductCarousel
            title="🔥 En promotion"
            accent="#FB923C"
            badgeBg="rgba(251,146,60,0.95)"
            badgeText="Promo"
            items={promoList}
            onPressItem={(p) => router.push(`/product/${p.id}`)}
            testIdPrefix="home-promo"
          />
        )}

        {/* À venir */}
        {comingSoon.length > 0 && (
          <ProductCarousel
            title="🚧 À venir"
            accent="#A78BFA"
            badgeBg="rgba(167,139,250,0.95)"
            badgeText="Bientôt"
            items={comingSoon}
            onPressItem={(p) => router.push(`/product/${p.id}`)}
            testIdPrefix="home-coming-soon"
            priceLabel={() => "Bientôt disponible"}
          />
        )}

        {/* En fin de stock */}
        {lowStock.length > 0 && (
          <ProductCarousel
            title="⚠️ En fin de stock"
            accent="#FBBF24"
            badgeBg="rgba(251,191,36,0.95)"
            badgeText="Stock bas"
            items={lowStock}
            onPressItem={(p) => router.push(`/product/${p.id}`)}
            testIdPrefix="home-low-stock"
          />
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
  loyaltyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "rgba(251,191,36,0.08)",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  loyaltyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(251,191,36,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  loyaltyTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  loyaltyAmount: { color: "#FBBF24", fontSize: font.xxl, fontWeight: "800", marginTop: 2, fontVariant: ["tabular-nums"] },
  loyaltyHint: { color: colors.muted, fontSize: font.xs, marginTop: 4 },
  shopStatusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 240,
  },
  shopStatusOpen: { backgroundColor: "rgba(74,222,128,0.08)", borderColor: "rgba(74,222,128,0.30)" },
  shopStatusClosed: { backgroundColor: "rgba(252,165,165,0.08)", borderColor: "rgba(252,165,165,0.30)" },
  shopStatusClosingSoon: { backgroundColor: "rgba(251,146,60,0.10)", borderColor: "rgba(251,146,60,0.40)" },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  shopStatusText: { fontSize: font.xs, fontWeight: "700" },
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

  // Section badges & strikethrough
  sectionBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  sectionBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  popularImageWrap: { position: "relative" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, flexShrink: 1 },
  strikePrice: {
    color: colors.muted,
    fontSize: font.sm,
    textDecorationLine: "line-through",
    fontWeight: "600",
  },
  promoPrice: { color: "#FB923C" },
});

// ---------------- Reusable horizontal product carousel ----------------

type CarouselProps = {
  title: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
  items: Product[];
  onPressItem: (p: Product) => void;
  testIdPrefix: string;
  /** Override the price label (e.g. for "Bientôt disponible") */
  priceLabel?: (p: Product) => string;
};

function ProductCarousel({
  title,
  accent,
  badgeBg,
  badgeText,
  items,
  onPressItem,
  testIdPrefix,
  priceLabel,
}: CarouselProps) {
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
      >
        {items.map((item, i) => {
          const original = typeof item.original_price === "number" ? item.original_price : null;
          const hasStrike = !!original && original > minVariantPrice(item);
          return (
            <Animated.View
              key={item.id}
              entering={FadeInRight.duration(450).delay(80 + i * 50)}
            >
              <AnimatedPressable
                style={styles.popularCard}
                onPress={() => onPressItem(item)}
                testID={`${testIdPrefix}-${item.id}`}
                scale={0.96}
              >
                <View style={styles.popularImageWrap}>
                  <Image source={{ uri: item.image }} style={styles.popularImage} contentFit="cover" />
                  <View style={[styles.sectionBadge, { backgroundColor: badgeBg }]}>
                    <Text style={styles.sectionBadgeText}>{badgeText}</Text>
                  </View>
                </View>
                <View style={styles.popularBody}>
                  <Text style={styles.productTitle} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.productDesc} numberOfLines={1}>
                    {item.unit || item.description}
                  </Text>
                  <View style={styles.popularFooter}>
                    {priceLabel ? (
                      <Text style={[styles.productPrice, { color: accent, fontSize: font.base }]} numberOfLines={1}>
                        {priceLabel(item)}
                      </Text>
                    ) : (
                      <View style={styles.priceRow}>
                        {hasStrike && (
                          <Text style={styles.strikePrice}>{formatPrice(original!)}</Text>
                        )}
                        <Text style={[styles.productPrice, hasStrike && styles.promoPrice]}>
                          dès {formatPrice(minVariantPrice(item))}
                        </Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </View>
                </View>
              </AnimatedPressable>
            </Animated.View>
          );
        })}
      </ScrollView>
    </>
  );
}
