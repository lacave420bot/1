import { useEffect, useState, useCallback, type PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/src/api";
import { colors, font, radius, spacing } from "@/src/theme";

const STORAGE_KEY = "site_access_token";

function getStoredPin(): string | null {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    return localStorage.getItem(STORAGE_KEY);
  }
  return null;
}

function storePin(pin: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, pin);
  }
}

export function SiteAccessGate({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getSiteAccessConfig();
        if (!res.enabled) {
          setUnlocked(true);
          setLoading(false);
          return;
        }
        setEnabled(true);
        // Check stored pin
        const stored = getStoredPin();
        if (stored) {
          const verify = await api.verifySiteAccess(stored);
          if (verify.valid) {
            setUnlocked(true);
            setLoading(false);
            return;
          }
        }
        setLoading(false);
      } catch {
        // If API fails, let them through
        setUnlocked(true);
        setLoading(false);
      }
    })();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!pin.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.verifySiteAccess(pin.trim());
      if (res.valid) {
        storePin(pin.trim());
        setUnlocked(true);
      }
    } catch {
      setError("Code d'accès incorrect");
    } finally {
      setSubmitting(false);
    }
  }, [pin]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (unlocked || !enabled) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>Accès privé</Text>
        <Text style={styles.subtitle}>
          Entrez le code d'accès pour accéder au site
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Code d'accès"
          placeholderTextColor={colors.muted}
          value={pin}
          onChangeText={setPin}
          secureTextEntry
          autoFocus
          onSubmitEditing={handleSubmit}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Entrer</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
  },
  icon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: font.xl,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: font.sm,
    color: colors.muted,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  input: {
    width: "100%",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: font.base,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  error: {
    color: colors.error,
    fontSize: font.sm,
    marginBottom: spacing.md,
  },
  button: {
    width: "100%",
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: font.base,
    fontWeight: "600",
  },
});
