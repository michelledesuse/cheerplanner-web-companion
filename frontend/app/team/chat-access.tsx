import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Alert, Platform, Share, Modal, Pressable } from "react-native";
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
  const [familyFor, setFamilyFor] = useState<Athlete | null>(null);
  const [family, setFamily] = useState<{ user_id: string; name: string; email?: string; already_in_chat?: boolean }[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ athletes: Athlete[] }>("/team/chat/athletes");
      setAthletes(r.data.athletes || []);
    } catch (_e) { setAthletes([]); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openFamily = useCallback(async (a: Athlete) => {
    setFamilyFor(a);
    try { const r = await api.get("/team/chat/family-members"); setFamily(r.data.members || []); }
    catch (_e) { setFamily([]); }
  }, []);

  const linkMember = useCallback(async (a: Athlete, userId: string) => {
    setBusy(a.roster_id); setFamilyFor(null);
    try { await api.post(`/team/chat/athletes/${a.roster_id}/link-member`, { user_id: userId }); }
    catch (e: any) { Alert.alert("Couldn't add", e?.response?.data?.detail || "Please try again."); }
    finally { setBusy(null); load(); }
  }, [load]);

  const invite = useCallback(async (a: Athlete) => {
    setBusy(a.roster_id);
    try {
      const r = await api.post<{ code: string }>(`/team/chat/athletes/${a.roster_id}/invite`, {});
      const code = r.data.code;
      const msg = `Invite code for ${a.name} to join Team Chat: ${code}\n\nSteps: 1) Create a CheerPlanner account (or log in). 2) Open the Team tab and tap "Manage access". 3) Enter this code. A parent/guardian then approves chat with ParentGuard.`;
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
        <Text style={styles.title}>🛡️ ParentGuard</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
          <Text style={styles.infoText}>
            <Text style={{ fontWeight: "800" }}>ParentGuard</Text> keeps youth chat safe: athletes chat in the same group as personnel (no private messages), and a minor&apos;s chat stays OFF until their parent/guardian approves it — and a parent can always see the chat. Parent-approved. Parent-connected.
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
                {a.is_minor && <Ionicons name="shield-checkmark" size={15} color={colors.accent} testID={`parentguard-shield-${a.roster_id}`} />}
                {a.is_minor && <View style={styles.minorTag}><Text style={styles.minorText}>MINOR</Text></View>}
              </View>
              <Text style={styles.status}>
                {!a.linked ? "Not set up yet" : a.chat_enabled ? "Chat approved" : "Awaiting parent approval"}
              </Text>
            </View>

            {!a.linked ? (
              <View style={{ gap: 6, alignItems: "flex-end" }}>
                <TouchableOpacity style={styles.inviteBtn} onPress={() => invite(a)} disabled={busy === a.roster_id} testID={`chat-invite-${a.roster_id}`}>
                  {busy === a.roster_id ? <ActivityIndicator size="small" color="#fff" /> : (
                    <><Ionicons name="person-add-outline" size={15} color="#fff" /><Text style={styles.inviteText}>Invite</Text></>
                  )}
                </TouchableOpacity>
                {a.can_approve && (
                  <TouchableOpacity onPress={() => openFamily(a)} testID={`chat-addfamily-${a.roster_id}`}>
                    <Text style={styles.linkExisting}>Add family member</Text>
                  </TouchableOpacity>
                )}
              </View>
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

      {/* Pick an existing family-account login to add as a chat athlete */}
      <Modal visible={!!familyFor} transparent animationType="fade" onRequestClose={() => setFamilyFor(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setFamilyFor(null)}>
          <View style={styles.sheet} testID="chat-family-modal">
            <Text style={styles.sheetTitle}>Add {familyFor?.name} to chat</Text>
            <Text style={styles.sheetSub}>Choose their existing family-account login:</Text>
            {family.filter((f) => !f.already_in_chat).length === 0 ? (
              <Text style={styles.status}>No available family logins. Use Invite instead.</Text>
            ) : family.filter((f) => !f.already_in_chat).map((f) => (
              <TouchableOpacity key={f.user_id} style={styles.familyRow} onPress={() => familyFor && linkMember(familyFor, f.user_id)} testID={`chat-family-${f.user_id}`}>
                <Ionicons name="person-circle-outline" size={22} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{f.name}{f.is_owner ? " (owner)" : ""}</Text>
                  {!!f.email && <Text style={styles.status}>{f.email}</Text>}
                </View>
                <Ionicons name="add-circle" size={22} color={colors.accent} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setFamilyFor(null)} style={styles.familyRow}>
              <Text style={[styles.status, { fontWeight: "700" }]}>Cancel</Text>
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
  linkExisting: { ...typography.caption, color: c.accent, fontWeight: "700" },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg, gap: 4 },
  sheetTitle: { ...typography.h3, color: c.textPrimary },
  sheetSub: { ...typography.caption, color: c.textSecondary, marginBottom: 6 },
  familyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.borderSoft },
});
