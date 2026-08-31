import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Switch, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Res = { id: string; title: string; date?: string; placement?: string; score?: string; division?: string; notes?: string; visibility: string };

export default function TeamResults() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [results, setResults] = useState<Res[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Partial<Res> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get<{ results: Res[]; can_edit: boolean }>("/team/results"); setResults(r.data.results || []); setCanEdit(!!r.data.can_edit); }
    catch (_e) { setResults([]); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!edit?.title?.trim()) { Alert.alert("Missing", "Enter a competition name."); return; }
    setSaving(true);
    try {
      const body = { title: edit.title, date: edit.date || "", placement: edit.placement || "", score: edit.score || "", division: edit.division || "", notes: edit.notes || "", visibility: edit.visibility || "private" };
      if (edit.id) await api.patch(`/team/results/${edit.id}`, body); else await api.post("/team/results", body);
      setEdit(null); load();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save."); }
    finally { setSaving(false); }
  };
  const toggleVis = async (r: Res) => { await api.patch(`/team/results/${r.id}`, { visibility: r.visibility === "team" ? "private" : "team" }); load(); };
  const del = (r: Res) => Alert.alert("Delete result?", r.title, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { await api.delete(`/team/results/${r.id}`); load(); } }]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="results-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={styles.title}>🏆 Competition Results</Text><Text style={styles.subtitle}>Season summary</Text></View>
        {canEdit && <TouchableOpacity onPress={() => setEdit({ visibility: "private" })} hitSlop={8} testID="result-add-btn"><Ionicons name="add-circle" size={26} color={colors.accent} /></TouchableOpacity>}
      </View>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {results.length === 0 ? <View style={styles.empty}><Ionicons name="trophy-outline" size={28} color={colors.textTertiary} /><Text style={styles.emptyText}>{canEdit ? "No results yet — tap + to add one after a competition." : "No results have been shared yet."}</Text></View> :
            results.map((r) => (
              <View key={r.id} style={styles.card} testID={`result-${r.id}`}>
                <View style={styles.rowT}><Text style={styles.rTitle}>{r.title}</Text>{r.placement ? <View style={styles.place}><Text style={styles.placeText}>{r.placement}</Text></View> : null}</View>
                <Text style={styles.rMeta}>{[r.date, r.division, r.score ? `Score ${r.score}` : ""].filter(Boolean).join(" · ")}</Text>
                {!!r.notes && <Text style={styles.rNotes}>{r.notes}</Text>}
                {canEdit && (
                  <View style={styles.actions}>
                    <View style={styles.visRow}><Text style={styles.visLbl}>{r.visibility === "team" ? "Shared with team" : "Staff only"}</Text><Switch value={r.visibility === "team"} onValueChange={() => toggleVis(r)} trackColor={{ true: colors.accent }} testID={`result-vis-${r.id}`} /></View>
                    <TouchableOpacity onPress={() => setEdit(r)} hitSlop={6} testID={`result-edit-${r.id}`}><Text style={styles.link}>Edit</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => del(r)} hitSlop={6}><Ionicons name="trash-outline" size={16} color="#DC2626" /></TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
        </ScrollView>
      )}

      <Modal visible={!!edit} transparent animationType="slide" onRequestClose={() => setEdit(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setEdit(null)}><Pressable style={styles.sheet} onPress={() => {}} testID="result-edit-modal">
          <ScrollView style={{ maxHeight: 500 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{edit?.id ? "Edit result" : "New result"}</Text>
            {([["title", "Competition name"], ["date", "Date  YYYY-MM-DD"], ["placement", "Placement (e.g. 1st)"], ["score", "Score (e.g. 96.5)"], ["division", "Division"], ["notes", "Notes"]] as const).map(([k, ph]) => (
              <TextInput key={k} style={styles.input} value={(edit as any)?.[k] || ""} onChangeText={(t) => setEdit((p) => ({ ...(p || {}), [k]: t }))} placeholder={ph} placeholderTextColor={colors.textTertiary} testID={`result-${k}-input`} multiline={k === "notes"} />
            ))}
            <View style={styles.visRow2}><Text style={styles.visLbl}>Share with team (athletes & parents)</Text><Switch value={edit?.visibility === "team"} onValueChange={(v) => setEdit((p) => ({ ...(p || {}), visibility: v ? "team" : "private" }))} trackColor={{ true: colors.accent }} testID="result-visibility-toggle" /></View>
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="result-save-btn">{saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Save result</Text>}</TouchableOpacity>
            <TouchableOpacity onPress={() => setEdit(null)} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </ScrollView>
        </Pressable></Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { ...typography.h3, color: c.textPrimary }, subtitle: { ...typography.caption, color: c.textSecondary },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  card: { backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  rowT: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, flex: 1 },
  place: { backgroundColor: c.accentSubtle, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }, placeText: { ...typography.caption, fontWeight: "800", color: c.accent },
  rMeta: { ...typography.caption, color: c.textSecondary, marginTop: 3 }, rNotes: { ...typography.caption, color: c.textPrimary, marginTop: 6 },
  actions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.borderSoft, paddingTop: spacing.sm },
  visRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }, visRow2: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10 },
  visLbl: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  link: { ...typography.caption, color: c.accent, fontWeight: "800" },
  empty: { alignItems: "center", gap: 10, padding: spacing.xl }, emptyText: { ...typography.body, color: c.textSecondary, textAlign: "center" as const },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: "92%" },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, ...typography.body, color: c.textPrimary, marginTop: 8 },
  saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 13, alignItems: "center", marginTop: spacing.md }, saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelText: { ...typography.body, color: c.textSecondary, fontWeight: "600" },
});
