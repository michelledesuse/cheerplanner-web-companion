import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, Platform, Modal, Pressable, ScrollView, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at: string;
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

function dayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}

export default function TeamChatScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]); // ascending (oldest first)
  const [me, setMe] = useState<string>("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [supervised, setSupervised] = useState(false);
  const [guidelinesOk, setGuidelinesOk] = useState(true);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const focused = useRef(false);

  const markRead = useCallback(async () => {
    try { await api.post("/team/chat/read", {}); } catch (_e) {}
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ messages: Message[]; me: string; has_more: boolean; supervised: boolean; guidelines_accepted: boolean }>("/team/chat/messages?limit=40");
      setMessages(r.data.messages || []);
      setGuidelinesOk(!!r.data.guidelines_accepted);
      setMe(r.data.me || "");
      setHasMore(!!r.data.has_more);
      setSupervised(!!r.data.supervised);
    } catch (_e) {}
    finally { setLoading(false); }
    if (focused.current) markRead();
  }, [markRead]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    load();
    return () => { focused.current = false; };
  }, [load]));
  useRealtimeRefetch(load);

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const before = messages[0].created_at;
      const r = await api.get<{ messages: Message[]; has_more: boolean }>(
        `/team/chat/messages?limit=40&before=${encodeURIComponent(before)}`,
      );
      setMessages((prev) => [...(r.data.messages || []), ...prev]);
      setHasMore(!!r.data.has_more);
    } catch (_e) {}
    finally { setLoadingOlder(false); }
  }, [hasMore, loadingOlder, messages]);

  const acceptGuidelines = useCallback(async () => {
    try { await api.post("/team/chat/accept-guidelines", {}); setGuidelinesOk(true); setShowGuidelines(false); }
    catch (_e) {}
  }, []);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (!guidelinesOk) { setShowGuidelines(true); return; }
    setSending(true);
    setText("");
    try {
      const r = await api.post<Message>("/team/chat/messages", { text: body });
      setMessages((prev) => (prev.some((m) => m.id === r.data.id) ? prev : [...prev, r.data]));
    } catch (e: any) {
      setText(body); // restore on failure
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 403 && detail === "guidelines_not_accepted") setShowGuidelines(true);
      else if (status === 400) Alert.alert("Message blocked", detail || "That message isn't allowed.");
    } finally { setSending(false); }
  }, [text, sending, guidelinesOk]);

  const reportMsg = useCallback(async (m: Message) => {
    setActionMsg(null);
    try { await api.post(`/team/chat/messages/${m.id}/flag`, { reason: "reported from chat" }); Alert.alert("Reported", "Thanks — our team will review this message."); load(); }
    catch (_e) { Alert.alert("Error", "Could not report this message."); }
  }, [load]);

  const blockUser = useCallback(async (m: Message) => {
    setActionMsg(null);
    try { await api.post("/team/chat/block", { user_id: m.sender_id }); load(); }
    catch (_e) { Alert.alert("Error", "Could not block this member."); }
  }, [load]);

  const deleteMsg = useCallback(async (m: Message) => {
    setActionMsg(null);
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    try { await api.delete(`/team/chat/messages/${m.id}`); } catch (_e) { load(); }
  }, [load]);

  // Inverted list wants newest first.
  const data = useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const mine = item.sender_id === me;
    // In the inverted (newest-first) array, the "older" neighbour is index+1.
    const older = data[index + 1];
    const showDay = !older || dayLabel(older.created_at) !== dayLabel(item.created_at);
    return (
      <View>
        {showDay && (
          <View style={styles.dayRow}><Text style={styles.dayText}>{dayLabel(item.created_at)}</Text></View>
        )}
        <Pressable
          onLongPress={() => setActionMsg(item)}
          delayLongPress={300}
          style={[styles.bubbleRow, mine ? styles.rowRight : styles.rowLeft]}
          testID={`chat-msg-${item.id}`}
        >
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
            {!mine && <Text style={styles.senderName}>{item.sender_name}</Text>}
            <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{item.text}</Text>
            <Text style={[styles.timeText, mine && { color: "#DBEAFE" }]}>{fmtTime(item.created_at)}</Text>
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="team-chat-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Team Chat</Text>
          <Text style={styles.sub}>For coaches, reps &amp; staff</Text>
        </View>
        {!supervised && (
          <TouchableOpacity onPress={() => router.push("/team/chat-access" as any)} hitSlop={10} style={styles.backBtn} testID="chat-manage-access">
            <Ionicons name="people-outline" size={22} color={colors.accent} />
          </TouchableOpacity>
        )}
      </View>

      {supervised && (
        <View style={styles.supervisedBar} testID="chat-supervised-banner">
          <Ionicons name="shield-checkmark" size={14} color={colors.accent} />
          <Text style={styles.supervisedText}>A parent/guardian can see this chat.</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "translate-with-padding"}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : data.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="chatbubbles-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>Say hello to your team personnel 👋</Text>
          </View>
        ) : (
          <FlatList
            data={data}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onEndReached={loadOlder}
            onEndReachedThreshold={0.2}
            ListFooterComponent={loadingOlder ? <ActivityIndicator style={{ marginVertical: 12 }} color={colors.accent} /> : null}
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Message the team…"
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
            testID="chat-input"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
            onPress={send}
            disabled={!text.trim() || sending}
            testID="chat-send"
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Community guidelines agreement (Apple 1.2) */}
      <Modal visible={showGuidelines} transparent animationType="fade" onRequestClose={() => setShowGuidelines(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet} testID="chat-guidelines-modal">
            <Text style={styles.sheetTitle}>Community guidelines</Text>
            <ScrollView style={{ maxHeight: 260 }}>
              <Text style={styles.guideText}>
                To keep Team Chat safe for everyone — including minors — you agree to:{"\n\n"}
                • Be respectful. No harassment, hate speech, threats, or bullying.{"\n"}
                • No sexual, violent, or otherwise objectionable content.{"\n"}
                • No spam or sharing others&apos; private info.{"\n\n"}
                Messages that break these rules can be reported and removed, and abusive members can be blocked or removed. Objectionable content and abusive users will not be tolerated.
              </Text>
            </ScrollView>
            <TouchableOpacity style={styles.acceptBtn} onPress={acceptGuidelines} testID="chat-accept-guidelines">
              <Text style={styles.acceptText}>I agree</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowGuidelines(false)} style={{ paddingVertical: 8 }}>
              <Text style={styles.cancelText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Message actions: report / block / delete */}
      <Modal visible={!!actionMsg} transparent animationType="fade" onRequestClose={() => setActionMsg(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setActionMsg(null)}>
          <View style={styles.sheet} testID="chat-actions-modal">
            {actionMsg && actionMsg.sender_id === me ? (
              <TouchableOpacity style={styles.actionRow} onPress={() => deleteMsg(actionMsg)} testID="chat-action-delete">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text style={[styles.actionText, { color: "#DC2626" }]}>Delete my message</Text>
              </TouchableOpacity>
            ) : actionMsg ? (
              <>
                <TouchableOpacity style={styles.actionRow} onPress={() => reportMsg(actionMsg)} testID="chat-action-report">
                  <Ionicons name="flag-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.actionText}>Report message</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionRow} onPress={() => blockUser(actionMsg)} testID="chat-action-block">
                  <Ionicons name="ban-outline" size={18} color="#DC2626" />
                  <Text style={[styles.actionText, { color: "#DC2626" }]}>Block {actionMsg.sender_name}</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity onPress={() => setActionMsg(null)} style={styles.actionRow}>
              <Ionicons name="close-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { padding: 4 },
  supervisedBar: {
    flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center",
    backgroundColor: c.accentSubtle, paddingVertical: 6, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  supervisedText: { ...typography.caption, color: c.accent, fontWeight: "700" },
  title: { ...typography.h3, color: c.textPrimary },
  sub: { ...typography.caption, color: c.textSecondary, marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  emptyTitle: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700", marginTop: 8 },
  emptyText: { ...typography.caption, color: c.textSecondary },
  listContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  dayRow: { alignItems: "center", marginVertical: 10 },
  dayText: {
    ...typography.caption, color: c.textSecondary, backgroundColor: c.cardSubtle,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: "hidden", fontWeight: "700",
  },
  bubbleRow: { flexDirection: "row", marginVertical: 3 },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: c.accent, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 4 },
  senderName: { ...typography.caption, color: c.accent, fontWeight: "800", marginBottom: 2 },
  bubbleText: { ...typography.body, color: c.textPrimary },
  timeText: { fontSize: 10, color: c.textTertiary, marginTop: 3, alignSelf: "flex-end" },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg,
  },
  input: {
    flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border, borderRadius: radius.lg,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, ...typography.body, color: c.textPrimary,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent,
    alignItems: "center", justifyContent: "center",
  },
  sendBtnOff: { opacity: 0.45 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg, gap: 6 },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  guideText: { ...typography.body, color: c.textPrimary, lineHeight: 20 },
  acceptBtn: { backgroundColor: c.accent, borderRadius: radius.lg, paddingVertical: 13, alignItems: "center", marginTop: 10 },
  acceptText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelText: { ...typography.caption, color: c.textSecondary, textAlign: "center", fontWeight: "700" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.borderSoft },
  actionText: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "600" },
});
