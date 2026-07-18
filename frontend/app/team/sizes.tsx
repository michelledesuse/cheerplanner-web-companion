import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Column = { id: string; label: string; is_default: boolean; order: number };
type Sheet = { id: string; columns: Column[]; values: Record<string, Record<string, string>> };
type Member = { id: string; name: string; role: string; last_name?: string | null; first_name?: string | null; team_ids?: string[] | null };
type Team = { id: string; name: string };

const NAME_W = 132;
const CELL_W = 104;

export default function SizesScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const [colMenu, setColMenu] = useState<Column | null>(null);
  const [renameLabel, setRenameLabel] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, r, t] = await Promise.all([
        api.get<Sheet>("/team/sizes"),
        api.get<Member[]>("/roster"),
        api.get<Team[]>("/teams").catch(() => ({ data: [] as Team[] })),
      ]);
      setSheet(s.data);
      setMembers(r.data.filter((m) => m.role !== "parent"));
      setTeams(t.data || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const columns = useMemo(() => (sheet?.columns || []).slice().sort((a, b) => a.order - b.order), [sheet]);

  const visible = useMemo(() => {
    const list = members.filter((m) => {
      const tids = m.team_ids || [];
      if (teamFilter === null) return true;
      if (teamFilter === "none") return tids.length === 0;
      return tids.includes(teamFilter);
    });
    return list.sort((a, b) => {
      const al = (a.last_name || a.name || "").toLowerCase();
      const bl = (b.last_name || b.name || "").toLowerCase();
      if (al !== bl) return al.localeCompare(bl);
      return (a.first_name || "").toLowerCase().localeCompare((b.first_name || "").toLowerCase());
    });
  }, [members, teamFilter]);

  const valueOf = (mid: string, cid: string) => sheet?.values?.[mid]?.[cid] ?? "";

  const setLocalValue = (mid: string, cid: string, val: string) => {
    setSheet((prev) => {
      if (!prev) return prev;
      const values = { ...(prev.values || {}) };
      values[mid] = { ...(values[mid] || {}), [cid]: val };
      return { ...prev, values };
    });
  };

  const commitValue = async (mid: string, cid: string) => {
    try {
      const r = await api.put<Sheet>("/team/sizes/value", { member_id: mid, column_id: cid, value: valueOf(mid, cid) });
      setSheet(r.data);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save size.");
    }
  };

  const addColumn = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      const r = await api.post<Sheet>("/team/sizes/columns", { label: newLabel.trim() });
      setSheet(r.data); setNewLabel(""); setAddOpen(false);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not add column.");
    } finally { setSaving(false); }
  };

  const openColMenu = (c: Column) => { setColMenu(c); setRenameLabel(c.label); };

  const renameColumn = async () => {
    if (!colMenu || !renameLabel.trim()) return;
    try {
      const r = await api.patch<Sheet>(`/team/sizes/columns/${colMenu.id}`, { label: renameLabel.trim() });
      setSheet(r.data); setColMenu(null);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not rename."); }
  };

  const deleteColumn = () => {
    if (!colMenu) return;
    Alert.alert("Delete column?", `"${colMenu.label}" and its sizes will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          const r = await api.delete<Sheet>(`/team/sizes/columns/${colMenu.id}`);
          setSheet(r.data); setColMenu(null);
        } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="sizes-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sizes</Text>
        <TouchableOpacity onPress={() => { setNewLabel(""); setAddOpen(true); }} style={styles.addBtn} testID="sizes-add-column">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {teams.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.teamChips}>
          {[{ id: null as any, name: "All teams" }, ...teams, { id: "none", name: "No team" }].map((t) => {
            const active = teamFilter === t.id;
            return (
              <TouchableOpacity key={String(t.id)} onPress={() => setTeamFilter(t.id)} style={[styles.teamChip, active && styles.teamChipOn]} testID={`sizes-team-${t.id ?? "all"}`}>
                <Text style={[styles.teamChipText, active && styles.teamChipTextOn]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : visible.length === 0 ? (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={styles.emptyBlock}>
            <Ionicons name="shirt-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{members.length === 0 ? "No one on the roster yet" : "No one on this team"}</Text>
            <Text style={styles.emptyText}>Add athletes to your Roster, then track their sizes here.</Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="sizes-grid"
        >
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 40 }}>
            <View>
              {/* Header row */}
              <View style={styles.row}>
                <View style={[styles.headCell, { width: NAME_W }]}>
                  <Text style={styles.headText}>Member</Text>
                </View>
                {columns.map((c) => (
                  <TouchableOpacity key={c.id} style={[styles.headCell, { width: CELL_W }]} onPress={() => openColMenu(c)} testID={`sizes-col-${c.id}`}>
                    <Text style={styles.headText} numberOfLines={1}>{c.label}</Text>
                    <Ionicons name="ellipsis-horizontal" size={12} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </View>
              {/* Member rows */}
              {visible.map((m, idx) => (
                <View key={m.id} style={[styles.row, idx % 2 === 1 && styles.rowAlt]}>
                  <View style={[styles.nameCell, { width: NAME_W }]}>
                    <Text style={styles.nameText} numberOfLines={2}>{m.name}</Text>
                  </View>
                  {columns.map((c) => (
                    <View key={c.id} style={[styles.cell, { width: CELL_W }]}>
                      <TextInput
                        style={styles.cellInput}
                        value={valueOf(m.id, c.id)}
                        onChangeText={(v) => setLocalValue(m.id, c.id, v)}
                        onEndEditing={() => commitValue(m.id, c.id)}
                        placeholder="—"
                        placeholderTextColor={colors.textTertiary}
                        autoCapitalize="characters"
                        returnKeyType="done"
                        testID={`sizes-cell-${m.id}-${c.id}`}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      )}

      {/* Add column */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Add a size column</Text>
              <TextInput style={styles.input} value={newLabel} onChangeText={setNewLabel} placeholder="e.g. Warmup pants" placeholderTextColor={colors.textTertiary} testID="sizes-new-label" autoFocus />
              <TouchableOpacity style={[styles.confirm, saving && { opacity: 0.6 }]} onPress={addColumn} disabled={saving} testID="sizes-new-save">
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Add column</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Column menu (rename / delete) */}
      <Modal visible={!!colMenu} transparent animationType="slide" onRequestClose={() => setColMenu(null)}>
        <Pressable style={styles.backdrop} onPress={() => setColMenu(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Edit column</Text>
              <TextInput style={styles.input} value={renameLabel} onChangeText={setRenameLabel} placeholderTextColor={colors.textTertiary} testID="sizes-rename-label" />
              <TouchableOpacity style={styles.confirm} onPress={renameColumn} testID="sizes-rename-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteColumn} testID="sizes-col-delete">
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteText}>Delete column</Text>
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
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
  teamChips: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: 8 },
  teamChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  teamChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  teamChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  teamChipTextOn: { color: "white" },
  row: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderBottomColor: c.border },
  rowAlt: { backgroundColor: c.card },
  headCell: { paddingVertical: 12, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: c.border, backgroundColor: c.card, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  headText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  nameCell: { paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: c.border, justifyContent: "center" },
  nameText: { ...typography.caption, fontWeight: "700", color: c.textPrimary },
  cell: { borderRightWidth: 1, borderRightColor: c.border, justifyContent: "center" },
  cellInput: { paddingVertical: 10, paddingHorizontal: 8, ...typography.body, color: c.textPrimary, textAlign: "center" },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.md },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md, paddingVertical: 12 },
  deleteText: { color: c.danger, fontWeight: "700" },
});
