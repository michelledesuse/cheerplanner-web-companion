import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, Linking, Alert, Platform, Image, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { shareTeamLink } from "@/src/utils/shareLink";
import { exportAoa } from "@/src/utils/exportFile";
import { toggleId } from "@/src/utils/filters";
import SeasonBar from "@/src/components/SeasonBar";
import { useSeason } from "@/src/context/SeasonContext";

type RosterMember = {
  id: string; name: string; role: string;
  first_name?: string | null; last_name?: string | null;
  phone?: string | null; email?: string | null;
  parent_first_name?: string | null; parent_last_name?: string | null;
  parent_phone?: string | null; parent_email?: string | null;
  team_ids?: string[] | null; notes?: string | null; source?: string; linked_id?: string | null;
  pending_review?: boolean; photo?: string | null;
};
type Candidate = { id: string; name: string; role?: string; email?: string | null; team_id?: string | null };

const ROLE_LABEL: Record<string, string> = {
  athlete: "Athlete", parent: "Parent", coach: "Coach", team_rep: "Team Rep", staff: "Staff",
};

/** Open the phone's native Messages app pre-filled to the member's number.
 * Athletes → parent's phone; staff → own phone. Web can't open sms:. */
function openMemberText(m: { role: string; name: string; first_name?: string | null; phone?: string | null; parent_phone?: string | null; parent_first_name?: string | null }) {
  const isAthlete = m.role === "athlete";
  const ph = isAthlete ? (m.parent_phone || m.phone) : (m.phone || m.parent_phone);
  if (!ph) { Alert.alert("No phone", "There's no phone number on file for this person."); return; }
  if (Platform.OS === "web") {
    Alert.alert("Open on your phone", "Texting opens your phone's Messages app. Use CheerPlanner on your phone to send a text.");
    return;
  }
  const greet = isAthlete ? (m.parent_first_name || "there") : (m.first_name || (m.name || "").split(" ")[0] || "there");
  const body = `Hi ${greet}, `;
  const sep = Platform.OS === "ios" ? "&" : "?";
  Linking.openURL(`sms:${ph}${sep}body=${encodeURIComponent(body)}`).catch(() => {
    Alert.alert("Couldn't open Messages", "Your device couldn't open the Messages app.");
  });
}

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
  const { filterSeasonId } = useSeason();
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string; color?: string | null }[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]); // empty=all, "none"=unassigned
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cands, setCands] = useState<{ athletes: Candidate[]; members: Candidate[] }>({ athletes: [], members: [] });
  const [picked, setPicked] = useState<{ ath: Set<string>; mem: Set<string> }>({ ath: new Set(), mem: new Set() });
  const [importing, setImporting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqMember, setReqMember] = useState<RosterMember | null>(null);
  const [reqInfo, setReqInfo] = useState<{ url: string; has_phone: boolean; phone: string | null } | null>(null);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqSending, setReqSending] = useState(false);

  const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || "";

  const openRequestInfo = async (m: RosterMember) => {
    setReqMember(m); setReqInfo(null); setReqOpen(true); setReqLoading(true);
    try {
      const r = await api.post(`/team/roster/${m.id}/request-info`, { base_url: BACKEND, send: false });
      setReqInfo({ url: r.data.url, has_phone: r.data.has_phone, phone: r.data.phone });
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not create the link.");
      setReqOpen(false);
    } finally { setReqLoading(false); }
  };

  const sendRequestText = async () => {
    if (!reqMember) return;
    setReqSending(true);
    try {
      const r = await api.post(`/team/roster/${reqMember.id}/request-info`, { base_url: BACKEND, send: true });
      if (r.data.sent) { Alert.alert("Text sent", `We texted an info request to ${r.data.phone}.`); setReqOpen(false); }
      else Alert.alert("Not sent", "Couldn't send the text. Try copying the link instead.");
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.response?.data?.detail || "Try copying the link and sending it yourself.");
    } finally { setReqSending(false); }
  };

  const copyReqLink = async () => {
    if (!reqInfo) return;
    await Clipboard.setStringAsync(reqInfo.url);
    Alert.alert("Copied", "The link is on your clipboard — paste it into a text or email.");
  };

  const shareReqLink = async () => {
    if (!reqInfo) return;
    try { await Share.share({ message: `Please complete your team roster info (no app needed):\n${reqInfo.url}` }); } catch { /* dismissed */ }
  };

  const downloadRoster = async (format: "csv" | "xlsx") => {
    setActionsOpen(false);
    const seen = new Set<string>();
    const unique = members.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    const header = ["Name", "Role", "Team(s)", "Phone", "Email", "Parent First", "Parent Last", "Parent Phone", "Parent Email", "Notes"];
    const roleLabel: Record<string, string> = { athlete: "Athlete", coach: "Coach", team_rep: "Team Rep", staff: "Staff", parent: "Parent" };
    const rows = unique.map((m) => [
      m.name,
      roleLabel[m.role] || m.role,
      (m.team_ids || []).map((tid) => teamName(tid)).filter(Boolean).join(", "),
      m.phone || "", m.email || "",
      m.parent_first_name || "", m.parent_last_name || "", m.parent_phone || "", m.parent_email || "",
      m.notes || "",
    ]);
    try {
      await exportAoa("cheerplanner-roster", [header, ...rows], format, "Roster");
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Please try again.");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const pendingCount = new Set(members.filter((m) => m.pending_review).map((m) => m.id)).size;

  const clearAllReviewed = async () => {
    try { await api.post("/roster/mark-reviewed", {}); await load(); } catch { /* ignore */ }
  };

  const openMember = (m: RosterMember) => {
    if (m.pending_review) api.post("/roster/mark-reviewed", { ids: [m.id] }).catch(() => {});
    router.push({ pathname: "/team/roster-new", params: { id: m.id } });
  };

  const bulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Alert.alert("Delete members?", `Remove ${ids.length} ${ids.length === 1 ? "person" : "people"} from the roster? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api.post("/roster/bulk-delete", { ids });
          exitSelect();
          await load();
        } catch (e: any) {
          Alert.alert("Delete failed", e?.response?.data?.detail || "Could not delete.");
        }
      } },
    ]);
  };

  const load = useCallback(async () => {
    try {
      const [r, tr] = await Promise.all([
        api.get<RosterMember[]>("/roster", { params: filterSeasonId ? { season_id: filterSeasonId } : {} }),
        api.get<{ id: string; name: string; color?: string | null }[]>("/teams").catch(() => ({ data: [] as any })),
      ]);
      setMembers(r.data);
      setTeams(tr.data || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, [filterSeasonId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRealtimeRefetch(load);

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
        if (teamFilter.length === 0) expanded.push({ member: m, teamId: tid });
        else if (tid === null) { if (teamFilter.includes("none")) expanded.push({ member: m, teamId: null }); }
        else if (teamFilter.includes(tid)) expanded.push({ member: m, teamId: tid });
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
        {!selectMode && (
          <TouchableOpacity onPress={() => setActionsOpen(true)} style={styles.iconBtn} testID="roster-actions" hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        {selectMode ? (
          <TouchableOpacity onPress={exitSelect} style={styles.selBtn} testID="roster-select-cancel">
            <Text style={styles.selBtnText}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setSelectMode(true)} style={styles.selBtn} testID="roster-select-toggle" disabled={totalVisible === 0}>
            <Text style={[styles.selBtnText, totalVisible === 0 && { opacity: 0.4 }]}>Select</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.push({ pathname: "/team/roster-new", params: teamFilter.length === 1 && teamFilter[0] !== "none" ? { team_id: teamFilter[0] } : {} })} style={styles.addBtn} testID="roster-add">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      <View style={styles.seasonWrap}><SeasonBar /></View>

      {teams.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.teamChips}>
          {[{ id: null as any, name: "All teams" }, ...teams, { id: "none", name: "No team" }].map((t) => {
            const active = t.id === null ? teamFilter.length === 0 : teamFilter.includes(t.id);
            const onPress = t.id === null ? () => setTeamFilter([]) : () => setTeamFilter((p) => toggleId(p, t.id));
            return (
              <TouchableOpacity key={String(t.id)} onPress={onPress} style={[styles.teamChip, active && styles.teamChipOn]} testID={`roster-team-${t.id ?? "all"}`}>
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
          {pendingCount > 0 && !selectMode && (
            <TouchableOpacity style={styles.reviewBanner} onPress={clearAllReviewed} testID="roster-review-banner">
              <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
              <Text style={styles.reviewBannerText}>
                {pendingCount} new parent {pendingCount === 1 ? "submission" : "submissions"} — tap to mark reviewed
              </Text>
            </TouchableOpacity>
          )}
          {totalVisible === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{members.filter((m) => m.role !== "parent").length === 0 ? "No one on the roster yet" : "No one on this team yet"}</Text>
              <Text style={styles.emptyText}>Add coaches, staff &amp; athletes manually, or pull in your athletes.</Text>
            </View>
          ) : sections.map((section) => (
            <View key={section.title}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
              {section.rows.map(({ member: m, teamId }) => {
                const selected = selectedIds.has(m.id);
                return (
                <TouchableOpacity key={`${m.id}-${teamId ?? "none"}`} style={[styles.card, selectMode && selected && styles.cardSelected]} onPress={() => selectMode ? toggleSelect(m.id) : openMember(m)} testID={`roster-row-${m.id}`}>
                  {selectMode && (
                    <View style={[styles.selCheck, selected && styles.selCheckOn]} testID={`roster-check-${m.id}`}>
                      {selected && <Ionicons name="checkmark" size={14} color="white" />}
                    </View>
                  )}
                  {m.photo ? (
                    <Image source={{ uri: m.photo }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatar}><Text style={styles.avatarText}>{(m.name || "?")[0]?.toUpperCase()}</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={styles.name}>{m.name}</Text>
                      <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{(ROLE_LABEL[m.role] || m.role).toUpperCase()}</Text></View>
                      {m.pending_review && <View style={styles.newBadge}><Text style={styles.newBadgeText}>NEW</Text></View>}
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
                              <TouchableOpacity onPress={() => Linking.openURL(`tel:${ph}`)} style={styles.contactChip} testID={`roster-call-${m.id}`} disabled={selectMode}>
                                <Ionicons name="call-outline" size={12} color={colors.accent} />
                                <Text style={styles.contactText}>{ph}</Text>
                              </TouchableOpacity>
                            )}
                            {!!ph && (
                              <TouchableOpacity onPress={() => openMemberText(m)} style={styles.contactChip} testID={`roster-text-${m.id}`} disabled={selectMode}>
                                <Ionicons name="chatbubble-ellipses-outline" size={12} color={colors.accent} />
                                <Text style={styles.contactText}>Text</Text>
                              </TouchableOpacity>
                            )}
                            {!!em && (
                              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${em}`)} style={styles.contactChip} testID={`roster-email-${m.id}`} disabled={selectMode}>
                                <Ionicons name="mail-outline" size={12} color={colors.accent} />
                                <Text style={styles.contactText} numberOfLines={1}>{em}</Text>
                              </TouchableOpacity>
                            )}
                            {!ph && !em && <Text style={styles.noContact}>No contact info</Text>}
                            <TouchableOpacity onPress={() => openRequestInfo(m)} style={styles.contactChip} testID={`roster-request-${m.id}`} disabled={selectMode}>
                              <Ionicons name="clipboard-outline" size={12} color={colors.accent} />
                              <Text style={styles.contactText}>Request info</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      );
                    })()}
                  </View>
                  {!selectMode && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
                </TouchableOpacity>
              );})}
            </View>
          ))}
        </ScrollView>
      )}

      {selectMode && selectedIds.size > 0 && (
        <View style={styles.deleteBar}>
          <Text style={styles.deleteBarCount}>{selectedIds.size} selected</Text>
          <TouchableOpacity style={styles.deleteBarBtn} onPress={bulkDelete} testID="roster-bulk-delete">
            <Ionicons name="trash-outline" size={16} color="white" />
            <Text style={styles.deleteBarBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={actionsOpen} transparent animationType="fade" onRequestClose={() => setActionsOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setActionsOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={() => {}}>
            <View style={styles.menuHandle} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setActionsOpen(false); openImport(); }} testID="roster-menu-household">
              <Ionicons name="people-outline" size={19} color={colors.accent} />
              <Text style={styles.menuText}>Add from my household</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setActionsOpen(false); router.push("/import/roster" as any); }} testID="roster-menu-import">
              <Ionicons name="grid-outline" size={19} color={colors.accent} />
              <Text style={styles.menuText}>Import roster from spreadsheet (CSV / Excel)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setActionsOpen(false); router.push("/import/team_sizes" as any); }} testID="roster-menu-import-sizes">
              <Ionicons name="shirt-outline" size={19} color={colors.accent} />
              <Text style={styles.menuText}>Upload sizes from spreadsheet (CSV / Excel)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setActionsOpen(false); shareTeamLink("roster"); }} testID="roster-menu-share">
              <Ionicons name="share-outline" size={19} color={colors.accent} />
              <Text style={styles.menuText}>Share link for parents to add info</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => downloadRoster("xlsx")} testID="roster-menu-download-xlsx">
              <Ionicons name="download-outline" size={19} color={colors.accent} />
              <Text style={styles.menuText}>Download roster (Excel)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => downloadRoster("csv")} testID="roster-menu-download-csv">
              <Ionicons name="document-text-outline" size={19} color={colors.accent} />
              <Text style={styles.menuText}>Download roster (CSV)</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

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

      {/* Request info from an existing member */}
      <Modal visible={reqOpen} transparent animationType="slide" onRequestClose={() => setReqOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setReqOpen(false)}>
          <Pressable style={styles.reqSheet} onPress={() => {}}>
            <View style={styles.reqHeader}>
              <Text style={styles.reqTitle} numberOfLines={1}>Request info{reqMember ? ` — ${reqMember.name}` : ""}</Text>
              <TouchableOpacity onPress={() => setReqOpen(false)} hitSlop={10}><Ionicons name="close" size={22} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            <Text style={styles.reqBlurb}>Send a private link so this person can fill in any missing roster details. Their existing info is pre-filled.</Text>
            {reqLoading || !reqInfo ? (
              <View style={{ paddingVertical: 24 }}><ActivityIndicator color={colors.accent} /></View>
            ) : (
              <>
                <View style={styles.reqLinkBox}><Text style={styles.reqLinkText} numberOfLines={1}>{reqInfo.url}</Text></View>
                {reqInfo.has_phone && (
                  <TouchableOpacity style={styles.reqPrimary} onPress={sendRequestText} disabled={reqSending} testID="roster-request-send">
                    {reqSending ? <ActivityIndicator color="white" /> : (<><Ionicons name="chatbubble-ellipses-outline" size={18} color="white" /><Text style={styles.reqPrimaryText}>Text link to {reqInfo.phone}</Text></>)}
                  </TouchableOpacity>
                )}
                <View style={styles.reqRow}>
                  <TouchableOpacity style={styles.reqSecondary} onPress={copyReqLink} testID="roster-request-copy">
                    <Ionicons name="copy-outline" size={17} color={colors.accent} /><Text style={styles.reqSecondaryText}>Copy link</Text>
                  </TouchableOpacity>
                  {Platform.OS !== "web" && (
                    <TouchableOpacity style={styles.reqSecondary} onPress={shareReqLink} testID="roster-request-share">
                      <Ionicons name="share-outline" size={17} color={colors.accent} /><Text style={styles.reqSecondaryText}>Share…</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {!reqInfo.has_phone && <Text style={styles.reqNote}>No phone number on file — copy or share the link to send it yourself.</Text>}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  seasonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h1, color: c.textPrimary, flex: 1 },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  selBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  selBtnText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  cardSelected: { borderColor: c.accent, backgroundColor: c.accentSubtle },
  selCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  selCheckOn: { backgroundColor: c.accent, borderColor: c.accent },
  deleteBar: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  deleteBarCount: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  deleteBarBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.danger, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10 },
  deleteBarBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  menuSheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.md, paddingBottom: spacing.xl },
  reqSheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xxl },
  reqHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  reqTitle: { ...typography.h3, color: c.textPrimary, flex: 1, marginRight: 8 },
  reqBlurb: { ...typography.caption, color: c.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  reqLinkBox: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, marginBottom: spacing.md },
  reqLinkText: { ...typography.caption, color: c.textSecondary },
  reqPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, marginBottom: spacing.sm },
  reqPrimaryText: { color: "white", fontWeight: "800", fontSize: 15 },
  reqRow: { flexDirection: "row", gap: spacing.sm },
  reqSecondary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.accentSubtle, borderRadius: radius.md, paddingVertical: 12, borderWidth: 1, borderColor: c.accent },
  reqSecondaryText: { color: c.accent, fontWeight: "700", fontSize: 14 },
  reqNote: { ...typography.caption, color: c.textTertiary, marginTop: spacing.md, textAlign: "center" },
  menuHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: "center", marginBottom: spacing.md },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 14, borderRadius: radius.md },
  menuText: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "600" },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: spacing.lg, paddingVertical: 11, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent },
  importBtnText: { ...typography.bodyMedium, color: c.accent, fontWeight: "700" },
  teamChips: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 8, alignItems: "center" },
  teamChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, minHeight: 36, justifyContent: "center" },
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
  newBadge: { backgroundColor: c.success || c.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  newBadgeText: { color: "white", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  reviewBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent + "55", borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  reviewBannerText: { ...typography.caption, color: c.textPrimary, fontWeight: "700", flex: 1 },
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
