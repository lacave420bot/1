import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api, type Category, type Product, minVariantPrice } from "@/src/api";
import { AnimatedPressable } from "@/src/components/AnimatedPressable";
import { useCart, formatPrice } from "@/src/store/cart";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function CatalogScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category_id?: string }>();
  const { count, total } = useCart();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCat, setSelectedCat] = useState<string>(params.category_id || "all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [cats, prods] = await Promise.all([
          api.getCategories(),
          api.getProducts(),
        ]);
        setCategories(cats);
        setProducts(prods);
      } catch (e: any) {
        setError(e?.message || "Impossible de charger le catalogue.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (params.category_id) setSelectedCat(params.category_id);
  }, [params.category_id]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchCat = selectedCat === "all" || p.category_id === selectedCat;
      const matchSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [products, selectedCat, search]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} testID="catalog-loading">
        <ActivityIndicator color={colors.brand} size="large" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>{error}</Text>
      </SafeAreaView>
    );
  }

  const chips: { id: string; name: string }[] = [
    { id: "all", name: "Tout" },
    ...categories.map((c) => ({ id: c.id, name: c.name })),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="catalog-screen">
      {/* Sticky header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Catalogue</Text>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher un produit…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            testID="catalog-search-input"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {chips.map((c) => {
            const active = selectedCat === c.id;
            return (
              <Pressable
                key={c.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedCat(c.id)}
                testID={`catalog-chip-${c.id}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="basket-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>Aucun produit trouvé.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{
            paddingTop: spacing.md,
            paddingBottom: count > 0 ? 120 : spacing.xl,
            gap: spacing.md,
          }}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.duration(380).delay(Math.min(index, 8) * 40).springify().damping(18)}>
              <AnimatedPressable
                style={styles.card}
                scale={0.97}
                onPress={() => router.push(`/product/${item.id}`)}
                testID={`catalog-product-${item.id}`}
              >
              <Image source={{ uri: item.image }} style={styles.cardImage} contentFit="cover" />
              {item.coming_soon ? (
                <View style={styles.comingSoonTag}>
                  <Text style={styles.comingSoonText}>🚧 À venir</Text>
                </View>
              ) : item.promo ? (
                <View style={styles.promoTag}>
                  <Text style={styles.promoTagText}>Promo</Text>
                </View>
              ) : null}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.unit ? (
                  <Text style={styles.cardUnit}>{item.unit}</Text>
                ) : (
                  <Text style={styles.cardUnit} numberOfLines={1}>
                    {item.description}
                  </Text>
                )}
                <View style={styles.cardFooter}>
                  {item.coming_soon ? (
                    <Text style={[styles.cardPriceFrom, { color: "#A78BFA" }]}>Bientôt disponible</Text>
                  ) : (
                    <Text style={styles.cardPriceFrom}>dès {formatPrice(minVariantPrice(item))}</Text>
                  )}
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </View>
              </View>
            </AnimatedPressable>
            </Animated.View>
          )}
        />
      )}

      {count > 0 && (
        <AnimatedPressable
          style={styles.floatingCart}
          scale={0.97}
          haptic="medium"
          onPress={() => router.push("/(tabs)/cart")}
          testID="catalog-floating-cart"
        >
          <View style={styles.floatingCartLeft}>
            <View style={styles.floatingCartBadge}>
              <Text style={styles.floatingCartBadgeText}>{count}</Text>
            </View>
            <Text style={styles.floatingCartText}>Voir le panier</Text>
          </View>
          <Text style={styles.floatingCartTotal}>{formatPrice(total)}</Text>
        </AnimatedPressable>
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
    padding: spacing.lg,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerTitle: {
    fontSize: font.xxl,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base },
  chipsScroll: { marginTop: spacing.md, marginHorizontal: -spacing.lg },
  chipsRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurface, fontSize: font.base, fontWeight: "500" },
  chipTextActive: { color: colors.onBrandPrimary, fontWeight: "700" },
  card: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  cardImage: { width: "100%", height: 130 },
  promoTag: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  promoTagText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  comingSoonTag: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: "rgba(167,139,250,0.95)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  comingSoonText: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  cardBody: { padding: spacing.md, gap: 2 },
  cardTitle: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  cardUnit: { fontSize: font.sm, color: colors.muted },
  cardFooter: {
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardPrice: { fontSize: font.lg, fontWeight: "700", color: colors.brand },
  cardPriceFrom: { fontSize: font.base, fontWeight: "700", color: colors.brand },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { color: colors.muted, fontSize: font.base, marginTop: spacing.md },
  errorTitle: { color: colors.error, fontSize: font.lg, fontWeight: "600" },
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
});
