import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Msg = {
  id: string;
  sender_id: string;
  sender_name: string;
  text?: string;
  media?: { kind: string; name?: string }[];
  created_at: string;
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ChildChatScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ roster_id?: string; name?: string }>();
  const rosterId = String(params.roster_id || "");
  const paramName = String(params.name || "your athlete");

  const [messages, setMessages] = useState<Msg[]>([]);
  const [name, setName] = useState(paramName);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ athlete_name: string; chat_enabled: boolean; messages: Msg[] }>(
        `/team/chat/athletes/${rosterId}/messages`
      );
      setMessages(r.data.messages || []);
      setEnabled(!!r.data.chat_enabled);
      if (r.data.athlete_name) setName(r.data.athlete_name);
    } catch (_e) {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [rosterId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const firstName = (name || "").split(" ")[0] || name;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="child-chat-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>🛡️ {firstName}'s Team Chat</Text>
          <Text style={styles.subtitle}>Read-only • parent view</Text>
        </View>
      </View>

      <View style={styles.banner}>
        <Ionicons name="eye-outline" size={16} color={colors.accent} />
        <Text style={styles.bannerText}>
          You're viewing {firstName}'s supervised team chat. Minors chat only in this group thread — no private messages — and you can see everything here.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : !enabled ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="lock-closed-outline" size={30} color={colors.textTertiary} />
          <Text style={styles.empty}>Chat isn't approved for {firstName} yet.</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubbles-outline" size={30} color={colors.textTertiary} />
          <Text style={styles.empty}>No messages in the team chat yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {messages.map((m) => (
            <View key={m.id} style={styles.msg} testID={`child-msg-${m.id}`}>
              <View style={styles.msgHead}>
                <Text style={styles.sender}>{m.sender_name || "Member"}</Text>
                <Text style={styles.time}>{fmtTime(m.created_at)}</Text>
              </View>
              {!!m.text && <Text style={styles.body}>{m.text}</Text>}
              {(m.media || []).map((md, i) => (
                <View key={i} style={styles.mediaPill}>
                  <Ionicons name="attach-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.mediaText}>{md.name || md.kind}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
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
  title: { ...typography.h3, color: c.textPrimary },
  subtitle: { ...typography.caption, color: c.textSecondary },
  banner: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-start",
    backgroundColor: c.accentSubtle, margin: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: c.accent + "33",
  },
  bannerText: { ...typography.caption, color: c.textPrimary, flex: 1, lineHeight: 18 },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  msg: { backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  msgHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sender: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  time: { fontSize: 11, color: c.textTertiary },
  body: { ...typography.body, color: c.textPrimary },
  mediaPill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, alignSelf: "flex-start", backgroundColor: c.cardSubtle, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  mediaText: { ...typography.caption, color: c.textSecondary },
  emptyWrap: { alignItems: "center", justifyContent: "center", marginTop: 48, gap: 10, padding: spacing.lg },
  empty: { ...typography.body, color: c.textSecondary, textAlign: "center" },
});
