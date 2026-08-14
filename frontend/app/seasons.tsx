import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Pressable, Alert, ActivityIndicator, Switch, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { useSeason, type Season } from "@/src/context/SeasonContext";
import DateField from "@/src/components/DateField";
import { isoToInput } from "@/src/utils/format";

export default function SeasonsScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { seasons, refresh, activate, loading } = useSeason();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [makeActive, setMakeActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [menu, setMenu] = useState<Season | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [rollName, setRollName] = useState("");
  const [rollStart, setRollStart] = useState("");
  const [rollEnd, setRollEnd] = useState("");
  const [rollCarryTeams, setRollCarryTeams] = useState(true);
  const [rollAthletes, setRollAthletes] = useState<{ id: string; name: string }[]>([]);
  const [checkedAthletes, setCheckedAthletes] = useState<Set<string>>(new Set());
  const [rollBusy, setRollBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    if (!startDate || !endDate) { Alert.alert("Dates required", "Please set both a start date and an end date."); return; }
    if (endDate <= startDate) { Alert.alert("Check the dates", "End date must be after the start date."); return; }
    setSaving(true);
    try {
      await api.post("/seasons", { name: name.trim(), start_date: startDate, end_date: endDate, make_active: makeActive });
      setName(""); setStartDate(""); setEndDate(""); setMakeActive(true); setCreateOpen(false);
      await refresh();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not create season."); }
    finally { setSaving(false); }
  };

  const openEdit = () => { if (menu) { setName(menu.name); setStartDate(menu.start_date || ""); setEndDate(menu.end_date || ""); setEditOpen(true); } };

  const saveEdit = async () => {
    if (!menu || !name.trim()) return;
    try {
      await api.patch(`/seasons/${menu.id}`, { name: name.trim(), start_date: startDate || null, end_date: endDate || null });
      setEditOpen(false); setMenu(null); setName(""); setStartDate(""); setEndDate("");
      await refresh();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save."); }
  };

  const del = () => {
    if (!menu) return;
    const s = menu;
    Alert.alert("Delete season?", `"${s.name}" will be removed. Your athletes, teams, competitions, and events are kept — they'll just no longer be tagged to this season.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/seasons/${s.id}`); setMenu(null); await refresh(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  const dayAfterISO = (iso: string) => { const d = new Date(iso.slice(0, 10) + "T00:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const addSpanISO = (startISO: string, srcStart: string, srcEnd: string) => {
    const ms = new Date(srcEnd.slice(0, 10)).getTime() - new Date(srcStart.slice(0, 10)).getTime();
    return new Date(new Date(startISO + "T00:00:00").getTime() + ms).toISOString().slice(0, 10);
  };
  const inferNextName = (nm: string) => nm.replace(/(\d{4})\s*[\u2013-]\s*(\d{4})/, (_m, a, b) => `${+a + 1}\u2013${+b + 1}`);

  const openRollover = async () => {
    if (!menu) return;
    // Base the "next" slot on the LATEST-ending season so we never prefill a
    // range that collides with an already-existing next season.
    const latest = [...seasons].filter((s) => s.end_date).sort((a, b) => (a.end_date! < b.end_date! ? 1 : -1))[0] || menu;
    const start = latest.end_date ? dayAfterISO(latest.end_date) : "";
    const inferred = inferNextName(latest.name);
    setRollName(inferred && inferred !== latest.name ? inferred : "");
    setRollStart(start);
    setRollEnd(start && latest.start_date && latest.end_date ? addSpanISO(start, latest.start_date, latest.end_date) : "");
    setRollCarryTeams(true);
    try {
      const r = await api.get<{ id: string; name: string }[]>(`/athletes?season_id=${menu.id}`);
      const list = (r.data || []).map((a) => ({ id: a.id, name: a.name }));
      setRollAthletes(list);
      setCheckedAthletes(new Set(list.map((a) => a.id)));
    } catch { setRollAthletes([]); setCheckedAthletes(new Set()); }
    setRollOpen(true);
  };

  const toggleAthlete = (id: string) => setCheckedAthletes((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const doRollover = async () => {
    if (!menu) return;
    if (!rollName.trim()) { Alert.alert("Name your season", "Give the new season a name."); return; }
    if (!rollStart || !rollEnd) { Alert.alert("Dates required", "Set the new season's start and end dates."); return; }
    if (rollEnd <= rollStart) { Alert.alert("Check the dates", "End date must be after the start date."); return; }
    setRollBusy(true);
    try {
      const r = await api.post<{ season: Season; summary: Record<string, number> }>(`/seasons/rollover-create`, {
        source_season_id: menu.id, name: rollName.trim(), start_date: rollStart, end_date: rollEnd,
        carry_teams: rollCarryTeams, athlete_ids: Array.from(checkedAthletes),
      });
      const newId = r.data.season.id;
      const sm = r.data.summary || {};
      setRollOpen(false); setMenu(null);
      await refresh();
      Alert.alert("Season created 🎉", `"${r.data.season.name}" is now active with ${sm.teams || 0} team(s) and ${sm.athletes || 0} athlete(s) carried forward.`, [
        { text: "Undo", style: "destructive", onPress: async () => { try { await api.delete(`/seasons/${newId}`); await refresh(); } catch {} } },
        { text: "Done" },
      ]);
    } catch (e: any) { Alert.alert("Couldn't roll over", e?.response?.data?.detail || "Please try again."); }
    finally { setRollBusy(false); }
  };

  const doActivate = async () => { if (menu) { const id = menu.id; setMenu(null); try { await activate(id); } catch {} } };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="seasons-back"><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Seasons</Text>
        <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.addBtn} testID="seasons-add"><Ionicons name="add" size={22} color="white" /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.intro}>Create a season with its date range (like 2025–2026), and CheerPlanner automatically sorts competitions, events, and expenses into it by date. Switch the active season anytime to filter your lists.</Text>

        {(() => {
          const active = seasons.find((s) => s.is_active);
          if (!active || !active.end_date) return null;
          const days = Math.ceil((new Date(active.end_date.slice(0, 10)).getTime() - Date.now()) / 86400000);
          if (days < 0 || days > 60) return null;
          return (
            <TouchableOpacity style={styles.endsBanner} onPress={() => { setMenu(active); }} testID="season-ends-banner">
              <Ionicons name="alarm-outline" size={18} color={colors.accent} />
              <Text style={styles.endsText}>Your {active.name} season ends soon — roll over to set up next season.</Text>
            </TouchableOpacity>
          );
        })()}

        {loading && seasons.length === 0 ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
        ) : seasons.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No seasons yet</Text>
            <Text style={styles.emptySub}>Tap + to create your first season.</Text>
          </View>
        ) : (
          seasons.map((s) => (
            <TouchableOpacity key={s.id} style={styles.row} onPress={() => setMenu(s)} testID={`season-row-${s.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{s.name}</Text>
                {(s.start_date || s.end_date) ? <Text style={styles.rowDates}>{isoToInput(s.start_date || "") || "?"} → {isoToInput(s.end_date || "") || "?"}</Text> : null}
              </View>
              {s.is_active ? <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>Active</Text></View> : null}
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Create */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setCreateOpen(false)} />
          <View style={styles.sheetFlow}>
            <Text style={styles.sheetTitle}>New season</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. 2025–2026" placeholderTextColor={colors.textTertiary} testID="season-name" autoFocus />
            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}><Text style={styles.label}>Start date</Text><DateField value={startDate} onChange={setStartDate} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>End date</Text><DateField value={endDate} onChange={setEndDate} /></View>
            </View>
            <View style={styles.switchRow}><Text style={styles.switchLabel}>Make this the active season</Text><Switch value={makeActive} onValueChange={setMakeActive} /></View>
            <TouchableOpacity style={[styles.confirm, saving && { opacity: 0.6 }]} onPress={create} disabled={saving} testID="season-create-btn">
              {saving ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Create season</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Season menu */}
      <Modal visible={!!menu && !editOpen && !rollOpen} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenu(null)} />
        <View style={styles.menuSheet}>
          <Text style={styles.sheetTitle}>{menu?.name}</Text>
          {!menu?.is_active && <MenuItem icon="checkmark-circle-outline" label="Make active" onPress={doActivate} testID="season-activate" />}
          <MenuItem icon="create-outline" label="Edit name / dates" onPress={openEdit} testID="season-edit" />
          <MenuItem icon="swap-horizontal-outline" label="Roll over to new season" onPress={openRollover} testID="season-rollover" />
          <MenuItem icon="trash-outline" label="Delete season" danger onPress={del} testID="season-delete" />
        </View>
      </Modal>

      {/* Edit */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)} />
          <View style={styles.sheetFlow}>
            <Text style={styles.sheetTitle}>Edit season</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={colors.textTertiary} testID="season-edit-name" />
            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}><Text style={styles.label}>Start</Text><DateField value={startDate} onChange={setStartDate} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>End</Text><DateField value={endDate} onChange={setEndDate} /></View>
            </View>
            <TouchableOpacity style={styles.confirm} onPress={saveEdit} testID="season-edit-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rollover — create next season & carry roster forward */}
      <Modal visible={rollOpen} transparent animationType="slide" onRequestClose={() => setRollOpen(false)}>
        <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setRollOpen(false)} />
          <View style={styles.sheetFlow}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>Roll over to new season</Text>
              <Text style={styles.intro}>Creates the next season and carries your teams &amp; roster forward. Competitions, expenses, payments and bookings are NOT copied — those start fresh.</Text>

              <Text style={styles.label}>New season name</Text>
              <TextInput style={styles.input} value={rollName} onChangeText={setRollName} placeholder="e.g. 2026–2027" placeholderTextColor={colors.textTertiary} testID="roll-name" />
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}><Text style={styles.label}>Start date</Text><DateField value={rollStart} onChange={setRollStart} /></View>
                <View style={{ flex: 1 }}><Text style={styles.label}>End date</Text><DateField value={rollEnd} onChange={setRollEnd} /></View>
              </View>

              <View style={styles.switchRow}><Text style={styles.switchLabel}>Carry forward all teams</Text><Switch value={rollCarryTeams} onValueChange={setRollCarryTeams} testID="roll-carry-teams" /></View>

              <Text style={[styles.label, { marginTop: spacing.md }]}>Athletes to carry forward ({checkedAthletes.size}/{rollAthletes.length})</Text>
              <Text style={styles.hintSm}>Uncheck graduating seniors so they don't move into the new season.</Text>
              {rollAthletes.length === 0 ? (
                <Text style={styles.hintSm}>No athletes in this season yet.</Text>
              ) : rollAthletes.map((a) => {
                const on = checkedAthletes.has(a.id);
                return (
                  <TouchableOpacity key={a.id} style={styles.athRow} onPress={() => toggleAthlete(a.id)} testID={`roll-ath-${a.id}`}>
                    <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.accent : colors.textTertiary} />
                    <Text style={styles.athName}>{a.name}</Text>
                  </TouchableOpacity>
                );
              })}

              <View style={styles.summaryBox}>
                <Text style={styles.summaryText}>Creating <Text style={{ fontWeight: "800" }}>{rollName || "…"}</Text>{rollCarryTeams ? " with all teams" : ""} and {checkedAthletes.size} athlete{checkedAthletes.size === 1 ? "" : "s"}. It becomes your active season.</Text>
              </View>

              <TouchableOpacity style={[styles.confirm, rollBusy && { opacity: 0.6 }]} onPress={doRollover} disabled={rollBusy} testID="season-rollover-confirm">
                {rollBusy ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Create &amp; carry forward</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function MenuItem({ icon, label, onPress, danger, testID }: { icon: any; label: string; onPress: () => void; danger?: boolean; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} testID={testID}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.accent} />
      <Text style={[styles.menuItemText, danger && { color: colors.danger }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  iconBtn: { padding: 4 },
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  addBtn: { backgroundColor: c.accent, width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  intro: { ...typography.body, color: c.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
  empty: { alignItems: "center", marginTop: spacing.xxl, gap: 6 },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptySub: { ...typography.body, color: c.textSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  rowName: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  rowDates: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  activeBadge: { backgroundColor: c.accentSubtle, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  activeBadgeText: { ...typography.micro, fontWeight: "800", color: c.accent },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  kav: { flex: 1, justifyContent: "flex-end" },
  sheetFlow: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, paddingBottom: spacing.xxl },
  menuSheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.md },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginBottom: 6, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, color: c.textPrimary, backgroundColor: c.card },
  dateRow: { flexDirection: "row", gap: spacing.sm },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  switchLabel: { ...typography.body, color: c.textPrimary },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { ...typography.body, color: c.textPrimary, fontWeight: "600" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, marginBottom: 6 },
  pickRowOn: { borderColor: c.accent, backgroundColor: c.accentSubtle },
  pickText: { ...typography.body, color: c.textPrimary },
  kindsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  kindChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  kindChipOn: { borderColor: c.accent, backgroundColor: c.accentSubtle },
  kindChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  kindChipTextOn: { color: c.accent },
  hintSm: { ...typography.micro, color: c.textTertiary, marginBottom: 6 },
  athRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  athName: { ...typography.body, color: c.textPrimary },
  summaryBox: { marginTop: spacing.md, padding: 12, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.border },
  summaryText: { ...typography.caption, color: c.textSecondary, lineHeight: 18 },
  endsBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent + "44", marginBottom: spacing.md },
  endsText: { ...typography.caption, color: c.textPrimary, flex: 1, fontWeight: "600" },
});
