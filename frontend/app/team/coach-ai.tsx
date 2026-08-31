import React, { useRef, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Image, Alert, KeyboardAvoidingView, Platform } from "react-native";
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

const FLYER_TYPES = [
  { key: "tryouts", label: "Tryouts" },
  { key: "competition", label: "Competition" },
  { key: "fundraiser", label: "Fundraiser" },
  { key: "event", label: "Event" },
];

export default function CoachAI() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [mode, setMode] = useState<"chat" | "flyer">("chat");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="coach-ai-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>AI Coaching Assistant</Text>
          <Text style={styles.subtitle}>Cheer coaching help & flyer designer</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(["chat", "flyer"] as const).map((m) => (
          <TouchableOpacity key={m} style={[styles.tab, mode === m && styles.tabOn]} onPress={() => setMode(m)} testID={`coach-ai-tab-${m}`}>
            <Ionicons name={m === "chat" ? "chatbubbles-outline" : "image-outline"} size={16} color={mode === m ? "#fff" : colors.textSecondary} />
            <Text style={[styles.tabText, mode === m && styles.tabTextOn]}>{m === "chat" ? "Ask" : "Flyer"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === "chat" ? <ChatMode styles={styles} /> : <FlyerMode styles={styles} />}
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

function FlyerMode({ styles }: any) {
  const [type, setType] = useState("tryouts");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [theme, setTheme] = useState("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [flyer, setFlyer] = useState<{ id: string; b64: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");

  const generate = async () => {
    if (!title.trim()) { setError("Give the flyer an event name."); return; }
    setLoading(true); setFlyer(null); setError("");
    try {
      const r = await api.post<{ flyer_id: string; image_base64: string }>("/team/coach-ai/flyer", {
        event_type: type, title: title.trim(), date: date.trim(), time: time.trim(), location: location.trim(), theme: theme.trim(), details: details.trim(),
      });
      setFlyer({ id: r.data.flyer_id, b64: r.data.image_base64 });
      setCaption(title.trim());
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Couldn't generate the flyer. Please try again.");
    } finally { setLoading(false); }
  };

  const postToChat = async () => {
    if (!flyer || posting) return;
    setPosting(true);
    try {
      await api.post(`/team/coach-ai/flyer/${flyer.id}/post-to-chat`, { caption: caption.trim() });
      Alert.alert("Posted", "Your flyer is now in Team Chat.");
    } catch (e: any) {
      Alert.alert("Couldn't post", e?.response?.data?.detail || "Please try again.");
    } finally { setPosting(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.flyerContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
        <Text style={styles.label}>Flyer type</Text>
        <View style={styles.chips}>
          {FLYER_TYPES.map((t) => (
            <TouchableOpacity key={t.key} style={[styles.chip, type === t.key && styles.chipOn]} onPress={() => setType(t.key)} testID={`flyer-type-${t.key}`}>
              <Text style={[styles.chipText, type === t.key && { color: "#fff" }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Event name</Text>
        <TextInput style={styles.fInput} value={title} onChangeText={setTitle} placeholder="e.g. Elite Cheer Tryouts 2026" placeholderTextColor={colors.textTertiary} testID="flyer-title" />
        <Text style={styles.label}>Date</Text>
        <TextInput style={styles.fInput} value={date} onChangeText={setDate} placeholder="e.g. Saturday, Aug 15" placeholderTextColor={colors.textTertiary} testID="flyer-date" />
        <Text style={styles.label}>Time</Text>
        <TextInput style={styles.fInput} value={time} onChangeText={setTime} placeholder="e.g. 10:00 AM – 2:00 PM" placeholderTextColor={colors.textTertiary} testID="flyer-time" />
        <Text style={styles.label}>Location</Text>
        <TextInput style={styles.fInput} value={location} onChangeText={setLocation} placeholder="e.g. Champion Gym, San Marcos" placeholderTextColor={colors.textTertiary} testID="flyer-location" />
        <Text style={styles.label}>Colors / theme (optional)</Text>
        <TextInput style={styles.fInput} value={theme} onChangeText={setTheme} placeholder="e.g. Navy & gold, bold and energetic" placeholderTextColor={colors.textTertiary} testID="flyer-theme" />
        <Text style={styles.label}>Anything else (optional)</Text>
        <TextInput style={[styles.fInput, { minHeight: 60, maxHeight: 120, textAlignVertical: "top" }]} value={details} onChangeText={setDetails} placeholder="e.g. Ages 6–18, no experience needed, register online" placeholderTextColor={colors.textTertiary} multiline testID="flyer-details" />

        <TouchableOpacity style={[styles.genBtn, loading && { opacity: 0.6 }]} onPress={generate} disabled={loading} testID="flyer-generate">
          {loading ? <ActivityIndicator color="#fff" /> : <><Ionicons name="sparkles" size={16} color="#fff" /><Text style={styles.genText}>{flyer ? "Regenerate flyer" : "Generate flyer"}</Text></>}
        </TouchableOpacity>
        {loading && <Text style={styles.hint}>Designing your flyer — this can take up to a minute.</Text>}
        {!!error && (
          <View style={styles.errorBox} testID="flyer-error">
            <Ionicons name="alert-circle-outline" size={16} color="#DC2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {flyer && (
          <View style={styles.preview}>
            <Image source={{ uri: `data:image/png;base64,${flyer.b64}` }} style={styles.flyerImg} resizeMode="cover" testID="flyer-image" />
            <Text style={styles.label}>Caption for chat (optional)</Text>
            <TextInput style={styles.fInput} value={caption} onChangeText={setCaption} placeholder="Add a message…" placeholderTextColor={colors.textTertiary} testID="flyer-caption" />
            <TouchableOpacity style={[styles.postBtn, posting && { opacity: 0.6 }]} onPress={postToChat} disabled={posting} testID="flyer-post">
              {posting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="chatbubbles" size={16} color="#fff" /><Text style={styles.genText}>Post to Team Chat</Text></>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
  preview: { marginTop: spacing.lg, gap: 4 },
  flyerImg: { width: "100%", aspectRatio: 1, borderRadius: radius.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  postBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#16A34A", borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm },
});
