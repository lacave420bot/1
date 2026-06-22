import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
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

type Chat = { id: string; type?: string; title?: string };

export default function AdminTelegramScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAdmin();
  const [tokenInput, setTokenInput] = useState("");
  const [chatId, setChatId] = useState("");
  const [maskedToken, setMaskedToken] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await api.adminGetTelegram();
      setMaskedToken(cfg.bot_token_masked);
      setChatId(cfg.chat_id || "");
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadConfig(); }, [loadConfig]));

  if (!isAuthenticated) { router.replace("/admin/login"); return null; }

  const saveToken = async () => {
    if (!tokenInput.trim()) {
      setMsg({ kind: "err", text: "Collez le token du bot puis enregistrez." });
      return;
    }
    try {
      setSaving(true); setMsg(null);
      await api.adminSaveTelegram(tokenInput.trim(), chatId);
      setTokenInput("");
      await loadConfig();
      setMsg({ kind: "ok", text: "Token enregistré." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setSaving(false); }
  };

  const saveChatId = async (newId: string) => {
    try {
      setSaving(true); setMsg(null);
      await api.adminSaveTelegram("", newId); // empty token = keep existing in backend
      setChatId(newId);
      setMsg({ kind: "ok", text: "Chat sélectionné." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setSaving(false); }
  };

  // Helper used by manual save button
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _saveBoth = async () => {
    try {
      setSaving(true); setMsg(null);
      await api.adminSaveTelegram(tokenInput.trim() || maskedToken /*keep*/, chatId);
      // If token field was used, we sent it. Otherwise we still send the masked value which backend will overwrite.
      // To avoid that, just call with empty token to keep existing.
      if (!tokenInput.trim()) {
        await api.adminSaveTelegram("", chatId);
      }
      setTokenInput("");
      await loadConfig();
      setMsg({ kind: "ok", text: "Enregistré." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setSaving(false); }
  };

  const discover = async () => {
    try {
      setDiscovering(true); setMsg(null); setChats([]);
      const res = await api.adminDiscoverChats();
      setChats(res.chats);
      if (res.chats.length === 0) {
        setMsg({
          kind: "err",
          text: "Aucune conversation détectée. Envoyez d'abord un message à votre bot depuis Telegram, puis réessayez.",
        });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setDiscovering(false); }
  };

  const sendTest = async () => {
    try {
      setTesting(true); setMsg(null);
      await api.adminTestTelegram();
      setMsg({ kind: "ok", text: "Message de test envoyé ! Vérifiez Telegram 📨" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setTesting(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-telegram-screen">
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications Telegram</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">

          {/* Step 1: token */}
          <View style={styles.section}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
              <Text style={styles.sectionTitle}>Token du bot</Text>
            </View>
            <Text style={styles.help}>
              Ouvrez Telegram → @BotFather → /mybots → choisissez votre bot → API Token. Copiez ce texte (ex : 123456789:AAB…) et collez-le ci-dessous.
            </Text>
            {loading ? (
              <ActivityIndicator color={colors.brand} />
            ) : maskedToken ? (
              <View style={styles.savedRow}>
                <Ionicons name="checkmark-circle" size={20} color="#4ADE80" />
                <Text style={styles.savedText}>Token enregistré : {maskedToken}</Text>
              </View>
            ) : null}
            <TextInput
              value={tokenInput}
              onChangeText={setTokenInput}
              placeholder="123456789:AABBCC..."
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
              style={styles.input}
              testID="tg-token-input"
            />
            <Pressable
              style={[styles.btn, (!tokenInput.trim() || saving) && { opacity: 0.5 }]}
              disabled={!tokenInput.trim() || saving}
              onPress={saveToken}
              testID="tg-token-save"
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Enregistrer le token</Text>}
            </Pressable>
          </View>

          {/* Step 2: discover chat */}
          <View style={styles.section}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
              <Text style={styles.sectionTitle}>Choisir le chat</Text>
            </View>
            <Text style={styles.help}>
              Sur Telegram, envoyez d{`'`}abord <Text style={styles.codeInline}>/start</Text> à votre bot (juste un message, n{`'`}importe lequel). Puis appuyez sur {`"`}Détecter{`"`} ci-dessous.
            </Text>
            <Pressable
              style={[styles.btnSecondary, discovering && { opacity: 0.5 }]}
              onPress={discover}
              disabled={discovering || !maskedToken}
              testID="tg-discover"
            >
              {discovering ? <ActivityIndicator color={colors.brand} /> : (
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                  <Ionicons name="search" size={18} color={colors.brand} />
                  <Text style={styles.btnSecondaryText}>Détecter mes conversations</Text>
                </View>
              )}
            </Pressable>

            {chats.length > 0 && (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {chats.map((c) => {
                  const active = chatId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      style={[styles.chatRow, active && { borderColor: colors.brand, backgroundColor: colors.brandSecondary }]}
                      onPress={() => saveChatId(c.id)}
                      testID={`tg-chat-${c.id}`}
                    >
                      <Ionicons
                        name={c.type === "private" ? "person-circle" : "people-circle"}
                        size={28}
                        color={active ? colors.brand : colors.muted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.chatTitle}>{c.title || "Sans titre"}</Text>
                        <Text style={styles.chatSub}>{c.type === "private" ? "Conversation privée" : c.type} · ID {c.id}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={22} color={colors.brand} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {chatId !== "" && (
              <View style={styles.savedRow}>
                <Ionicons name="checkmark-circle" size={20} color="#4ADE80" />
                <Text style={styles.savedText}>Chat sélectionné : {chatId}</Text>
              </View>
            )}
          </View>

          {/* Step 3: test */}
          <View style={styles.section}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
              <Text style={styles.sectionTitle}>Tester</Text>
            </View>
            <Text style={styles.help}>
              Envoyez un message de test à votre Telegram pour vérifier que tout fonctionne.
            </Text>
            <Pressable
              style={[styles.btn, (testing || !maskedToken || !chatId) && { opacity: 0.5 }]}
              onPress={sendTest}
              disabled={testing || !maskedToken || !chatId}
              testID="tg-test"
            >
              {testing ? <ActivityIndicator color="#fff" /> : (
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                  <Ionicons name="paper-plane" size={18} color="#fff" />
                  <Text style={styles.btnText}>Envoyer un message de test</Text>
                </View>
              )}
            </Pressable>
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
  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  stepNumText: { color: "#fff", fontWeight: "800", fontSize: font.base },
  sectionTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800" },
  help: { color: colors.muted, fontSize: font.sm, lineHeight: 20 },
  codeInline: { color: colors.brand, fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  savedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#0F2A20", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: "#1A4D38" },
  savedText: { color: "#A7F3D0", fontSize: font.sm, fontWeight: "600", flex: 1 },
  btn: { backgroundColor: colors.brand, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  btnText: { color: "#fff", fontWeight: "800", fontSize: font.base },
  btnSecondary: { height: 48, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.brand, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  btnSecondaryText: { color: colors.brand, fontWeight: "700", fontSize: font.base },
  chatRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chatTitle: { color: colors.onSurface, fontWeight: "700", fontSize: font.base },
  chatSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  msg: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: "flex-start" },
  msgOk: { backgroundColor: "#0F2A20", borderWidth: 1, borderColor: "#1A4D38" },
  msgErr: { backgroundColor: "#3F1414", borderWidth: 1, borderColor: "#7F1D1D" },
  msgText: { flex: 1, fontSize: font.sm, fontWeight: "600" },
});
