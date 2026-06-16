import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";

export type Team = { id: string; name: string; color?: string; season?: string };
export type TeamMeetTime = {
  team_id: string;
  performance_time?: string | null;  // "HH:MM" 24h
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
    // Also drop any meet time for removed teams.
    const nextMeet = teamMeetTimes.filter((m) => next.includes(m.team_id));
    await patch({ team_ids: next, team_meet_times: nextMeet });
  };

  const updateMeetTime = async (teamId: string, field: "performance_time" | "performance_location", value: string) => {
    const existing = teamMeetTimes.find((m) => m.team_id === teamId);
    const newEntry: TeamMeetTime = { ...(existing || { team_id: teamId }), [field]: value || null };
    const next = teamMeetTimes.some((m) => m.team_id === teamId)
      ? teamMeetTimes.map((m) => m.team_id === teamId ? newEntry : m)
      : [...teamMeetTimes, newEntry];
    await patch({ team_meet_times: next });
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
                <View style={[styles.teamDot, { backgroundColor: on ? "white" : (t.color || colors.accent) }]} />
                <Text style={[styles.teamChipText, on && { color: "white" }]} numberOfLines={1}>{t.name}</Text>
                {on && <Ionicons name="checkmark-circle" size={14} color="white" />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {teamIds.length > 0 && (
        <>
          <Text style={[styles.sectionHead, { marginTop: spacing.lg }]}>Performance Times</Text>
          {teamIds.map((tid) => {
            const t = teams.find((x) => x.id === tid);
            if (!t) return null;
            const meet = teamMeetTimes.find((m) => m.team_id === tid);
            return (
              <View key={tid} style={styles.meetCard}>
                <View style={styles.meetHead}>
                  <View style={[styles.teamDot, { backgroundColor: t.color || colors.accent }]} />
                  <Text style={styles.meetTeam}>{t.name}</Text>
                </View>
                <View style={styles.meetGrid}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.smallLabel}>PERFORMANCE TIME (24h)</Text>
                    <TextInput
                      placeholder="e.g. 14:30"
                      placeholderTextColor={colors.textTertiary}
                      value={meet?.performance_time || ""}
                      onChangeText={(v) => updateMeetTime(tid, "performance_time", v)}
                      style={styles.input}
                      testID={`meet-time-${tid}`}
                    />
                    {meet?.performance_time && (
                      <Text style={styles.timePreview}>= {fmt12(meet.performance_time)}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1.4 }}>
                    <Text style={styles.smallLabel}>LOCATION</Text>
                    <TextInput
                      placeholder="e.g. Arena A"
                      placeholderTextColor={colors.textTertiary}
                      value={meet?.performance_location || ""}
                      onChangeText={(v) => updateMeetTime(tid, "performance_location", v)}
                      style={styles.input}
                      testID={`meet-loc-${tid}`}
                    />
                  </View>
                </View>
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
                <Text style={styles.smallLabel}>DATE (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={w_date} onChangeText={setWDate} placeholder="2026-03-15" placeholderTextColor={colors.textTertiary} testID="watch-date" />
                <Text style={styles.smallLabel}>PERFORMANCE TIME (24h)</Text>
                <TextInput style={styles.input} value={w_time} onChangeText={setWTime} placeholder="e.g. 16:00" placeholderTextColor={colors.textTertiary} testID="watch-time" />
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

const styles = StyleSheet.create({
  sectionHead: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  emptyHint: { ...typography.caption, color: colors.textTertiary, fontStyle: "italic" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  teamChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  teamChipText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary },
  meetCard: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: 8 },
  meetHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  meetTeam: { ...typography.bodyMedium, fontWeight: "700", color: colors.textPrimary },
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
