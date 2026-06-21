import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { storage } from "@/src/utils/storage";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

const AGE_KEY = "age_verified_v1";

type AgeStatus = "pending" | "verified" | "rejected";

type AgeGateContextValue = {
  status: AgeStatus;
  confirm: () => void;
  reject: () => void;
  reset: () => void;
};

const AgeGateContext = createContext<AgeGateContextValue | null>(null);

export function useAgeGate() {
  const ctx = useContext(AgeGateContext);
  if (!ctx) throw new Error("useAgeGate must be used within AgeGateProvider");
  return ctx;
}

export function AgeGateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AgeStatus>("pending");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const v = (await storage.getItem(AGE_KEY, "")) as string;
      if (v === "yes") setStatus("verified");
      else setStatus("pending");
      setReady(true);
    })();
  }, []);

  const confirm = useCallback(() => {
    storage.setItem(AGE_KEY, "yes");
    setStatus("verified");
  }, []);

  const reject = useCallback(() => {
    setStatus("rejected");
  }, []);

  const reset = useCallback(() => {
    storage.removeItem(AGE_KEY);
    setStatus("pending");
  }, []);

  if (!ready) {
    return (
      <View style={styles.bootWrap} testID="age-gate-boot">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (status === "verified") {
    return (
      <AgeGateContext.Provider value={{ status, confirm, reject, reset }}>
        {children}
      </AgeGateContext.Provider>
    );
  }

  return (
    <AgeGateContext.Provider value={{ status, confirm, reject, reset }}>
      {status === "rejected" ? (
        <AgeGateRejected onRetry={() => setStatus("pending")} />
      ) : (
        <AgeGateScreen onConfirm={confirm} onReject={reject} />
      )}
    </AgeGateContext.Provider>
  );
}

function AgeGateScreen({
  onConfirm,
  onReject,
}: {
  onConfirm: () => void;
  onReject: () => void;
}) {
  const router = useRouter();
  return (
    <View style={styles.root} testID="age-gate-screen">
      <LinearGradient
        colors={["#0F1F12", "#1C1917"]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.iconWrap}>
          <Ionicons name="leaf" size={64} color="#22C55E" />
        </View>

        <Text style={styles.brand}>Verte Vallée CBD</Text>

        <View style={styles.divider} />

        <Text style={styles.title}>Avez-vous 18 ans ou plus ?</Text>
        <Text style={styles.subtitle}>
          L&apos;accès à cette boutique CBD est strictement réservé aux personnes
          majeures. Tous nos produits respectent la réglementation française
          (THC &lt; 0,3 %).
        </Text>

        <View style={styles.actions}>
          <Pressable
            style={styles.primaryBtn}
            onPress={onConfirm}
            testID="age-gate-confirm"
          >
            <Text style={styles.primaryBtnText}>
              Oui, j&apos;ai 18 ans ou plus
            </Text>
          </Pressable>
          <Pressable
            style={styles.secondaryBtn}
            onPress={onReject}
            testID="age-gate-reject"
          >
            <Text style={styles.secondaryBtnText}>Non, je suis mineur·e</Text>
          </Pressable>
        </View>

        <Text style={styles.legalNote}>
          En continuant, vous acceptez nos{" "}
          <Text
            style={styles.link}
            onPress={() => router.push("/legal?tab=cgv")}
            testID="age-gate-cgv-link"
          >
            Conditions générales
          </Text>{" "}
          et notre{" "}
          <Text
            style={styles.link}
            onPress={() => router.push("/legal?tab=privacy")}
            testID="age-gate-privacy-link"
          >
            Politique de confidentialité
          </Text>
          .
        </Text>
      </SafeAreaView>
    </View>
  );
}

function AgeGateRejected({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.root} testID="age-gate-rejected">
      <LinearGradient
        colors={["#1C0F0F", "#1C1917"]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={[styles.iconWrap, { backgroundColor: "rgba(239,68,68,0.15)" }]}>
          <Ionicons name="alert-circle-outline" size={64} color="#F87171" />
        </View>
        <Text style={styles.title}>Accès non autorisé</Text>
        <Text style={styles.subtitle}>
          Désolé, l&apos;accès à cette application est strictement réservé aux
          personnes majeures (18 ans et +).
        </Text>
        <Pressable
          style={styles.secondaryBtn}
          onPress={onRetry}
          testID="age-gate-retry"
        >
          <Text style={styles.secondaryBtnText}>Vérifier de nouveau</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bootWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  root: { flex: 1, backgroundColor: "#0F1F12" },
  safe: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(34,197,94,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: "#F5F5F4",
    fontSize: font.xl,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  divider: { width: 48, height: 2, backgroundColor: "#22C55E", borderRadius: 2 },
  title: {
    color: "#fff",
    fontSize: font.xxl,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: font.base,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 320,
  },
  actions: { width: "100%", gap: spacing.md, marginTop: spacing.lg },
  primaryBtn: {
    backgroundColor: "#22C55E",
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.floating,
  },
  primaryBtnText: { color: "#0F1F12", fontWeight: "800", fontSize: font.lg },
  secondaryBtn: {
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: "rgba(255,255,255,0.85)", fontWeight: "600", fontSize: font.base },
  legalNote: {
    color: "rgba(255,255,255,0.5)",
    fontSize: font.sm,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  link: { color: "#22C55E", textDecorationLine: "underline" },
});
