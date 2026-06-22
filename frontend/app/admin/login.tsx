import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdmin } from "@/src/store/admin";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

export default function AdminLoginScreen() {
  const router = useRouter();
  const { login } = useAdmin();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (pin.length < 4) {
      setError("Le PIN doit comporter au moins 4 chiffres.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await login(pin);
      router.replace("/admin");
    } catch (e: any) {
      setError(e?.message || "Erreur de connexion.");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-login-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
          testID="admin-login-back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Connexion admin</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={48} color={colors.brand} />
          </View>
          <Text style={styles.title}>Entrez votre code PIN</Text>
          <Text style={styles.subtitle}>
            Accès réservé à l&apos;administrateur de la boutique.
          </Text>

          <TextInput
            value={pin}
            onChangeText={(t) => {
              setPin(t.replace(/[^0-9]/g, "").slice(0, 8));
              setError(null);
            }}
            keyboardType="number-pad"
            secureTextEntry
            style={styles.pinInput}
            placeholder="••••"
            placeholderTextColor={colors.muted}
            maxLength={8}
            autoFocus
            testID="admin-pin-input"
          />

          {error && (
            <Text style={styles.errorText} testID="admin-login-error">
              {error}
            </Text>
          )}

          <Pressable
            style={[styles.cta, (loading || pin.length < 4) && styles.ctaDisabled]}
            onPress={submit}
            disabled={loading || pin.length < 4}
            testID="admin-pin-submit"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>Se connecter</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  body: {
    flex: 1,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  title: {
    color: colors.onSurface,
    fontSize: font.xxl,
    fontWeight: "800",
    marginTop: spacing.md,
  },
  subtitle: { color: colors.muted, fontSize: font.base, textAlign: "center" },
  pinInput: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    fontSize: font.xxl,
    color: colors.onSurface,
    textAlign: "center",
    letterSpacing: 16,
    minWidth: 220,
    marginTop: spacing.lg,
  },
  errorText: { color: colors.error, fontSize: font.base, fontWeight: "600" },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.brand,
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    minWidth: 220,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: font.lg },
});
