import React, { useRef, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Plan a 90-minute Level 3 practice",
  "Drills to clean up a group standing tuck",
  "Fun team bonding ideas before Nationals",
  "How do I prep my team for competition week?",
];

export default function CoachAI() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="coach-ai-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>AI Coaching Assistant</Text>
          <Text style={styles.subtitle}>Cheer coaching help</Text>
        </View>
      </View>

      <ChatMode styles={styles} />
    </SafeAreaView>
  );
}

function ChatMode({ styles }: any) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const convId = useRef<string>("");
  const scroller = useRef<ScrollView>(null);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    try {
      const r = await api.post<{ answer: string; conversation_id: string }>("/team/coach-ai/chat", { message: q, conversation_id: convId.current });
      convId.current = r.data.conversation_id;
      setMessages((m) => [...m, { role: "assistant", content: r.data.answer }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: e?.response?.data?.detail || "Sorry, I couldn't answer just now. Please try again." }]);
    } finally {
      setLoading(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <ScrollView ref={scroller} contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
        {messages.length === 0 && (
          <View style={styles.welcome}>
            <View style={styles.welcomeIcon}><Ionicons name="sparkles" size={22} color={colors.accent} /></View>
            <Text style={styles.welcomeTitle}>Your cheer coaching co-pilot</Text>
            <Text style={styles.welcomeText}>Ask about skills, drills, practice plans, team bonding, athlete progression or competition prep.</Text>
            <View style={styles.suggWrap}>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity key={s} style={styles.sugg} onPress={() => send(s)} testID={`coach-ai-sugg`}>
                  <Text style={styles.suggText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleAI]}>
            <Text style={[styles.bubbleText, m.role === "user" && { color: "#fff" }]}>{m.content}</Text>
          </View>
        ))}
        {loading && <View style={[styles.bubble, styles.bubbleAI]}><ActivityIndicator color={colors.accent} /></View>}
      </ScrollView>
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask a cheer coaching question…"
          placeholderTextColor={colors.textTertiary}
          multiline
          testID="coach-ai-input"
        />
        <TouchableOpacity style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.5 }]} onPress={() => send()} disabled={!input.trim() || loading} testID="coach-ai-send">
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { ...typography.h3, color: c.textPrimary },
  subtitle: { ...typography.caption, color: c.textSecondary },
  tabs: { flexDirection: "row", gap: 8, padding: spacing.md, paddingBottom: spacing.sm },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  tabOn: { backgroundColor: c.accent, borderColor: c.accent },
  tabText: { ...typography.caption, fontWeight: "800", color: c.textSecondary },
  tabTextOn: { color: "#fff" },
  // Chat
  chatContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  welcome: { alignItems: "center", paddingVertical: spacing.lg, gap: 8 },
  welcomeIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center" },
  welcomeTitle: { ...typography.h3, color: c.textPrimary, marginTop: 4 },
  welcomeText: { ...typography.body, color: c.textSecondary, textAlign: "center" as const, lineHeight: 21, paddingHorizontal: spacing.md },
  suggWrap: { gap: 8, marginTop: spacing.md, width: "100%" },
  sugg: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12 },
  suggText: { ...typography.body, color: c.textPrimary },
  bubble: { maxWidth: "88%", borderRadius: radius.lg, padding: 12 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: c.accent, borderBottomRightRadius: 4 },
  bubbleAI: { alignSelf: "flex-start", backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 4 },
  bubbleText: { ...typography.body, color: c.textPrimary, lineHeight: 21 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg },
  input: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, ...typography.body, color: c.textPrimary, maxHeight: 120 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  // Flyer
  flyerContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  fInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, ...typography.body, color: c.textPrimary },
  genBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.lg },
  genText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  hint: { ...typography.caption, color: c.textTertiary, textAlign: "center" as const, marginTop: 8 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm, padding: 12, borderRadius: radius.md, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  errorText: { ...typography.caption, color: "#DC2626", flex: 1, fontWeight: "600" },
  uploadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: c.accent, borderStyle: "dashed" as const, borderRadius: radius.md, paddingVertical: 12 },
  uploadText: { ...typography.body, color: c.accent, fontWeight: "700" },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  logoThumb: { width: 80, height: 56, borderRadius: radius.sm, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  removeChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  removeChipText: { ...typography.caption, color: "#DC2626", fontWeight: "700" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoWrap: { position: "relative" as const },
  photoThumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  photoX: { position: "absolute" as const, top: -8, right: -8, backgroundColor: c.bg, borderRadius: 10 },
  photoAdd: { width: 72, height: 72, borderRadius: radius.sm, borderWidth: 1, borderColor: c.accent, borderStyle: "dashed" as const, alignItems: "center", justifyContent: "center" },
  styleHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  savedLink: { ...typography.caption, color: c.accent, fontWeight: "800", marginTop: spacing.md },
  autoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: spacing.md, padding: 12, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  autoTitle: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary },
  autoSub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  logoBtns: { flexDirection: "row", gap: 10 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: spacing.sm },
  deleteText: { ...typography.caption, color: "#DC2626", fontWeight: "700" },
  logoItem: { width: "30%" as const, aspectRatio: 1, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", padding: 6 },
  logoItemImg: { width: "100%" as const, height: "100%" as const },
  galleryDel: { position: "absolute" as const, top: 6, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(220,38,38,0.92)", alignItems: "center", justifyContent: "center" },
  galleryWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  gallerySheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.md, maxHeight: "80%" },
  galleryHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  galleryTitle: { ...typography.h3, color: c.textPrimary },
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingBottom: spacing.lg },
  galleryItem: { width: "47%" as const },
  galleryThumb: { width: "100%" as const, aspectRatio: 1, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  galleryLabel: { ...typography.caption, color: c.textPrimary, marginTop: 4, fontWeight: "600" },
  preview: { marginTop: spacing.lg, gap: 4 },
  flyerImg: { width: "100%", aspectRatio: 1, borderRadius: radius.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  postBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#16A34A", borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm },
});
