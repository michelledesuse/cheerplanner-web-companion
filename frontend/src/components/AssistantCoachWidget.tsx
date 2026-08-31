import React, { useRef, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Modal, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/context/ThemeContext";

type Msg = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "How do I RSVP to a team event?",
  "Where do I find my scouting report?",
  "How do I add an event to my calendar?",
];

// Persistent, app-wide "Assistant Coach" help widget. Available to every signed-in
// user; explains how to use CheerPlanner (role-aware) and declines off-topic asks.
export default function AssistantCoachWidget() {
  const { user } = useAuth();
  const { palette: c } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const convId = useRef<string>("");
  const scroller = useRef<ScrollView>(null);

  // Hide before login and on the full Team-Hub coach assistant (would be redundant).
  if (!user) return null;
  if (pathname.includes("coach-ai")) return null;

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    try {
      const r = await api.post<{ answer: string; conversation_id: string }>("/assistant/chat", { message: q, conversation_id: convId.current });
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
    <>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setOpen(true)}
        style={[styles.fab, { backgroundColor: c.accent, bottom: insets.bottom + 68, shadowColor: "#000" }]}
        testID="assistant-coach-fab"
        accessibilityLabel="Open Assistant Coach help"
      >
        <Ionicons name="help-buoy" size={26} color="#fff" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom }]} onPress={() => {}} testID="assistant-coach-sheet">
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <View style={[styles.headIcon, { backgroundColor: c.accentSubtle }]}><Ionicons name="help-buoy" size={18} color={c.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: c.textPrimary }]}>Assistant Coach</Text>
                <Text style={[styles.subtitle, { color: c.textSecondary }]}>How to use CheerPlanner</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10} testID="assistant-coach-close"><Ionicons name="close" size={24} color={c.textSecondary} /></TouchableOpacity>
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={10}>
              <ScrollView ref={scroller} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
                {messages.length === 0 && (
                  <View style={styles.welcome}>
                    <Text style={[styles.welcomeText, { color: c.textSecondary }]}>Hi! I can help you find your way around CheerPlanner. Ask me how to do something, or try:</Text>
                    {STARTERS.map((s) => (
                      <TouchableOpacity key={s} style={[styles.starter, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => send(s)} testID="assistant-coach-starter">
                        <Text style={[styles.starterText, { color: c.textPrimary }]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {messages.map((m, i) => (
                  <View key={i} style={[styles.bubble, m.role === "user" ? { alignSelf: "flex-end", backgroundColor: c.accent, borderBottomRightRadius: 4 } : { alignSelf: "flex-start", backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 4 }]}>
                    <Text style={[styles.bubbleText, { color: m.role === "user" ? "#fff" : c.textPrimary }]}>{m.content}</Text>
                  </View>
                ))}
                {loading && <View style={[styles.bubble, { alignSelf: "flex-start", backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}><ActivityIndicator color={c.accent} /></View>}
              </ScrollView>

              <View style={[styles.inputBar, { borderTopColor: c.border, backgroundColor: c.bg }]}>
                <TextInput
                  style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.textPrimary }]}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Ask how to use the app…"
                  placeholderTextColor={c.textTertiary}
                  multiline
                  testID="assistant-coach-input"
                />
                <TouchableOpacity style={[styles.send, { backgroundColor: c.accent, opacity: !input.trim() || loading ? 0.5 : 1 }]} onPress={() => send()} disabled={!input.trim() || loading} testID="assistant-coach-send">
                  <Ionicons name="arrow-up" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = {
  fab: { position: "absolute" as const, right: 16, width: 56, height: 56, borderRadius: 28, alignItems: "center" as const, justifyContent: "center" as const, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6, zIndex: 50 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" as const },
  sheet: { height: "82%" as const, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" as const },
  header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  headIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center" as const, justifyContent: "center" as const },
  title: { fontSize: 16, fontWeight: "800" as const },
  subtitle: { fontSize: 12 },
  content: { padding: 16, gap: 10 },
  welcome: { gap: 10 },
  welcomeText: { fontSize: 14, lineHeight: 20 },
  starter: { borderWidth: 1, borderRadius: 12, padding: 12 },
  starterText: { fontSize: 14, fontWeight: "600" as const },
  bubble: { maxWidth: "88%" as const, borderRadius: 14, padding: 12 },
  bubbleText: { fontSize: 14, lineHeight: 21 },
  inputBar: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 110 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center" as const, justifyContent: "center" as const },
};
