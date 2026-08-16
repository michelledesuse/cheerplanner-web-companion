import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Alert, Platform, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Athlete = {
  roster_id: string;
  name: string;
  is_minor: boolean;
  linked: boolean;
  chat_enabled: boolean;
  invite_code?: string | null;
  can_approve: boolean;
};

export default function ChatAccessScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ athletes: Athlete[] }>("/team/chat/athletes");
      setAthletes(r.data.athletes || []);
    } catch (_e) { setAthletes([]); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const invite = useCallback(async (a: Athlete) => {
    setBusy(a.roster_id);
    try {
      const r = await api.post<{ code: string }>(`/team/chat/athletes/${a.roster_id}/invite`, {});
      const code = r.data.code;
      const msg = `Invite code for ${a.name} to join Team Chat: ${code}\n\nHave them create a CheerPlanner account, then enter this code on the Team tab.`;
      if (Platform.OS === "web") { Alert.alert("Invite code", `${code}`); }
      else { try { await Share.share({ message: msg }); } catch { Alert.alert("Invite code", code); } }
      load();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not create invite"); }
    finally { setBusy(null); }
  }, [load]);

  const toggle = useCallback(async (a: Athlete, next: boolean) => {
    setBusy(a.roster_id);
    setAthletes((prev) => prev.map((x) => x.roster_id === a.roster_id ? { ...x, chat_enabled: next } : x));
    try {
      await api.post(`/team/chat/athletes/${a.roster_id}/approve`, { enabled: next });
    } catch (e: any) {
      setAthletes((prev) => prev.map((x) => x.roster_id === a.roster_id ? { ...x, chat_enabled: !next } : x));
      Alert.alert("Not allowed", e?.response?.data?.detail || "Only a parent/guardian can approve.");
    } finally { setBusy(null); load(); }
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="chat-access-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Chat access for athletes</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
          <Text style={styles.infoText}>
            Athletes chat in the same group as personnel (no private messages). A minor&apos;s chat stays OFF until their parent/guardian approves it, and a parent can always see the chat.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : athletes.length === 0 ? (
          <Text style={styles.empty}>No athletes on the roster yet.</Text>
        ) : athletes.map((a) => (
          <View key={a.roster_id} style={styles.card} testID={`chat-athlete-${a.roster_id}`}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{a.name}</Text>
                {a.is_minor && <View style={styles.minorTag}><Text style={styles.minorText}>MINOR</Text></View>}
              </View>
              <Text style={styles.status}>
                {!a.linked ? "Not set up yet" : a.chat_enabled ? "Chat approved" : "Awaiting parent approval"}
              </Text>
            </View>

            {!a.linked ? (
              <TouchableOpacity style={styles.inviteBtn} onPress={() => invite(a)} disabled={busy === a.roster_id} testID={`chat-invite-${a.roster_id}`}>
                {busy === a.roster_id ? <ActivityIndicator size="small" color="#fff" /> : (
                  <><Ionicons name="person-add-outline" size={15} color="#fff" /><Text style={styles.inviteText}>Invite</Text></>
                )}
              </TouchableOpacity>
            ) : (
              <Switch
                value={a.chat_enabled}
                onValueChange={(v) => toggle(a, v)}
                disabled={!a.can_approve || busy === a.roster_id}
                trackColor={{ true: colors.accent }}
                testID={`chat-approve-${a.roster_id}`}
              />
            )}
          </View>
        ))}
      </ScrollView>
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
  content: { padding: spacing.lg, gap: spacing.md },
  infoCard: {
    flexDirection: "row", gap: spacing.md, alignItems: "flex-start",
    backgroundColor: c.accentSubtle, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: c.accent + "33",
  },
  infoText: { ...typography.caption, color: c.textPrimary, flex: 1, lineHeight: 18 },
  empty: { ...typography.body, color: c.textSecondary, textAlign: "center", marginTop: 24 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: c.border,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  minorTag: { backgroundColor: c.cardSubtle, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  minorText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5, color: c.textSecondary },
  status: { ...typography.caption, color: c.textSecondary, marginTop: 3 },
  inviteBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 14 },
  inviteText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
