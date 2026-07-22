import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import TrackerGrid from "@/src/components/TrackerGrid";
import { buildGridRows, filterAndSplit, isPersonnel, type GridMember } from "@/src/utils/rosterGroups";
import { shareTeamLink } from "@/src/utils/shareLink";

type Column = { id: string; label: string; is_default: boolean; order: number };
type Sheet = { id: string; columns: Column[]; values: Record<string, Record<string, string>> };
type Member = GridMember & { role: string };
type Team = { id: string; name: string };

const isSportsBra = (label: string) => label.trim().toLowerCase() === "sports bra";

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
  const [tallyOpen, setTallyOpen] = useState(false);

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
  const { rows, total } = useMemo(() => buildGridRows(members, teamFilter), [members, teamFilter]);
  const visibleAll = useMemo(() => filterAndSplit(members, teamFilter).all, [members, teamFilter]);

  const valueOf = (mid: string, cid: string) => sheet?.values?.[mid]?.[cid] ?? "";

  // Per-item tally. Personnel are excluded from the Sports bra column (they
  // don't get one) but are included in every other column's tally.
  const tally = useMemo(() => {
    return columns.map((c) => {
      const eligible = isSportsBra(c.label) ? visibleAll.filter((m) => !isPersonnel(m.role)) : visibleAll;
      const counts: Record<string, number> = {};
      let notSet = 0;
      eligible.forEach((m) => {
        const v = (sheet?.values?.[m.id]?.[c.id] ?? "").trim();
        if (!v) { notSet += 1; return; }
        counts[v] = (counts[v] || 0) + 1;
      });
      const tallyRows = Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
      return { column: c, rows: tallyRows, notSet, filled: eligible.length - notSet, eligible: eligible.length };
    });
  }, [columns, visibleAll, sheet]);

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

  const openColMenu = (c: { id: string; label: string }) => {
    const full = columns.find((x) => x.id === c.id) || null;
    setColMenu(full); setRenameLabel(c.label);
  };

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

  const renderCell = (m: GridMember, c: { id: string; label: string }) => {
    if (isSportsBra(c.label) && isPersonnel((m as Member).role)) {
      return <Text style={styles.naText}>N/A</Text>;
    }
    return (
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
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="sizes-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sizes</Text>
        <TouchableOpacity onPress={() => shareTeamLink("sizes")} style={styles.iconBtn} testID="sizes-share" hitSlop={8}>
          <Ionicons name="share-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/import/team_sizes" as any)} style={styles.iconBtn} testID="sizes-import" hitSlop={8}>
          <Ionicons name="cloud-upload-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTallyOpen(true)} style={styles.iconBtn} testID="sizes-tally-open" hitSlop={8}>
          <Ionicons name="stats-chart-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
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
      ) : total === 0 ? (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={styles.emptyBlock}>
            <Ionicons name="shirt-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{members.length === 0 ? "No one on the roster yet" : "No one on this team"}</Text>
            <Text style={styles.emptyText}>Add athletes to your Roster, then track their sizes here.</Text>
          </View>
        </ScrollView>
      ) : (
        <TrackerGrid
          rows={rows}
          columns={columns.map((c) => ({ id: c.id, label: c.label }))}
          renderCell={renderCell}
          onColumnPress={openColMenu}
          nameWidth={132}
          cellWidth={104}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="sizes-grid"
        />
      )}

      {/* Size tally by item */}
      <Modal visible={tallyOpen} transparent animationType="slide" onRequestClose={() => setTallyOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setTallyOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.tallyHeader}>
              <Text style={styles.sheetTitle}>Size tally</Text>
              <Text style={styles.tallySub}>{total} {total === 1 ? "person" : "people"}{teamFilter && teamFilter !== "none" ? " · this team" : ""}</Text>
            </View>
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: spacing.md }} testID="sizes-tally">
              {tally.map(({ column, rows: trows, notSet, filled, eligible }) => (
                <View key={column.id} style={styles.tallyBlock}>
                  <View style={styles.tallyTitleRow}>
                    <Text style={styles.tallyItem}>{column.label}</Text>
                    <Text style={styles.tallyMeta}>{filled}/{eligible} set</Text>
                  </View>
                  {trows.length === 0 ? (
                    <Text style={styles.tallyEmpty}>No sizes entered yet</Text>
                  ) : (
                    <View style={styles.tallyChips}>
                      {trows.map(([size, count]) => (
                        <View key={size} style={styles.tallyChip}>
                          <Text style={styles.tallyChipSize}>{size}</Text>
                          <View style={styles.tallyCountPill}><Text style={styles.tallyCountText}>{count}</Text></View>
                        </View>
                      ))}
                      {notSet > 0 && (
                        <View style={[styles.tallyChip, styles.tallyChipMuted]}>
                          <Text style={styles.tallyChipMutedText}>Not set</Text>
                          <View style={[styles.tallyCountPill, styles.tallyCountPillMuted]}><Text style={styles.tallyCountText}>{notSet}</Text></View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

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
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h1, color: c.textPrimary, flex: 1 },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  teamChips: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: 8 },
  teamChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  teamChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  teamChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  teamChipTextOn: { color: "white" },
  cellInput: { width: "100%", height: "100%", paddingHorizontal: 6, ...typography.body, color: c.textPrimary, textAlign: "center" },
  naText: { ...typography.caption, color: c.textTertiary, fontStyle: "italic" },
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
  tallyHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: spacing.sm },
  tallySub: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  tallyBlock: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  tallyTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  tallyItem: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  tallyMeta: { ...typography.caption, color: c.textSecondary },
  tallyEmpty: { ...typography.caption, color: c.textTertiary },
  tallyChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tallyChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accentSubtle, borderRadius: 999, paddingLeft: 12, paddingRight: 4, paddingVertical: 4, borderWidth: 1, borderColor: c.accent + "33" },
  tallyChipSize: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  tallyCountPill: { minWidth: 20, height: 20, borderRadius: 999, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  tallyCountText: { color: "white", fontSize: 11, fontWeight: "800" },
  tallyChipMuted: { backgroundColor: c.card, borderColor: c.border },
  tallyChipMutedText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  tallyCountPillMuted: { backgroundColor: c.textTertiary },
});
