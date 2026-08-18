import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, Share, Modal, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Member = {
  user_id: string;
  name: string;
  email?: string;
  status: "pending" | "active";
  role?: string | null;
  athlete_roster_id?: string | null;
  athlete_name?: string | null;
};
type AthleteOpt = { roster_id: string; name: string };
const ROLE_LABEL: Record<string, string> = { parent: "Parent", coach: "Coach", staff: "Staff", athlete: "Athlete" };

export default function TeamMembersScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Member[]>([]);
  const [active, setActive] = useState<Member[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // assign-role modal state
  const [assignFor, setAssignFor] = useState<Member | null>(null);
  const [role, setRole] = useState<string>("");
  const [athletes, setAthletes] = useState<AthleteOpt[]>([]);
  const [pickedAthlete, setPickedAthlete] = useState<string | null>(null);
  const [newAthlete, setNewAthlete] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        api.get<{ code: string }>("/team/join-code"),
        api.get<{ pending: Member[]; active: Member[] }>("/team/members"),
      ]);
      setCode(c.data.code);
      setPending(m.data.pending || []);
      setActive(m.data.active || []);
    } catch (_e) { /* non-owner or error */ }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shareCode = useCallback(async () => {
    const msg = `Join our team on CheerPlanner!\n\n1) Download CheerPlanner & create an account.\n2) Open the Team tab → "Have a team code?"\n3) Enter code: ${code}\n\nA coach will then set you up.`;
    if (Platform.OS === "web") Alert.alert("Team code", code);
    else { try { await Share.share({ message: msg }); } catch { Alert.alert("Team code", code); } }
  }, [code]);

  const rotate = useCallback(() => {
    Alert.alert("New team code?", "The current code will stop working. Anyone already in the team stays.", [
      { text: "Cancel", style: "cancel" },
      { text: "Generate new", style: "destructive", onPress: async () => {
        try { const r = await api.post<{ code: string }>("/team/join-code/rotate", {}); setCode(r.data.code); }
        catch { Alert.alert("Error", "Couldn't rotate the code."); }
      } },
    ]);
  }, []);

  const openAssign = useCallback(async (m: Member) => {
    setAssignFor(m); setRole(""); setPickedAthlete(null); setNewAthlete("");
    try { const r = await api.get<{ athletes: AthleteOpt[] }>("/team/members/athletes"); setAthletes(r.data.athletes || []); }
    catch { setAthletes([]); }
  }, []);

  const submitAssign = useCallback(async () => {
    if (!assignFor || !role) return;
    const body: any = { role };
    if (role === "parent" || role === "athlete") {
      if (pickedAthlete) body.athlete_roster_id = pickedAthlete;
      else if (newAthlete.trim()) body.athlete_name = newAthlete.trim();
      else if (role === "parent") { Alert.alert("Pick an athlete", "Choose an existing athlete or type a new name."); return; }
    }
    setBusy(assignFor.user_id);
    try {
      await api.post(`/team/members/${assignFor.user_id}/assign-role`, body);
      setAssignFor(null);
      await load();
    } catch (e: any) { Alert.alert("Couldn't assign", e?.response?.data?.detail || "Please try again."); }
    finally { setBusy(null); }
  }, [assignFor, role, pickedAthlete, newAthlete, load]);

  const remove = useCallback((m: Member) => {
    Alert.alert(`Remove ${m.name}?`, m.status === "pending" ? "They won't join the team." : "They lose team & chat access.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        setBusy(m.user_id);
        try { await api.post(`/team/members/${m.user_id}/remove`, {}); await load(); }
        catch { Alert.alert("Error", "Couldn't remove."); }
        finally { setBusy(null); }
      } },
    ]);
  }, [load]);

  const needsAthlete = role === "parent" || role === "athlete";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="team-members-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Members</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Join code card */}
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>YOUR TEAM CODE</Text>
            <Text style={styles.codeValue} testID="team-code">{code || "——————"}</Text>
            <Text style={styles.codeHint}>Share this one code with your whole team. New members land below for you to set up.</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={styles.primaryBtn} onPress={shareCode} testID="share-code">
                <Ionicons name="share-outline" size={16} color="#fff" /><Text style={styles.primaryText}>Share code</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} onPress={rotate} testID="rotate-code">
                <Ionicons name="refresh-outline" size={16} color={colors.accent} /><Text style={styles.ghostText}>New code</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* New members (pending) */}
          <Text style={styles.sectionTitle}>New Members {pending.length > 0 && <Text style={styles.count}>({pending.length})</Text>}</Text>
          {pending.length === 0 ? (
            <Text style={styles.empty}>No one waiting. Shared members appear here to assign a role.</Text>
          ) : pending.map((m) => (
            <View key={m.user_id} style={styles.card} testID={`pending-${m.user_id}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{m.name}</Text>
                {!!m.email && <Text style={styles.sub}>{m.email}</Text>}
                <Text style={styles.subMuted}>Group chat only — assign a role</Text>
              </View>
              <View style={{ gap: 6, alignItems: "flex-end" }}>
                <TouchableOpacity style={styles.assignBtn} onPress={() => openAssign(m)} disabled={busy === m.user_id} testID={`assign-${m.user_id}`}>
                  {busy === m.user_id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.assignText}>Assign role</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(m)}><Text style={styles.removeText}>Remove</Text></TouchableOpacity>
              </View>
            </View>
          ))}

          {/* Active members */}
          {active.length > 0 && <Text style={styles.sectionTitle}>Team ({active.length})</Text>}
          {active.map((m) => (
            <View key={m.user_id} style={styles.card} testID={`active-${m.user_id}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{m.name}</Text>
                <Text style={styles.sub}>
                  {ROLE_LABEL[m.role || ""] || "Member"}{m.athlete_name ? ` · for ${m.athlete_name}` : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(m)} disabled={busy === m.user_id}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Assign role modal */}
      <Modal visible={!!assignFor} transparent animationType="fade" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setAssignFor(null)}>
          <Pressable style={styles.sheet} testID="assign-modal">
            <Text style={styles.sheetTitle}>Set up {assignFor?.name}</Text>
            <Text style={styles.sheetSub}>Choose a role:</Text>
            <View style={styles.roleRow}>
              {(["parent", "coach", "staff", "athlete"] as const).map((r) => (
                <TouchableOpacity key={r} style={[styles.roleChip, role === r && styles.roleChipOn]} onPress={() => setRole(r)} testID={`role-${r}`}>
                  <Text style={[styles.roleChipText, role === r && styles.roleChipTextOn]}>{ROLE_LABEL[r]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {needsAthlete && (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.sheetSub}>{role === "parent" ? "Link to which athlete?" : "Athlete's roster entry (optional)"}</Text>
                <ScrollView style={{ maxHeight: 150 }}>
                  {athletes.map((a) => (
                    <TouchableOpacity key={a.roster_id} style={styles.athRow} onPress={() => { setPickedAthlete(a.roster_id); setNewAthlete(""); }} testID={`ath-${a.roster_id}`}>
                      <Ionicons name={pickedAthlete === a.roster_id ? "radio-button-on" : "radio-button-off"} size={20} color={colors.accent} />
                      <Text style={styles.name}>{a.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TextInput
                  style={styles.input}
                  placeholder={role === "parent" ? "…or type a new athlete's name" : "…or type a new athlete's name"}
                  placeholderTextColor={colors.textTertiary}
                  value={newAthlete}
                  onChangeText={(t) => { setNewAthlete(t); if (t) setPickedAthlete(null); }}
                  testID="new-athlete-name"
                />
              </View>
            )}

            <TouchableOpacity style={[styles.primaryBtn, (!role || busy) && styles.disabled, { marginTop: 14, justifyContent: "center" }]} onPress={submitAssign} disabled={!role || !!busy} testID="assign-submit">
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Confirm</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAssignFor(null)} style={{ paddingVertical: 10, alignItems: "center" }}>
              <Text style={styles.removeText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { ...typography.h3, color: c.textPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, gap: spacing.md },
  codeCard: { backgroundColor: c.card, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: spacing.lg },
  codeLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: c.textSecondary },
  codeValue: { ...typography.h1, color: c.accent, letterSpacing: 4, marginTop: 4 },
  codeHint: { ...typography.caption, color: c.textSecondary, marginTop: 6, lineHeight: 18 },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 16 },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: c.accent, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 16 },
  ghostText: { color: c.accent, fontWeight: "800", fontSize: 14 },
  sectionTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, marginTop: 4 },
  count: { color: c.accent },
  empty: { ...typography.caption, color: c.textSecondary },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  name: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  sub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  subMuted: { ...typography.caption, color: c.textTertiary, marginTop: 2, fontStyle: "italic" },
  assignBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 14 },
  assignText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  removeText: { ...typography.caption, color: "#DC2626", fontWeight: "700" },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  sheet: { width: "100%", maxWidth: 440, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg },
  sheetTitle: { ...typography.h3, color: c.textPrimary },
  sheetSub: { ...typography.caption, color: c.textSecondary, marginTop: 8, marginBottom: 6 },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleChip: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  roleChipOn: { backgroundColor: c.accentSubtle, borderColor: c.accent },
  roleChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  roleChipTextOn: { color: c.accent },
  athRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.borderSoft },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, ...typography.body, color: c.textPrimary, marginTop: 8 },
  disabled: { opacity: 0.5 },
});
