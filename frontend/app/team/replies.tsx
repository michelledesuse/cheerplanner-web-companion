import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Platform, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Reply = { id: string; phone: string; body: string; member_name?: string | null; created_at?: string };

function fmt(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function RepliesScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Reply[]>("/team/replies");
      setItems(r.data || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reply = (phone: string) => {
    if (Platform.OS === "web") { Alert.alert("Open on your phone", "Replying opens your Messages app."); return; }
    const clean = "+" + String(phone).replace(/[^\d]/g, "");
    Linking.openURL(`sms:${clean}`).catch(() => Alert.alert("Couldn't open Messages"));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="replies-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Replies</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyText}>No replies yet.</Text>
              <Text style={styles.emptyHint}>When a parent texts your Twilio number back, it shows up here.</Text>
            </View>
          ) : items.map((m) => (
            <TouchableOpacity key={m.id} style={styles.card} onPress={() => reply(m.phone)} testID={`reply-${m.id}`}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{m.member_name || m.phone}</Text>
                <Text style={styles.date}>{fmt(m.created_at)}</Text>
              </View>
              <Text style={styles.body}>{m.body}</Text>
              <View style={styles.replyHint}>
                <Ionicons name="arrow-undo-outline" size={13} color={colors.accent} />
                <Text style={styles.replyHintText}>Tap to reply</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary },
  empty: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyText: { ...typography.body, color: c.textSecondary },
  emptyHint: { ...typography.caption, color: c.textTertiary, textAlign: "center", paddingHorizontal: 30 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  name: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  date: { ...typography.caption, color: c.textTertiary },
  body: { ...typography.body, color: c.textPrimary },
  replyHint: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  replyHintText: { ...typography.caption, color: c.accent, fontWeight: "700" },
});
