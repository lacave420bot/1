import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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

function ManualChatIdInput({
  picker,
  currentValue,
  onSubmit,
}: {
  picker: "orders" | "alerts";
  currentValue: string;
  onSubmit: (v: string) => void;
}) {
  const [val, setVal] = useState("");
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
      <TextInput
        value={val}
        onChangeText={setVal}
        placeholder={picker === "orders" ? "ex : -100123456789" : "ex : -100987654321"}
        placeholderTextColor={colors.muted}
        keyboardType="default"
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { flex: 1 }]}
        testID="tg-manual-chatid"
      />
      <Pressable
        style={[styles.smallBtn, (!val.trim() || val.trim() === currentValue) && { opacity: 0.5 }]}
        disabled={!val.trim() || val.trim() === currentValue}
        onPress={() => { onSubmit(val.trim()); setVal(""); }}
        testID="tg-manual-chatid-save"
      >
        <Text style={styles.smallBtnText}>OK</Text>
      </Pressable>
    </View>
  );
}

export default function AdminTelegramScreen() {
  const router = useRouter();
  const { isAuthenticated, ready: adminReady } = useAdmin();
  const [tokenInput, setTokenInput] = useState("");
  const [chatId, setChatId] = useState("");
  const [alertsChatId, setAlertsChatId] = useState("");
  const [maskedToken, setMaskedToken] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatPicker, setChatPicker] = useState<"orders" | "alerts">("orders");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [settingUpWebhook, setSettingUpWebhook] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await api.adminGetTelegram();
      setMaskedToken(cfg.bot_token_masked);
      setChatId(cfg.chat_id || "");
      setAlertsChatId(cfg.alerts_chat_id || "");
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadConfig(); }, [loadConfig]));

  useEffect(() => {
    if (adminReady && !isAuthenticated) router.replace("/admin/login");
  }, [adminReady, isAuthenticated, router]);

  if (!adminReady || !isAuthenticated) { return null; }

  const saveToken = async () => {
    if (!tokenInput.trim()) {
      setMsg({ kind: "err", text: "Collez le token du bot puis enregistrez." });
      return;
    }
    try {
      setSaving(true); setMsg(null);
      await api.adminSaveTelegram(tokenInput.trim(), chatId, alertsChatId);
      setTokenInput("");
      await loadConfig();
      setMsg({ kind: "ok", text: "Token enregistré." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setSaving(false); }
  };

  const selectChat = async (newId: string) => {
    try {
      setSaving(true); setMsg(null);
      if (chatPicker === "alerts") {
        await api.adminSaveTelegram("", chatId, newId);
        setAlertsChatId(newId);
        setMsg({ kind: "ok", text: "Canal d'alertes sélectionné." });
      } else {
        await api.adminSaveTelegram("", newId, alertsChatId);
        setChatId(newId);
        setMsg({ kind: "ok", text: "Chat principal sélectionné." });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setSaving(false); }
  };

  const clearAlertsChat = async () => {
    try {
      setSaving(true); setMsg(null);
      await api.adminSaveTelegram("", chatId, "");
      setAlertsChatId("");
      setMsg({ kind: "ok", text: "Canal d'alertes désactivé (les alertes iront sur le chat principal)." });
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

  const setupWebhook = async () => {
    try {
      setSettingUpWebhook(true); setMsg(null);
      await api.adminSetupTelegramWebhook();
      setMsg({
        kind: "ok",
        text: "Boutons rapides activés ✅ Vous pouvez maintenant cliquer sur ✅ Terminer / ❌ Annuler directement dans Telegram.",
      });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Erreur" });
    } finally { setSettingUpWebhook(false); }
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
              <Text style={styles.sectionTitle}>Choisir le(s) chat(s)</Text>
            </View>

            {/* Tabs always visible — explains which chat goes where */}
            <View style={styles.pickerTabs}>
              <Pressable
                style={[styles.pickerTab, chatPicker === "orders" && styles.pickerTabActive]}
                onPress={() => setChatPicker("orders")}
                testID="tg-picker-orders"
              >
                <Ionicons name="cart" size={14} color={chatPicker === "orders" ? "#fff" : colors.muted} />
                <Text style={[styles.pickerTabText, chatPicker === "orders" && { color: "#fff" }]}>
                  Commandes
                </Text>
              </Pressable>
              <Pressable
                style={[styles.pickerTab, chatPicker === "alerts" && styles.pickerTabActive]}
                onPress={() => setChatPicker("alerts")}
                testID="tg-picker-alerts"
              >
                <Ionicons name="warning" size={14} color={chatPicker === "alerts" ? "#fff" : colors.muted} />
                <Text style={[styles.pickerTabText, chatPicker === "alerts" && { color: "#fff" }]}>
                  Alertes stock
                </Text>
              </Pressable>
            </View>
            <Text style={styles.help}>
              {chatPicker === "orders"
                ? "Choisissez le chat qui recevra les nouvelles commandes."
                : "Choisissez le canal qui recevra les alertes de stock bas (optionnel). Laissez vide pour utiliser le chat des commandes."}
            </Text>

            {/* Currently saved chats display */}
            <View style={{ gap: spacing.xs }}>
              {chatId !== "" && (
                <View style={styles.savedRow}>
                  <Ionicons name="cart" size={18} color="#4ADE80" />
                  <Text style={styles.savedText}>Commandes → {chatId}</Text>
                </View>
              )}
              {alertsChatId !== "" && (
                <View style={styles.savedRow}>
                  <Ionicons name="warning" size={18} color="#FBBF24" />
                  <Text style={styles.savedText}>Alertes stock → {alertsChatId}</Text>
                  <Pressable onPress={clearAlertsChat} hitSlop={6} testID="tg-clear-alerts">
                    <Ionicons name="close-circle" size={20} color={colors.muted} />
                  </Pressable>
                </View>
              )}
            </View>

            {/* Manual chat id entry */}
            <ManualChatIdInput
              picker={chatPicker}
              currentValue={chatPicker === "orders" ? chatId : alertsChatId}
              onSubmit={(v) => selectChat(v)}
            />

            {/* Auto-detect */}
            <Text style={styles.helpSmall}>
              Astuce : envoyez n{`'`}importe quel message à votre bot dans le chat ou canal cible, puis appuyez sur Détecter.
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
                  const active = chatPicker === "alerts" ? alertsChatId === c.id : chatId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      style={[styles.chatRow, active && { borderColor: colors.brand, backgroundColor: colors.brandSecondary }]}
                      onPress={() => selectChat(c.id)}
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

          {/* Step 4: enable inline buttons */}
          <View style={styles.section}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>4</Text></View>
              <Text style={styles.sectionTitle}>Boutons rapides ⚡</Text>
            </View>
            <Text style={styles.help}>
              Activez les boutons « ✅ Terminer » et « ❌ Annuler » directement dans Telegram. Vous gérez vos commandes sans ouvrir l&apos;app !
            </Text>
            <Pressable
              style={[styles.btn, (settingUpWebhook || !maskedToken || !chatId) && { opacity: 0.5 }]}
              onPress={setupWebhook}
              disabled={settingUpWebhook || !maskedToken || !chatId}
              testID="tg-setup-webhook"
            >
              {settingUpWebhook ? <ActivityIndicator color="#fff" /> : (
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                  <Ionicons name="flash" size={18} color="#fff" />
                  <Text style={styles.btnText}>Activer les boutons rapides</Text>
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
  pickerTabs: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    padding: 4,
  },
  pickerTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  pickerTabActive: { backgroundColor: colors.brand },
  pickerTabText: { color: colors.muted, fontSize: font.sm, fontWeight: "700" },
  helpSmall: { color: colors.muted, fontSize: font.sm, fontStyle: "italic", marginTop: spacing.xs },
  smallBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
  },
  smallBtnText: { color: "#fff", fontWeight: "800", fontSize: font.sm },
  msg: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: "flex-start" },
  msgOk: { backgroundColor: "#0F2A20", borderWidth: 1, borderColor: "#1A4D38" },
  msgErr: { backgroundColor: "#3F1414", borderWidth: 1, borderColor: "#7F1D1D" },
  msgText: { flex: 1, fontSize: font.sm, fontWeight: "600" },
});
