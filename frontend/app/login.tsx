import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useCart } from "@/src/store/cart";
import { useUser } from "@/src/store/user";
import { colors, font, radius, shadows, spacing } from "@/src/theme";

type Phase = "idle" | "waiting" | "approved" | "error";

export default function LoginScreen() {
  const router = useRouter();
  const { guestId } = useCart();
  const { signIn, isAuthenticated, user, signOut } = useUser();

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tgUrl, setTgUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- cleanup ----
  const stopTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
  }, []);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const cancelFlow = useCallback(() => {
    stopTimers();
    setPhase("idle");
    setTgUrl(null);
    setErrorMsg(null);
    setSecondsLeft(0);
  }, [stopTimers]);

  // ---- main: start a new login attempt ----
  const startLogin = async () => {
    try {
      setErrorMsg(null);
      setPhase("waiting");
      const res = await api.authStartTelegram(guestId || "");
      setTgUrl(res.telegram_url);
      setSecondsLeft(res.expires_in);

      // Try to open Telegram immediately
      try { await Linking.openURL(res.telegram_url); } catch { /* user may not have telegram */ }

      // Tick a UI countdown
      tickerRef.current = setInterval(() => {
        setSecondsLeft((s) => Math.max(0, s - 1));
      }, 1000);

      // Poll the backend
      pollRef.current = setInterval(async () => {
        try {
          const check = await api.authCheckTelegram(res.token);
          if (check.status === "approved") {
            stopTimers();
            await signIn(check.token, check.user);
            setPhase("approved");
            // Give the user a brief moment to see the success state, then close
            setTimeout(() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/home");
            }, 1200);
          } else if (check.status === "expired" || check.status === "invalid") {
            stopTimers();
            setPhase("error");
            setErrorMsg("Le lien a expiré. Veuillez réessayer.");
          }
        } catch {
          // Silent retry on transient errors
        }
      }, 2000);
    } catch (e: any) {
      setPhase("error");
      setErrorMsg(e?.message || "Impossible de démarrer la connexion.");
    }
  };

  const reopenTelegram = async () => {
    if (tgUrl) {
      try { await Linking.openURL(tgUrl); } catch { /* noop */ }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="login-screen">
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
          hitSlop={8}
          testID="login-close"
        >
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Connexion</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        {/* Already logged-in: profile card + logout */}
        {isAuthenticated && user ? (
          <View style={styles.profileCard}>
            <View style={styles.profileAvatar}>
              <Ionicons name="person" size={36} color="#fff" />
            </View>
            <Text style={styles.profileName}>Bonjour {user.name || "à toi"} 👋</Text>
            {!!user.telegram_username && (
              <Text style={styles.profileMeta}>@{user.telegram_username}</Text>
            )}
            <Text style={styles.profileSub}>Vous êtes connecté avec Telegram.</Text>
            <Pressable
              style={[styles.btn, styles.btnDanger]}
              onPress={async () => { await signOut(); cancelFlow(); }}
              testID="login-signout"
            >
              <Ionicons name="log-out-outline" size={18} color="#fff" />
              <Text style={styles.btnText}>Se déconnecter</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Hero */}
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Ionicons name="paper-plane" size={42} color="#fff" />
              </View>
              <Text style={styles.heroTitle}>Connexion sans mot de passe</Text>
              <Text style={styles.heroSub}>
                Aucune création de compte — connectez-vous en 2 secondes via Telegram.
              </Text>
            </View>

            {/* Phase: idle */}
            {phase === "idle" && (
              <View style={styles.section}>
                <Step n={1} text="Appuyez sur le bouton ci-dessous." />
                <Step n={2} text="Telegram s'ouvre sur notre bot — tapez « DÉMARRER »." />
                <Step n={3} text="Vous serez automatiquement connecté ici 🎉" />
                <Pressable
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={startLogin}
                  testID="login-start-btn"
                >
                  <Ionicons name="paper-plane" size={18} color="#fff" />
                  <Text style={styles.btnText}>Se connecter avec Telegram</Text>
                </Pressable>
                <Text style={styles.footerNote}>
                  Pas de Telegram ? Vous pouvez aussi passer commande en mode invité depuis le panier.
                </Text>
              </View>
            )}

            {/* Phase: waiting */}
            {phase === "waiting" && (
              <View style={styles.section}>
                <View style={styles.waitingIcon}>
                  <ActivityIndicator size="large" color={colors.brand} />
                </View>
                <Text style={styles.waitingTitle}>En attente de Telegram…</Text>
                <Text style={styles.waitingSub}>
                  Une fenêtre Telegram a dû s&apos;ouvrir. Tapez « DÉMARRER » pour confirmer.
                </Text>
                <View style={styles.timerPill}>
                  <Ionicons name="time-outline" size={14} color={colors.muted} />
                  <Text style={styles.timerText}>
                    Expire dans {Math.floor(secondsLeft / 60)}m {String(secondsLeft % 60).padStart(2, "0")}s
                  </Text>
                </View>
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={reopenTelegram}
                  testID="login-reopen"
                >
                  <Ionicons name="open-outline" size={18} color={colors.brand} />
                  <Text style={[styles.btnText, { color: colors.brand }]}>Rouvrir Telegram</Text>
                </Pressable>
                <Pressable
                  onPress={cancelFlow}
                  hitSlop={8}
                  testID="login-cancel"
                  style={{ alignSelf: "center", marginTop: spacing.md }}
                >
                  <Text style={styles.linkText}>Annuler</Text>
                </Pressable>
              </View>
            )}

            {/* Phase: approved */}
            {phase === "approved" && (
              <View style={styles.section}>
                <View style={styles.successIcon}>
                  <Ionicons name="checkmark" size={48} color="#fff" />
                </View>
                <Text style={styles.successTitle}>Connecté !</Text>
                <Text style={styles.waitingSub}>Vous êtes maintenant connecté.</Text>
              </View>
            )}

            {/* Phase: error */}
            {phase === "error" && (
              <View style={styles.section}>
                <View style={styles.errorIcon}>
                  <Ionicons name="alert" size={36} color="#fff" />
                </View>
                <Text style={styles.errorTitle}>Une erreur est survenue</Text>
                {!!errorMsg && <Text style={styles.errorMsg}>{errorMsg}</Text>}
                <Pressable
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={startLogin}
                  testID="login-retry"
                >
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.btnText}>Réessayer</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    ...shadows.card,
  },
  headerTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  body: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.lg },

  hero: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.sm },
  heroIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "#2AABEE",
    alignItems: "center", justifyContent: "center",
    transform: [{ rotate: "-15deg" }],
    marginBottom: spacing.sm,
  },
  heroTitle: { fontSize: font.xxl, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  heroSub: { color: colors.muted, fontSize: font.base, textAlign: "center", paddingHorizontal: spacing.lg },

  section: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepNum: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  stepNumText: { color: "#fff", fontWeight: "800", fontSize: font.sm },
  stepText: { flex: 1, color: colors.onSurface, fontSize: font.base, fontWeight: "500" },

  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.sm, height: 50, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
  },
  btnPrimary: { backgroundColor: "#2AABEE" },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.brand },
  btnDanger: { backgroundColor: "#7F1D1D" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: font.base },

  footerNote: { color: colors.muted, fontSize: font.sm, textAlign: "center", marginTop: spacing.sm },

  waitingIcon: { alignItems: "center", paddingVertical: spacing.md },
  waitingTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800", textAlign: "center" },
  waitingSub: { color: colors.muted, fontSize: font.base, textAlign: "center", paddingHorizontal: spacing.sm },
  timerPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "center",
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  timerText: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  linkText: { color: colors.muted, fontSize: font.base, textDecorationLine: "underline" },

  successIcon: {
    alignSelf: "center",
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "#16A34A",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  successTitle: { textAlign: "center", color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },

  errorIcon: {
    alignSelf: "center",
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#DC2626",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  errorTitle: { textAlign: "center", color: colors.onSurface, fontSize: font.lg, fontWeight: "800" },
  errorMsg: { textAlign: "center", color: colors.error, fontSize: font.base },

  profileCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  profileAvatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.xs,
  },
  profileName: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  profileMeta: { color: colors.muted, fontSize: font.base },
  profileSub: { color: colors.muted, fontSize: font.sm, textAlign: "center", marginBottom: spacing.md },
});
