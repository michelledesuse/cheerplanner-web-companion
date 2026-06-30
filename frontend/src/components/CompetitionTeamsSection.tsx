import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, Alert, Modal, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import DateField from "@/src/components/DateField";
import TimeField from "@/src/components/TimeField";
import DebouncedTextInput from "@/src/components/DebouncedTextInput";
import TeamAvatar from "@/src/components/TeamAvatar";
import { formatDate } from "@/src/utils/format";

export type Team = { id: string; name: string; color?: string; season?: string; logo_image?: string | null };
export type TeamMeetTime = {
  team_id: string;
  date?: string | null;                  // ISO YYYY-MM-DD — performance day
  meet_time?: string | null;             // "HH:MM" 24h — team gathering/check-in
  performance_time?: string | null;      // "HH:MM" 24h
  performance_location?: string | null;
};
export type TeamToWatch = {
  name: string;
  date?: string | null;
  location?: string | null;
  performance_time?: string | null;
};

const fmt12 = (t?: string | null) => {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t || "";
  const [hS, m] = t.split(":");
  let h = Number(hS); const p = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${p}`;
};

/**
 * Drop-in section for the Competition detail screen.
 * - Lets the user pick which household Teams are attending
 * - For each attending team, set performance_time + performance_location
 * - Maintains a "Teams to Watch" spectator list
 *
 * Auto-saves to PATCH /competitions/{id} on each change.
 */
export default function CompetitionTeamsSection({
  competitionId,
  teamIds,
  teamMeetTimes,
  teamsToWatch,
  onChanged,
}: {
  competitionId: string;
  teamIds: string[];
  teamMeetTimes: TeamMeetTime[];
  teamsToWatch: TeamToWatch[];
  onChanged: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showWatchForm, setShowWatchForm] = useState<{ index?: number } | null>(null);
  const [w_name, setWName] = useState("");
  const [w_date, setWDate] = useState("");
  const [w_loc, setWLoc] = useState("");
  const [w_time, setWTime] = useState("");

  useEffect(() => {
    (async () => {
      try { const r = await api.get<Team[]>("/teams"); setTeams(r.data); }
      catch (_) { /* ignore */ }
    })();
  }, []);

  const patch = async (body: any) => {
    try { await api.patch(`/competitions/${competitionId}`, body); onChanged(); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save"); }
  };

  const toggleTeam = async (teamId: string) => {
    const next = teamIds.includes(teamId)
      ? teamIds.filter((id) => id !== teamId)
      : [...teamIds, teamId];
    // When removing a team, drop ALL entries for it; otherwise keep them.
    const nextMeet = teamMeetTimes.filter((m) => next.includes(m.team_id));
    await patch({ team_ids: next, team_meet_times: nextMeet });
  };

  /** Update a single field on the entry at the given index in team_meet_times. */
  const updateMeetTimeAt = async (
    index: number,
    field: "date" | "meet_time" | "performance_time" | "performance_location",
    value: string,
  ) => {
    if (index < 0 || index >= teamMeetTimes.length) return;
    const current = teamMeetTimes[index];
    const updated: TeamMeetTime = { ...current, [field]: value || null };
    const next = teamMeetTimes.map((m, i) => (i === index ? updated : m));
    await patch({ team_meet_times: next });
  };

  /** Append a fresh empty entry for the given team_id. */
  const addMeetTimeEntry = async (teamId: string) => {
    const next: TeamMeetTime[] = [
      ...teamMeetTimes,
      { team_id: teamId, date: null, meet_time: null, performance_time: null, performance_location: null },
    ];
    await patch({ team_meet_times: next });
  };

  /** Remove a specific entry by its array index (with confirmation). */
  const removeMeetTimeAt = (index: number) => {
    if (index < 0 || index >= teamMeetTimes.length) return;
    Alert.alert("Remove this day?", "This performance entry will be deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const next = teamMeetTimes.filter((_, i) => i !== index);
          await patch({ team_meet_times: next });
        },
      },
    ]);
  };

  const openNewWatch = () => {
    setWName(""); setWDate(""); setWLoc(""); setWTime("");
    setShowWatchForm({});
  };
  const openEditWatch = (i: number) => {
    const w = teamsToWatch[i];
    setWName(w.name); setWDate(w.date || ""); setWLoc(w.location || ""); setWTime(w.performance_time || "");
    setShowWatchForm({ index: i });
  };
  const saveWatch = async () => {
    if (!w_name.trim()) { Alert.alert("Missing", "Please enter a team name."); return; }
    const entry: TeamToWatch = {
      name: w_name.trim(),
      date: w_date.trim() || null,
      location: w_loc.trim() || null,
      performance_time: w_time.trim() || null,
    };
    const next = [...teamsToWatch];
    if (showWatchForm?.index != null) next[showWatchForm.index] = entry; else next.push(entry);
    await patch({ teams_to_watch: next });
    setShowWatchForm(null);
  };
  const deleteWatch = (i: number) => {
    Alert.alert("Remove team?", `Stop tracking "${teamsToWatch[i].name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        const next = teamsToWatch.filter((_, j) => j !== i);
        await patch({ teams_to_watch: next });
      }},
    ]);
  };

  return (
    <View>
      <Text style={styles.sectionHead}>Our Teams Attending</Text>
      {teams.length === 0 ? (
        <Text style={styles.emptyHint}>No teams yet. Add teams from Settings → Teams.</Text>
      ) : (
        <View style={styles.chipWrap}>
          {teams.map((t) => {
            const on = teamIds.includes(t.id);
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => toggleTeam(t.id)}
                style={[styles.teamChip, on && { backgroundColor: t.color || colors.accent, borderColor: t.color || colors.accent }]}
                testID={`comp-team-${t.id}`}
              >
                <TeamAvatar logoImage={t.logo_image} color={t.color} size={18} dotColor={on ? "white" : undefined} />
                <Text style={[styles.teamChipText, on && { color: "white" }]} numberOfLines={1}>{t.name}</Text>
                {on && <Ionicons name="checkmark-circle" size={14} color="white" />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {teamIds.length > 0 && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg }}>
            <Text style={[styles.sectionHead, { marginTop: 0 }]}>Performance Schedule</Text>
            <View style={styles.autoSaveHint}>
              <Ionicons name="create-outline" size={11} color={colors.textTertiary} />
              <Text style={styles.autoSaveText}>Tap any field to edit · auto-saves</Text>
            </View>
          </View>
          {teamIds.map((tid) => {
            const t = teams.find((x) => x.id === tid);
            if (!t) return null;

            // Build a list of {entry, originalIndex} so we can update by index.
            const teamEntries: { entry: TeamMeetTime; originalIndex: number }[] = [];
            teamMeetTimes.forEach((m, i) => {
              if (m.team_id === tid) teamEntries.push({ entry: m, originalIndex: i });
            });

            return (
              <View key={tid} style={styles.meetTeamWrap}>
                <View style={styles.meetTeamHeader}>
                  <TeamAvatar logoImage={t.logo_image} color={t.color} size={22} />
                  <Text style={styles.meetTeam}>{t.name}</Text>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity
                    onPress={() => addMeetTimeEntry(tid)}
                    style={styles.addDayBtn}
                    testID={`add-meet-day-${tid}`}
                  >
                    <Ionicons name="add" size={14} color="white" />
                    <Text style={styles.addDayBtnText}>Add day</Text>
                  </TouchableOpacity>
                </View>

                {teamEntries.length === 0 ? (
                  <TouchableOpacity
                    onPress={() => addMeetTimeEntry(tid)}
                    style={styles.emptyEntryRow}
                    testID={`empty-meet-day-${tid}`}
                  >
                    <Ionicons name="calendar-outline" size={14} color={colors.accent} />
                    <Text style={styles.emptyEntryText}>Tap to add a performance day for this team</Text>
                  </TouchableOpacity>
                ) : (
                  teamEntries.map(({ entry, originalIndex }, displayIdx) => (
                    <View key={`${tid}-${originalIndex}`} style={styles.meetCard}>
                      <View style={styles.meetEntryHeader}>
                        <View style={styles.entryBadge}>
                          <Text style={styles.entryBadgeText}>Day {displayIdx + 1}</Text>
                          {entry.date ? (
                            <Text style={styles.entryBadgeDate}>{formatDate(entry.date, { withYear: false })}</Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          onPress={() => removeMeetTimeAt(originalIndex)}
                          hitSlop={10}
                          testID={`remove-meet-${tid}-${displayIdx}`}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.smallLabel}>PERFORMANCE DATE</Text>
                      <DateField
                        value={entry.date || ""}
                        onChange={(iso) => updateMeetTimeAt(originalIndex, "date", iso)}
                        testID={`meet-date-${tid}-${displayIdx}`}
                      />

                      {/* Stacked vertically (not side-by-side) so each TimeField
                          gets full container width — guarantees AM/PM is always
                          reachable even when this section is nested inside the
                          team card padding on narrow phones. */}
                      <Text style={[styles.smallLabel, { marginTop: spacing.sm }]}>MEET TIME</Text>
                      <TimeField
                        value={entry.meet_time || ""}
                        onChange={(v) => updateMeetTimeAt(originalIndex, "meet_time", v)}
                        testID={`meet-time-meet-${tid}-${displayIdx}`}
                      />
                      <Text style={[styles.smallLabel, { marginTop: spacing.sm }]}>PERFORMANCE TIME</Text>
                      <TimeField
                        value={entry.performance_time || ""}
                        onChange={(v) => updateMeetTimeAt(originalIndex, "performance_time", v)}
                        testID={`meet-time-perf-${tid}-${displayIdx}`}
                      />

                      <Text style={[styles.smallLabel, { marginTop: spacing.sm }]}>LOCATION</Text>
                      <DebouncedTextInput
                        placeholder="e.g. Hall A"
                        placeholderTextColor={colors.textTertiary}
                        value={entry.performance_location || ""}
                        onCommit={(v) => updateMeetTimeAt(originalIndex, "performance_location", v)}
                        style={styles.input}
                        testID={`meet-loc-${tid}-${displayIdx}`}
                      />
                    </View>
                  ))
                )}
              </View>
            );
          })}
        </>
      )}

      <View style={styles.watchHead}>
        <Text style={styles.sectionHead}>Teams to Watch</Text>
        <TouchableOpacity onPress={openNewWatch} style={styles.miniAdd} testID="add-watch-btn">
          <Ionicons name="add" size={14} color="white" />
          <Text style={styles.miniAddText}>Add</Text>
        </TouchableOpacity>
      </View>
      {teamsToWatch.length === 0 ? (
        <Text style={styles.emptyHint}>Track other teams (rivals, friends, future routines) competing at this event.</Text>
      ) : (
        teamsToWatch.map((w, i) => (
          <TouchableOpacity key={i} onPress={() => openEditWatch(i)} style={styles.watchCard} testID={`watch-card-${i}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.watchName}>{w.name}</Text>
              <Text style={styles.watchMeta}>
                {[w.date, fmt12(w.performance_time || ""), w.location].filter(Boolean).join(" • ") || "Tap to add details"}
              </Text>
            </View>
            <TouchableOpacity onPress={(ev) => { ev.stopPropagation?.(); deleteWatch(i); }} hitSlop={10}>
              <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))
      )}

      <Modal visible={!!showWatchForm} animationType="slide" transparent onRequestClose={() => setShowWatchForm(null)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{showWatchForm?.index != null ? "Edit team to watch" : "Track a team"}</Text>
                <TouchableOpacity onPress={() => setShowWatchForm(null)} hitSlop={10}>
                  <Ionicons name="close" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.smallLabel}>TEAM / ROUTINE NAME *</Text>
                <TextInput style={styles.input} value={w_name} onChangeText={setWName} placeholder="e.g. Cheer Athletics Cheetahs" placeholderTextColor={colors.textTertiary} testID="watch-name" />
                <Text style={styles.smallLabel}>DATE</Text>
                <DateField value={w_date} onChange={setWDate} testID="watch-date" />
                <Text style={styles.smallLabel}>PERFORMANCE TIME</Text>
                <TimeField value={w_time} onChange={setWTime} testID="watch-time" />
                <Text style={styles.smallLabel}>LOCATION / ARENA</Text>
                <TextInput style={styles.input} value={w_loc} onChangeText={setWLoc} placeholder="e.g. Arena A" placeholderTextColor={colors.textTertiary} testID="watch-loc" />
                <TouchableOpacity onPress={saveWatch} style={styles.saveBtn} testID="watch-save-btn">
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = () => ({
  sectionHead: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  emptyHint: { ...typography.caption, color: colors.textTertiary, fontStyle: "italic" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  teamChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  teamChipText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary },
  meetCard: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: 8 },
  meetHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  meetTeam: { ...typography.bodyMedium, fontWeight: "700", color: colors.textPrimary },
  meetTeamWrap: { marginBottom: spacing.lg },
  meetTeamHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  addDayBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.accent, borderRadius: 999 },
  addDayBtnText: { color: "white", fontWeight: "700", fontSize: 12 },
  meetEntryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  entryBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  entryBadgeText: { ...typography.micro, color: colors.accent, fontWeight: "800", letterSpacing: 0.5, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.accentSubtle, borderRadius: 999 },
  entryBadgeDate: { ...typography.caption, color: colors.textSecondary, fontWeight: "600" },
  emptyEntryRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: spacing.md, backgroundColor: colors.accentSubtle, borderRadius: radius.md, justifyContent: "center", marginBottom: 8 },
  emptyEntryText: { ...typography.caption, color: colors.accent, fontWeight: "600" },
  autoSaveHint: { flexDirection: "row", alignItems: "center", gap: 4 },
  autoSaveText: { ...typography.micro, color: colors.textTertiary, fontStyle: "italic" },
  meetGrid: { flexDirection: "row", gap: 8 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.textPrimary, marginTop: 4 },
  timePreview: { ...typography.micro, color: colors.accent, marginTop: 2, fontWeight: "600" },
  smallLabel: { ...typography.micro, color: colors.textSecondary, fontWeight: "700", letterSpacing: 0.5 },
  watchHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  miniAdd: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.accent, borderRadius: 999, marginBottom: spacing.sm },
  miniAddText: { color: "white", fontWeight: "700", fontSize: 12 },
  watchCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: 8 },
  watchName: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700" },
  watchMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxl, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
