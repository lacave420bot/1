import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type Category, type Product } from "@/src/api";
import { useCart, formatPrice } from "@/src/store/cart";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function HomeScreen() {
  const router = useRouter();
  const { addItem, count, total } = useCart();
  const [categories, setCategories] = useState<Category[]>([]);
  const [popular, setPopular] = useState<Product[]>([]);
  const [promos, setPromos] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [cats, pop, pr] = await Promise.all([
        api.getCategories(),
        api.getProducts({ popular: true }),
        api.getProducts({ promo: true }),
      ]);
      setCategories(cats);
      setPopular(pop);
      setPromos(pr);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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

  const heroPromo = promos[0];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="home-screen">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greetSm}>Bienvenue chez</Text>
            <Text style={styles.greetLg}>Verte Vallée CBD</Text>
          </View>
          <Pressable
            onPress={() => router.push("/(tabs)/catalog")}
            style={styles.searchPill}
            testID="home-search-pill"
            hitSlop={8}
          >
            <Ionicons name="search" size={20} color={colors.onSurface} />
          </Pressable>
        </View>

        {/* Compliance banner */}
        <View style={styles.complianceBanner} testID="home-compliance-banner">
          <Ionicons name="shield-checkmark" size={18} color={colors.success} />
          <Text style={styles.complianceText}>
            Produits conformes — THC &lt; 0,3 % · Réservé aux adultes 18 ans et +
          </Text>
        </View>

        {/* Hero promo */}
        {heroPromo && (
          <Pressable
            style={styles.hero}
            onPress={() => router.push(`/product/${heroPromo.id}`)}
            testID="home-hero-promo"
          >
            <Image source={{ uri: heroPromo.image }} style={styles.heroImage} contentFit="cover" />
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.7)"]}
              style={styles.heroOverlay}
            >
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>PROMO</Text>
              </View>
              <Text style={styles.heroTitle}>{heroPromo.name}</Text>
              <Text style={styles.heroSubtitle}>
                {formatPrice(heroPromo.price)} · Livraison rapide
              </Text>
            </LinearGradient>
          </Pressable>
        )}

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
          {categories.map((c) => (
            <Pressable
              key={c.id}
              style={styles.catCard}
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/catalog",
                  params: { category_id: c.id },
                })
              }
              testID={`home-category-${c.id}`}
            >
              <View style={styles.catIconWrap}>
                <Ionicons name={c.icon as any} size={26} color={colors.brand} />
              </View>
              <Text style={styles.catName} numberOfLines={1}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Popular */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Populaires</Text>
        </View>
        <FlatList
          data={popular}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.popularCard}
              onPress={() => router.push(`/product/${item.id}`)}
              testID={`home-popular-${item.id}`}
            >
              <Image source={{ uri: item.image }} style={styles.popularImage} contentFit="cover" />
              <View style={styles.popularBody}>
                <Text style={styles.productTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.productDesc} numberOfLines={1}>
                  {item.description}
                </Text>
                <View style={styles.popularFooter}>
                  <Text style={styles.productPrice}>{formatPrice(item.price)}</Text>
                  <Pressable
                    style={styles.addBtn}
                    onPress={() => addItem(item)}
                    hitSlop={8}
                    testID={`home-add-${item.id}`}
                  >
                    <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
                  </Pressable>
                </View>
              </View>
            </Pressable>
          )}
        />

        {/* Promos grid */}
        {promos.length > 1 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Promotions</Text>
            </View>
            <View style={styles.promoList}>
              {promos.slice(1).map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.promoRow}
                  onPress={() => router.push(`/product/${p.id}`)}
                  testID={`home-promo-${p.id}`}
                >
                  <Image source={{ uri: p.image }} style={styles.promoImg} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productTitle} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.productDesc} numberOfLines={2}>{p.description}</Text>
                    <Text style={styles.productPrice}>{formatPrice(p.price)}</Text>
                  </View>
                  <Pressable
                    style={styles.addBtn}
                    onPress={() => addItem(p)}
                    hitSlop={8}
                    testID={`home-promo-add-${p.id}`}
                  >
                    <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <View style={{ height: count > 0 ? 100 : spacing.xl }} />
      </ScrollView>

      {/* Floating cart bar */}
      {count > 0 && (
        <Pressable
          style={styles.floatingCart}
          onPress={() => router.push("/(tabs)/cart")}
          testID="home-floating-cart"
        >
          <View style={styles.floatingCartLeft}>
            <View style={styles.floatingCartBadge}>
              <Text style={styles.floatingCartBadgeText}>{count}</Text>
            </View>
            <Text style={styles.floatingCartText}>Voir le panier</Text>
          </View>
          <Text style={styles.floatingCartTotal}>{formatPrice(total)}</Text>
        </Pressable>
      )}
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
  },
  scrollContent: { paddingBottom: spacing.xxl },
  headerRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  greetSm: { color: colors.muted, fontSize: font.sm, fontWeight: "500" },
  greetLg: { color: colors.onSurface, fontSize: font.xxl, fontWeight: "700" },
  searchPill: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  complianceBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  complianceText: { color: "#065F46", fontSize: font.sm, fontWeight: "600", flex: 1 },
  hero: {
    marginHorizontal: spacing.lg,
    height: 180,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.lg,
    justifyContent: "flex-end",
  },
  heroBadge: {
    backgroundColor: colors.brand,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  heroBadgeText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.sm },
  heroTitle: { color: "#fff", fontSize: font.xl, fontWeight: "700" },
  heroSubtitle: { color: "#fff", fontSize: font.base, opacity: 0.9, marginTop: 2 },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  linkText: { color: colors.brand, fontSize: font.base, fontWeight: "600" },
  catRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  catCard: { width: 78, alignItems: "center", gap: spacing.sm, flexShrink: 0 },
  catIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  catName: { fontSize: font.sm, color: colors.onSurface, textAlign: "center", fontWeight: "500" },
  popularCard: {
    width: 180,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  popularImage: { width: "100%", height: 110 },
  popularBody: { padding: spacing.md, gap: 4 },
  popularFooter: {
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  productTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  productDesc: { fontSize: font.sm, color: colors.muted },
  productPrice: { fontSize: font.lg, fontWeight: "700", color: colors.brand },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  promoList: { paddingHorizontal: spacing.lg, gap: spacing.md },
  promoRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    alignItems: "center",
    ...shadows.card,
  },
  promoImg: { width: 64, height: 64, borderRadius: radius.md },
  floatingCart: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...shadows.floating,
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
  floatingCartBadgeText: { color: "#fff", fontSize: font.sm, fontWeight: "700" },
  floatingCartText: { color: "#fff", fontWeight: "700", fontSize: font.lg },
  floatingCartTotal: { color: "#fff", fontWeight: "700", fontSize: font.lg },
  errorTitle: { color: colors.error, fontSize: font.lg, fontWeight: "600", marginBottom: spacing.md },
  retryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  retryText: { color: "#fff", fontWeight: "700" },
});
