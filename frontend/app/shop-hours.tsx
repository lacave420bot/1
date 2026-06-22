import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, type ShopHoursResponse, type WeeklyHours } from "@/src/api";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

const DAYS: { key: keyof WeeklyHours; label: string }[] = [
  { key: "monday", label: "Lundi" },
  { key: "tuesday", label: "Mardi" },
  { key: "wednesday", label: "Mercredi" },
  { key: "thursday", label: "Jeudi" },
  { key: "friday", label: "Vendredi" },
  { key: "saturday", label: "Samedi" },
  { key: "sunday", label: "Dimanche" },
];

export default function PublicShopHoursScreen() {
  const router = useRouter();
  const [data, setData] = useState<ShopHoursResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getShopHours();
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const todayKey = DAYS[(new Date().getDay() + 6) % 7].key; // Monday=0..Sunday=6

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="public-shop-hours">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Horaires</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading && !data ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}>
          {data?.status && (
            <View style={[styles.statusCard, data.status.is_open ? styles.statusCardOpen : styles.statusCardClosed]}>
              <Ionicons
                name={data.status.is_open ? "checkmark-circle" : "close-circle"}
                size={32}
                color={data.status.is_open ? "#4ADE80" : "#FCA5A5"}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>
                  {data.status.is_open ? "🟢 Boutique ouverte" : "🔴 Boutique fermée"}
                </Text>
                <Text style={styles.statusSubtitle}>{data.status.reason}</Text>
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Horaires hebdomadaires</Text>
            {DAYS.map(({ key, label }) => {
              const h = data?.hours?.[key];
              const isToday = key === todayKey;
              const open = h?.open;
              const close = h?.close;
              return (
                <View key={key} style={[styles.dayRow, isToday && styles.dayRowToday]}>
                  <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                    {label}{isToday ? " · aujourd'hui" : ""}
                  </Text>
                  <Text style={[styles.dayValue, !open && styles.dayValueClosed]}>
                    {open && close ? `${open} — ${close}` : "Fermé"}
                  </Text>
                </View>
              );
            })}
          </View>

          {(data?.closures || []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fermetures à venir</Text>
              {(data?.closures || []).map((c) => (
                <View key={c.id} style={styles.closureRow}>
                  <Ionicons name="calendar-outline" size={16} color="#FCA5A5" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.closureDates}>
                      {c.start_date === c.end_date
                        ? `Le ${c.start_date}`
                        : `Du ${c.start_date} au ${c.end_date}`}
                    </Text>
                    {!!c.reason && <Text style={styles.closureReason}>{c.reason}</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  statusCardOpen: { backgroundColor: "#0F2A20", borderColor: "#1A4D38" },
  statusCardClosed: { backgroundColor: "#2A1414", borderColor: "#5C1F1F" },
  statusTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  statusSubtitle: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  section: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  sectionTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700", marginBottom: spacing.xs },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  dayRowToday: { backgroundColor: "rgba(122,177,255,0.06)", borderRadius: radius.sm, paddingHorizontal: spacing.sm },
  dayLabel: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  dayLabelToday: { color: "#7AB1FF", fontWeight: "800" },
  dayValue: { color: colors.onSurface, fontSize: font.base, fontVariant: ["tabular-nums"] },
  dayValueClosed: { color: colors.muted, fontStyle: "italic" },
  closureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  closureDates: { color: colors.onSurface, fontWeight: "700" },
  closureReason: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
});
