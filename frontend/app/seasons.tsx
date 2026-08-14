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

const KINDS: { key: string; label: string }[] = [
  { key: "athletes", label: "Athletes" },
  { key: "teams", label: "Teams" },
  { key: "competitions", label: "Competitions" },
  { key: "events", label: "Schedule events" },
];

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
  const [rollTarget, setRollTarget] = useState<string | null>(null);
  const [rollKinds, setRollKinds] = useState<string[]>(KINDS.map((k) => k.key));

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

  const openRollover = () => { if (menu) { setRollTarget(null); setRollKinds(KINDS.map((k) => k.key)); setRollOpen(true); } };

  const doRollover = async () => {
    if (!menu || !rollTarget) { Alert.alert("Pick a season", "Choose which season to roll everything into."); return; }
    try {
      const r = await api.post<{ rolled_over: Record<string, number>; target: string }>(`/seasons/${menu.id}/rollover`, { target_season_id: rollTarget, kinds: rollKinds });
      const total = Object.values(r.data.rolled_over || {}).reduce((a, b) => a + b, 0);
      setRollOpen(false); setMenu(null);
      await refresh();
      Alert.alert("Rolled over", `${total} item${total === 1 ? "" : "s"} added to "${r.data.target}".`);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not roll over."); }
  };

  const doActivate = async () => { if (menu) { const id = menu.id; setMenu(null); try { await activate(id); } catch {} } };

  const toggleKind = (k: string) => setRollKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="seasons-back"><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Seasons</Text>
        <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.addBtn} testID="seasons-add"><Ionicons name="add" size={22} color="white" /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.intro}>Create a season with its date range (like 2025–2026), and CheerPlanner automatically sorts competitions, events, and expenses into it by date. Switch the active season anytime to filter your lists.</Text>

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
          <MenuItem icon="swap-horizontal-outline" label="Roll over into another season" onPress={openRollover} testID="season-rollover" />
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

      {/* Rollover */}
      <Modal visible={rollOpen} transparent animationType="slide" onRequestClose={() => setRollOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRollOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Roll over from “{menu?.name}”</Text>
          <Text style={styles.intro}>Add everything from this season into another season (they’ll belong to both).</Text>
          <Text style={styles.label}>Into which season?</Text>
          {seasons.filter((s) => s.id !== menu?.id).map((s) => (
            <TouchableOpacity key={s.id} style={[styles.pickRow, rollTarget === s.id && styles.pickRowOn]} onPress={() => setRollTarget(s.id)} testID={`roll-target-${s.id}`}>
              <Ionicons name={rollTarget === s.id ? "radio-button-on" : "radio-button-off"} size={20} color={rollTarget === s.id ? colors.accent : colors.textTertiary} />
              <Text style={styles.pickText}>{s.name}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[styles.label, { marginTop: spacing.md }]}>What to roll over</Text>
          <View style={styles.kindsWrap}>
            {KINDS.map((k) => (
              <TouchableOpacity key={k.key} style={[styles.kindChip, rollKinds.includes(k.key) && styles.kindChipOn]} onPress={() => toggleKind(k.key)} testID={`roll-kind-${k.key}`}>
                <Text style={[styles.kindChipText, rollKinds.includes(k.key) && styles.kindChipTextOn]}>{k.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.confirm} onPress={doRollover} testID="season-rollover-confirm"><Text style={styles.confirmText}>Roll over</Text></TouchableOpacity>
        </View>
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
});
