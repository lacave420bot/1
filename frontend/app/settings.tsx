import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

type Row = {
  id: string;
  label: string;
  sub?: string;
  icon: keyof typeof import("@expo/vector-icons/build/Ionicons").default.glyphMap;
  iconBg: string;
  iconFg: string;
  onPress: () => void;
};

export default function SettingsScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAdmin();

  const rows: Row[] = [
    {
      id: "admin",
      label: "Espace administrateur",
      sub: isAuthenticated
        ? "Connecté · gérer produits & catégories"
        : "Accès protégé par code PIN",
      icon: "shield-checkmark",
      iconBg: "#11233F",
      iconFg: "#7AB1FF",
      onPress: () =>
        router.push(isAuthenticated ? "/admin" : "/admin/login"),
    },
    {
      id: "about",
      label: "À propos",
      sub: "La Cave 420 · v1.0.0",
      icon: "information-circle",
      iconBg: "#1A1A2E",
      iconFg: "#B19CFF",
      onPress: () => {},
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="settings-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
          testID="settings-back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Réglages</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {rows.map((r) => (
          <Pressable
            key={r.id}
            style={styles.row}
            onPress={r.onPress}
            testID={`settings-row-${r.id}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: r.iconBg }]}>
              <Ionicons name={r.icon as any} size={20} color={r.iconFg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              {r.sub && <Text style={styles.rowSub}>{r.sub}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
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
  rowLabel: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
});
