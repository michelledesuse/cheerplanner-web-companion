import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Member = { id: string; name: string; role: string; team_ids?: string[] | null };
type Session = { id: string; title: string; date?: string | null; season_ids?: string[]; records: Record<string, string> };
type Status = "present" | "absent" | "excused" | "tardy";

const STATUSES: { key: Status; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "present", label: "P", icon: "checkmark" },
  { key: "tardy", label: "T", icon: "time" },
  { key: "absent", label: "A", icon: "close" },
  { key: "excused", label: "E", icon: "remove" },
];

export default function AttendanceSessionScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [records, setRecords] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await api.get<Session>(`/team/attendance/${params.id}`);
      const sid = s.data.season_ids?.[0];
      const [r, tr] = await Promise.all([
        api.get<Member[]>("/roster", { params: sid ? { season_id: sid } : {} }),
        api.get<{ id: string; name: string }[]>("/teams").catch(() => ({ data: [] as any })),
      ]);
      setSession(s.data);
      setRecords(s.data.records || {});
      setMembers(r.data.filter((m) => m.role !== "parent"));
      setTeams(tr.data || []);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not load session.");
      router.back();
    } finally { setLoading(false); }
  }, [params.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const mark = async (memberId: string, status: Status) => {
    const current = records[memberId];
    const next = current === status ? undefined : status; // tapping active status clears it
    setRecords((prev) => {
      const n = { ...prev };
      if (next) n[memberId] = next; else delete n[memberId];
      return n;
    });
    try {
      await api.put(`/team/attendance/${params.id}/mark`, { member_id: memberId, status: next ?? null });
    } catch { load(); }
  };

  const markAllPresent = async () => {
    const visible = filtered.map((m) => m.id);
    setRecords((prev) => { const n = { ...prev }; visible.forEach((id) => { n[id] = "present"; }); return n; });
    try {
      await Promise.all(visible.map((id) => api.put(`/team/attendance/${params.id}/mark`, { member_id: id, status: "present" })));
    } catch { load(); }
  };

  const remove = () => {
    Alert.alert("Delete session?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/team/attendance/${params.id}`); router.back(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  const filtered = members.filter((m) => {
    if (teamFilter === null) return true;
    if (teamFilter === "none") return !(m.team_ids && m.team_ids.length);
    return (m.team_ids || []).includes(teamFilter);
  });
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  const present = filtered.filter((m) => records[m.id] === "present").length;

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="att-session-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{session?.title}</Text>
          <Text style={styles.headerSub}>{present}/{filtered.length} present</Text>
        </View>
        <TouchableOpacity onPress={() => router.push({ pathname: "/team/attendance-new", params: { id: String(params.id) } })} style={styles.iconBtn} testID="att-session-edit" hitSlop={8}>
          <Ionicons name="create-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={remove} style={styles.iconBtn} testID="att-session-delete" hitSlop={8}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {teams.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.teamChips}>
          {[{ id: null as any, name: "All" }, ...teams, { id: "none", name: "No team" }].map((t) => {
            const active = teamFilter === t.id;
            return (
              <TouchableOpacity key={String(t.id)} onPress={() => setTeamFilter(t.id)} style={[styles.teamChip, active && styles.teamChipOn]} testID={`att-team-${t.id ?? "all"}`}>
                <Text style={[styles.teamChipText, active && styles.teamChipTextOn]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} testID="att-session-list">
        {sorted.length === 0 ? (
          <Text style={styles.empty}>No one on the roster{teamFilter ? " for this team" : ""} yet.</Text>
        ) : (
          <>
            <TouchableOpacity style={styles.allPresentBtn} onPress={markAllPresent} testID="att-mark-all">
              <Ionicons name="checkmark-done" size={16} color={colors.accent} />
              <Text style={styles.allPresentText}>Mark all present</Text>
            </TouchableOpacity>
            {sorted.map((m) => {
              const status = records[m.id];
              return (
                <View key={m.id} style={styles.row} testID={`att-row-${m.id}`}>
                  <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
                  <View style={styles.statusRow}>
                    {STATUSES.map((s) => {
                      const on = status === s.key;
                      return (
                        <TouchableOpacity
                          key={s.key}
                          onPress={() => mark(m.id, s.key)}
                          style={[styles.statusBtn, on && styles[`${s.key}On` as const]]}
                          testID={`att-mark-${m.id}-${s.key}`}
                        >
                          <Ionicons name={s.icon} size={16} color={on ? "white" : colors.textSecondary} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h3, color: c.textPrimary },
  headerSub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  teamChips: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 8, alignItems: "center" },
  teamChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, minHeight: 34, justifyContent: "center" },
  teamChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  teamChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  teamChipTextOn: { color: "white" },
  allPresentBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent, marginBottom: spacing.md },
  allPresentText: { ...typography.bodyMedium, color: c.accent, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.sm },
  name: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700", flex: 1 },
  statusRow: { flexDirection: "row", gap: 8 },
  statusBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.bg, borderWidth: 1, borderColor: c.border },
  presentOn: { backgroundColor: c.success || c.accent, borderColor: c.success || c.accent },
  tardyOn: { backgroundColor: c.accent, borderColor: c.accent },
  absentOn: { backgroundColor: c.danger, borderColor: c.danger },
  excusedOn: { backgroundColor: c.warningText, borderColor: c.warningText },
  empty: { ...typography.caption, color: c.textSecondary, textAlign: "center", marginTop: spacing.xl },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  editSheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  editTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  editLabel: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  editInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  editSave: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  editSaveText: { color: "white", fontWeight: "800", fontSize: 15 },
});
