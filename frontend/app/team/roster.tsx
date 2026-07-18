import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type RosterMember = {
  id: string; name: string; role: string;
  first_name?: string | null; last_name?: string | null;
  phone?: string | null; email?: string | null;
  parent_first_name?: string | null; parent_last_name?: string | null;
  parent_phone?: string | null; parent_email?: string | null;
  team_ids?: string[] | null; notes?: string | null; source?: string; linked_id?: string | null;
};
type Candidate = { id: string; name: string; role?: string; email?: string | null; team_id?: string | null };

const ROLE_LABEL: Record<string, string> = {
  athlete: "Athlete", parent: "Parent", coach: "Coach", team_rep: "Team Rep", staff: "Staff",
};

// Grouping: 1) Coaches, 2) Staff & Reps, 3) Athletes. Parents are not listed.
const ROLE_GROUP: Record<string, number> = { coach: 1, staff: 2, team_rep: 2, athlete: 3 };
const GROUP_TITLES: { g: number; title: string }[] = [
  { g: 1, title: "Coaches" },
  { g: 2, title: "Staff & Reps" },
  { g: 3, title: "Athletes" },
];

export default function RosterScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string; color?: string | null }[]>([]);
  const [teamFilter, setTeamFilter] = useState<string | null>(null); // null=all, "none"=unassigned
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cands, setCands] = useState<{ athletes: Candidate[]; members: Candidate[] }>({ athletes: [], members: [] });
  const [picked, setPicked] = useState<{ ath: Set<string>; mem: Set<string> }>({ ath: new Set(), mem: new Set() });
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, tr] = await Promise.all([
        api.get<RosterMember[]>("/roster"),
        api.get<{ id: string; name: string; color?: string | null }[]>("/teams").catch(() => ({ data: [] as any })),
      ]);
      setMembers(r.data);
      setTeams(tr.data || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const teamName = (id?: string | null) => teams.find((t) => t.id === id)?.name;

  // Exclude parents, expand each person once per team, then filter by the
  // selected team chip. "All teams" shows a person once per team they're on.
  type Row = { member: RosterMember; teamId: string | null };
  const expanded: Row[] = [];
  members
    .filter((m) => m.role !== "parent")
    .forEach((m) => {
      const tids = m.team_ids && m.team_ids.length ? m.team_ids : [null];
      tids.forEach((tid) => {
        if (teamFilter === null) expanded.push({ member: m, teamId: tid });
        else if (teamFilter === "none") { if (tid === null) expanded.push({ member: m, teamId: null }); }
        else if (tid === teamFilter) expanded.push({ member: m, teamId: tid });
      });
    });

  const sortRows = (rows: Row[]) =>
    rows.sort((a, b) => {
      const al = (a.member.last_name || a.member.name || "").toLowerCase();
      const bl = (b.member.last_name || b.member.name || "").toLowerCase();
      if (al !== bl) return al.localeCompare(bl);
      return (a.member.first_name || "").toLowerCase().localeCompare((b.member.first_name || "").toLowerCase());
    });

  const sections = GROUP_TITLES.map(({ g, title }) => ({
    title,
    rows: sortRows(expanded.filter((r) => (ROLE_GROUP[r.member.role] || 3) === g)),
  })).filter((s) => s.rows.length > 0);

  const totalVisible = expanded.length;

  const openImport = async () => {
    setPicked({ ath: new Set(), mem: new Set() });
    setImportOpen(true);
    try {
      const r = await api.get<{ athletes: Candidate[]; members: Candidate[] }>("/roster/import-candidates");
      setCands(r.data);
    } catch { setCands({ athletes: [], members: [] }); }
  };

  const toggle = (kind: "ath" | "mem", id: string) => {
    setPicked((p) => {
      const next = { ath: new Set(p.ath), mem: new Set(p.mem) };
      const s = next[kind];
      if (s.has(id)) s.delete(id); else s.add(id);
      return next;
    });
  };

  const doImport = async () => {
    const athlete_ids = Array.from(picked.ath);
    const member_user_ids = Array.from(picked.mem);
    if (athlete_ids.length === 0 && member_user_ids.length === 0) { setImportOpen(false); return; }
    setImporting(true);
    try {
      await api.post("/roster/import", { athlete_ids, member_user_ids });
      setImportOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert("Import failed", e?.response?.data?.detail || "Could not import.");
    } finally { setImporting(false); }
  };

  const pickedCount = picked.ath.size + picked.mem.size;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="roster-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Roster</Text>
        <TouchableOpacity onPress={() => router.push({ pathname: "/team/roster-new", params: teamFilter && teamFilter !== "none" ? { team_id: teamFilter } : {} })} style={styles.addBtn} testID="roster-add">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.importBtn} onPress={openImport} testID="roster-import-open">
        <Ionicons name="download-outline" size={16} color={colors.accent} />
        <Text style={styles.importBtnText}>Add from my household</Text>
      </TouchableOpacity>

      {teams.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamChips}>
          {[{ id: null as any, name: "All teams" }, ...teams, { id: "none", name: "No team" }].map((t) => {
            const active = teamFilter === t.id;
            return (
              <TouchableOpacity key={String(t.id)} onPress={() => setTeamFilter(t.id)} style={[styles.teamChip, active && styles.teamChipOn]} testID={`roster-team-${t.id ?? "all"}`}>
                <Text style={[styles.teamChipText, active && styles.teamChipTextOn]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="roster-list"
        >
          {totalVisible === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{members.filter((m) => m.role !== "parent").length === 0 ? "No one on the roster yet" : "No one on this team yet"}</Text>
              <Text style={styles.emptyText}>Add coaches, staff &amp; athletes manually, or pull in your athletes.</Text>
            </View>
          ) : sections.map((section) => (
            <View key={section.title}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
              {section.rows.map(({ member: m, teamId }) => (
                <TouchableOpacity key={`${m.id}-${teamId ?? "none"}`} style={styles.card} onPress={() => router.push({ pathname: "/team/roster-new", params: { id: m.id } })} testID={`roster-row-${m.id}`}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{(m.name || "?")[0]?.toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={styles.name}>{m.name}</Text>
                      <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{(ROLE_LABEL[m.role] || m.role).toUpperCase()}</Text></View>
                      {!!teamName(teamId) && <Text style={styles.teamTag}>{teamName(teamId)}</Text>}
                    </View>
                    {(() => {
                      const isAthlete = m.role === "athlete";
                      const ph = isAthlete ? (m.parent_phone || m.phone) : (m.phone || m.parent_phone);
                      const em = isAthlete ? (m.parent_email || m.email) : (m.email || m.parent_email);
                      const parentName = `${m.parent_first_name || ""} ${m.parent_last_name || ""}`.trim();
                      return (
                        <>
                          {isAthlete && !!parentName && <Text style={styles.parentLine}>Parent: {parentName}</Text>}
                          <View style={styles.contactRow}>
                            {!!ph && (
                              <TouchableOpacity onPress={() => Linking.openURL(`tel:${ph}`)} style={styles.contactChip} testID={`roster-call-${m.id}`}>
                                <Ionicons name="call-outline" size={12} color={colors.accent} />
                                <Text style={styles.contactText}>{ph}</Text>
                              </TouchableOpacity>
                            )}
                            {!!em && (
                              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${em}`)} style={styles.contactChip} testID={`roster-email-${m.id}`}>
                                <Ionicons name="mail-outline" size={12} color={colors.accent} />
                                <Text style={styles.contactText} numberOfLines={1}>{em}</Text>
                              </TouchableOpacity>
                            )}
                            {!ph && !em && <Text style={styles.noContact}>No contact info</Text>}
                          </View>
                        </>
                      );
                    })()}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={importOpen} transparent animationType="slide" onRequestClose={() => setImportOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setImportOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Add from my household</Text>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
              {cands.athletes.length === 0 ? (
                <Text style={styles.noContact}>All your athletes are already on the roster.</Text>
              ) : (
                <>
                  {cands.athletes.map((a) => (
                    <TouchableOpacity key={a.id} style={styles.candRow} onPress={() => toggle("ath", a.id)} testID={`cand-ath-${a.id}`}>
                      <View style={[styles.check, picked.ath.has(a.id) && styles.checkOn]}>{picked.ath.has(a.id) && <Ionicons name="checkmark" size={13} color="white" />}</View>
                      <Text style={styles.candName}>{a.name}</Text>
                      <Text style={styles.candMeta}>{ROLE_LABEL[a.role || "athlete"] || a.role}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>
            <TouchableOpacity style={[styles.importConfirm, (pickedCount === 0 || importing) && { opacity: 0.5 }]} onPress={doImport} disabled={pickedCount === 0 || importing} testID="roster-import-confirm">
              {importing ? <ActivityIndicator color="white" /> : <Text style={styles.importConfirmText}>Add {pickedCount > 0 ? pickedCount : ""} to roster</Text>}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h1, color: c.textPrimary, flex: 1 },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: spacing.lg, paddingVertical: 11, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent },
  importBtnText: { ...typography.bodyMedium, color: c.accent, fontWeight: "700" },
  teamChips: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 8 },
  teamChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  teamChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  teamChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  teamChipTextOn: { color: "white" },
  sectionHeader: { ...typography.micro, color: c.textSecondary, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: 2 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginTop: spacing.md },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontWeight: "800", fontSize: 16 },
  name: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  roleBadge: { backgroundColor: c.accentSubtle, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  roleBadgeText: { color: c.accent, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  parentLine: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  teamTag: { ...typography.micro, color: c.textSecondary, fontWeight: "700" },
  contactRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  contactChip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 200 },
  contactText: { ...typography.caption, color: c.accent },
  noContact: { ...typography.caption, color: c.textTertiary },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.md },
  groupLabel: { ...typography.micro, color: c.textSecondary, fontWeight: "800", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: 6, textTransform: "uppercase" },
  candRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10 },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: c.accent, borderColor: c.accent },
  candName: { ...typography.bodyMedium, color: c.textPrimary, flex: 1 },
  candMeta: { ...typography.caption, color: c.textSecondary, maxWidth: 140 },
  importConfirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.md },
  importConfirmText: { color: "white", fontWeight: "800", fontSize: 15 },
});
