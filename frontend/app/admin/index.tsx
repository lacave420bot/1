import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function AdminIndex() {
  const router = useRouter();
  const { logout, isAuthenticated } = useAdmin();

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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  title: { color: colors.onSurface, fontSize: font.xl, fontWeight: "700" },
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
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
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
