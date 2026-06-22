import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function AdminChangePinScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAdmin();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (!isAuthenticated) { router.replace("/admin/login"); return null; }

  const submit = async () => {
    setMsg(null);
    if (newPin.length < 4) {
      setMsg({ kind: "err", text: "Le nouveau PIN doit comporter entre 4 et 8 chiffres." });
      return;
    }
    if (newPin !== confirmPin) {
      setMsg({ kind: "err", text: "Les deux nouveaux PIN ne correspondent pas." });
      return;
    }
    try {
      setSaving(true);
      await api.adminChangePin(currentPin, newPin);
      setMsg({ kind: "ok", text: "PIN modifié avec succès. Conservez-le en lieu sûr." });
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-change-pin-screen">
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Changer le PIN</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
          <View style={styles.iconCircle}>
            <Ionicons name="key" size={36} color={colors.brand} />
          </View>

          <Text style={styles.help}>
            Choisissez un nouveau PIN entre <Text style={styles.bold}>4 et 8 chiffres</Text>. Il sera demandé à chaque connexion admin.
          </Text>

          <View style={{ gap: 4 }}>
            <Text style={styles.label}>PIN actuel</Text>
            <TextInput
              value={currentPin}
              onChangeText={(t) => setCurrentPin(t.replace(/[^0-9]/g, "").slice(0, 8))}
              keyboardType="number-pad"
              secureTextEntry
              style={styles.input}
              placeholder="••••"
              placeholderTextColor={colors.muted}
              maxLength={8}
              testID="change-pin-current"
            />
          </View>

          <View style={{ gap: 4 }}>
            <Text style={styles.label}>Nouveau PIN (4 à 8 chiffres)</Text>
            <TextInput
              value={newPin}
              onChangeText={(t) => setNewPin(t.replace(/[^0-9]/g, "").slice(0, 8))}
              keyboardType="number-pad"
              secureTextEntry
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              maxLength={8}
              testID="change-pin-new"
            />
          </View>

          <View style={{ gap: 4 }}>
            <Text style={styles.label}>Confirmer le nouveau PIN</Text>
            <TextInput
              value={confirmPin}
              onChangeText={(t) => setConfirmPin(t.replace(/[^0-9]/g, "").slice(0, 8))}
              keyboardType="number-pad"
              secureTextEntry
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              maxLength={8}
              testID="change-pin-confirm"
            />
          </View>

          {msg && (
            <View style={[styles.msg, msg.kind === "ok" ? styles.msgOk : styles.msgErr]}>
              <Ionicons
                name={msg.kind === "ok" ? "checkmark-circle" : "alert-circle"}
                size={18}
                color={msg.kind === "ok" ? "#4ADE80" : "#FCA5A5"}
              />
              <Text style={[styles.msgText, { color: msg.kind === "ok" ? "#4ADE80" : "#FCA5A5" }]}>
                {msg.text}
              </Text>
            </View>
          )}

          <Pressable
            style={[styles.cta, (saving || !currentPin || !newPin || !confirmPin) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={saving || !currentPin || !newPin || !confirmPin}
            testID="change-pin-submit"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Enregistrer le nouveau PIN</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", ...shadows.card },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  iconCircle: { alignSelf: "center", width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  help: { color: colors.muted, fontSize: font.sm, lineHeight: 20, textAlign: "center" },
  bold: { color: colors.onSurface, fontWeight: "700" },
  label: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: font.xl, color: colors.onSurface, textAlign: "center", letterSpacing: 8, fontWeight: "700" },
  msg: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: "flex-start" },
  msgOk: { backgroundColor: "#0F2A20", borderWidth: 1, borderColor: "#1A4D38" },
  msgErr: { backgroundColor: "#3F1414", borderWidth: 1, borderColor: "#7F1D1D" },
  msgText: { flex: 1, fontSize: font.sm, fontWeight: "600" },
  cta: { backgroundColor: colors.brand, height: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: font.lg },
});
