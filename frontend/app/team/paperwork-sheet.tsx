import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatDateTime12 } from "@/src/utils/format";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import TrackerGrid from "@/src/components/TrackerGrid";
import { buildGridRows, filterAndSplit, type GridMember } from "@/src/utils/rosterGroups";
import LinksEditor, { cleanLinks, type ExternalLink } from "@/src/components/LinksEditor";

type Item = { id: string; label: string; order: number; links?: ExternalLink[]; last_reminded_at?: string | null };
type Cell = { done?: boolean; note?: string | null };
type Sheet = { id: string; name: string; items: Item[]; values: Record<string, Record<string, Cell>> };
type Member = GridMember & { role: string };
type Team = { id: string; name: string };

export default function PaperworkSheetScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemLinks, setNewItemLinks] = useState<ExternalLink[]>([]);
  const [savingItem, setSavingItem] = useState(false);

  const [itemMenu, setItemMenu] = useState<Item | null>(null);
  const [renameLabel, setRenameLabel] = useState("");
  const [editItemLinks, setEditItemLinks] = useState<ExternalLink[]>([]);
  const [nudging, setNudging] = useState(false);

  const [sheetMenuOpen, setSheetMenuOpen] = useState(false);
  const [editName, setEditName] = useState("");

  const [memberModal, setMemberModal] = useState<Member | null>(null);
  const [tallyOpen, setTallyOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r, t] = await Promise.all([
        api.get<Sheet>(`/team/paperwork/${params.id}`),
        api.get<Member[]>("/roster"),
        api.get<Team[]>("/teams").catch(() => ({ data: [] as Team[] })),
      ]);
      setSheet(s.data);
      setMembers(r.data.filter((m) => m.role !== "parent"));
      setTeams(t.data || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, [params.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = useMemo(() => (sheet?.items || []).slice().sort((a, b) => a.order - b.order), [sheet]);

  const { rows, total } = useMemo(() => buildGridRows(members, teamFilter), [members, teamFilter]);
  const visibleAll = useMemo(() => filterAndSplit(members, teamFilter).all, [members, teamFilter]);

  const cell = (mid: string, iid: string): Cell => sheet?.values?.[mid]?.[iid] || {};

  const tally = useMemo(() => items.map((it) => {
    let done = 0;
    visibleAll.forEach((m) => { if (sheet?.values?.[m.id]?.[it.id]?.done) done += 1; });
    return { item: it, done, total: visibleAll.length };
  }), [items, visibleAll, sheet]);

  const toggleDone = async (mid: string, iid: string) => {
    if (!sheet) return;
    const cur = cell(mid, iid);
    try {
      const r = await api.put<Sheet>(`/team/paperwork/${sheet.id}/value`, { member_id: mid, item_id: iid, done: !cur.done });
      setSheet(r.data);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not update."); }
  };

  const setLocalNote = (mid: string, iid: string, note: string) => {
    setSheet((prev) => {
      if (!prev) return prev;
      const values = { ...(prev.values || {}) };
      const per = { ...(values[mid] || {}) };
      per[iid] = { ...(per[iid] || {}), note };
      values[mid] = per;
      return { ...prev, values };
    });
  };

  const commitNote = async (mid: string, iid: string) => {
    if (!sheet) return;
    try {
      const r = await api.put<Sheet>(`/team/paperwork/${sheet.id}/value`, { member_id: mid, item_id: iid, note: cell(mid, iid).note || "" });
      setSheet(r.data);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save note."); }
  };

  const addItem = async () => {
    if (!sheet || !newItemLabel.trim()) return;
    setSavingItem(true);
    try {
      const r = await api.post<Sheet>(`/team/paperwork/${sheet.id}/items`, { label: newItemLabel.trim(), links: cleanLinks(newItemLinks) });
      setSheet(r.data); setNewItemLabel(""); setNewItemLinks([]); setAddItemOpen(false);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not add item."); }
    finally { setSavingItem(false); }
  };

  const openItemMenu = (it: { id: string; label: string }) => {
    const full = items.find((x) => x.id === it.id) || null;
    setItemMenu(full); setRenameLabel(it.label); setEditItemLinks(full?.links || []);
  };

  const renameItem = async () => {
    if (!sheet || !itemMenu || !renameLabel.trim()) return;
    try {
      const r = await api.patch<Sheet>(`/team/paperwork/${sheet.id}/items/${itemMenu.id}`, { label: renameLabel.trim(), links: cleanLinks(editItemLinks) });
      setSheet(r.data); setItemMenu(null);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not rename."); }
  };

  const remindItem = () => {
    if (!sheet || !itemMenu) return;
    const it = itemMenu;
    Alert.alert(
      "Send reminder text?",
      `We'll text each person still missing "${it.label}", including any links. Athletes' texts go to the parent's number.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send texts", onPress: async () => {
          setNudging(true);
          try {
            const r = await api.post<{ sent: number; no_phone: string[]; failed: string[] }>(`/team/paperwork/${sheet.id}/items/${it.id}/remind`, {});
            const { sent, no_phone } = r.data;
            let msg = `Sent ${sent} reminder${sent === 1 ? "" : "s"}.`;
            if (no_phone?.length) msg += `\n\nNo phone on file: ${no_phone.join(", ")}.`;
            setItemMenu(null);
            await load();
            Alert.alert("Reminders sent", msg);
          } catch (e: any) {
            Alert.alert("Couldn't send", e?.response?.data?.detail || "Please try again.");
          } finally { setNudging(false); }
        } },
      ]
    );
  };

  const deleteItem = () => {
    if (!sheet || !itemMenu) return;
    Alert.alert("Delete item?", `"${itemMenu.label}" and its check-offs will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { const r = await api.delete<Sheet>(`/team/paperwork/${sheet.id}/items/${itemMenu.id}`); setSheet(r.data); setItemMenu(null); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  const openSheetMenu = () => { if (sheet) { setEditName(sheet.name); setSheetMenuOpen(true); } };

  const renameSheet = async () => {
    if (!sheet || !editName.trim()) return;
    try { await api.patch(`/team/paperwork/${sheet.id}`, { name: editName.trim() }); setSheetMenuOpen(false); await load(); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save."); }
  };

  const deleteSheet = () => {
    if (!sheet) return;
    Alert.alert("Delete sheet?", "This removes the sheet and all its records.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/team/paperwork/${sheet.id}`); router.back(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  if (loading || !sheet) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="paperwork-detail-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{sheet.name}</Text>
        <TouchableOpacity onPress={() => setTallyOpen(true)} style={styles.iconBtn} testID="paperwork-tally-open" hitSlop={8}>
          <Ionicons name="stats-chart-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openSheetMenu} style={styles.iconBtn} testID="paperwork-sheet-edit" hitSlop={8}>
          <Ionicons name="create-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setNewItemLabel(""); setAddItemOpen(true); }} style={styles.addBtn} testID="paperwork-add-item">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {teams.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.teamChips}>
          {[{ id: null as any, name: "All teams" }, ...teams, { id: "none", name: "No team" }].map((t) => {
            const active = teamFilter === t.id;
            return (
              <TouchableOpacity key={String(t.id)} onPress={() => setTeamFilter(t.id)} style={[styles.teamChip, active && styles.teamChipOn]} testID={`paperwork-team-${t.id ?? "all"}`}>
                <Text style={[styles.teamChipText, active && styles.teamChipTextOn]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {items.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="add-circle-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Add your first item</Text>
          <Text style={styles.emptyText}>Add items like &ldquo;Medical waiver&rdquo; or &ldquo;Code of conduct,&rdquo; then check them off per person.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setAddItemOpen(true)} testID="paperwork-empty-add">
            <Ionicons name="add" size={16} color="white" />
            <Text style={styles.emptyBtnText}>Add item</Text>
          </TouchableOpacity>
        </View>
      ) : total === 0 ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No one on this team</Text>
          <Text style={styles.emptyText}>Add people to your Roster to start checking off items.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>Tap a name to add notes. Tap a box to check off.</Text>
          <TrackerGrid
            rows={rows}
            columns={items.map((it) => ({ id: it.id, label: it.label }))}
            onNamePress={(m) => setMemberModal(m as Member)}
            onColumnPress={openItemMenu}
            nameWidth={140}
            cellWidth={92}
            renderCell={(m, c) => {
              const cv = cell(m.id, c.id);
              return (
                <TouchableOpacity style={styles.checkCell} onPress={() => toggleDone(m.id, c.id)} testID={`paperwork-cell-${m.id}-${c.id}`}>
                  <View style={[styles.box, cv.done && styles.boxOn]}>{cv.done && <Ionicons name="checkmark" size={16} color="white" />}</View>
                  {!!cv.note && <View style={styles.noteDot} />}
                </TouchableOpacity>
              );
            }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
            testID="paperwork-grid"
          />
        </>
      )}

      {/* Member detail: check-offs + notes */}
      <Modal visible={!!memberModal} transparent animationType="slide" onRequestClose={() => setMemberModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMemberModal(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheetModal} onPress={() => {}}>
              <Text style={styles.sheetTitle}>{memberModal?.name}</Text>
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
                {items.map((it) => {
                  const mid = memberModal?.id as string;
                  const cv = memberModal ? cell(mid, it.id) : {};
                  return (
                    <View key={it.id} style={styles.mItem}>
                      <TouchableOpacity style={styles.mItemHead} onPress={() => memberModal && toggleDone(mid, it.id)} testID={`paperwork-m-toggle-${it.id}`}>
                        <View style={[styles.box, cv.done && styles.boxOn]}>{cv.done && <Ionicons name="checkmark" size={16} color="white" />}</View>
                        <Text style={[styles.mItemLabel, cv.done && styles.mItemLabelDone]}>{it.label}</Text>
                      </TouchableOpacity>
                      <TextInput
                        style={styles.noteInput}
                        value={cv.note || ""}
                        onChangeText={(v) => memberModal && setLocalNote(mid, it.id, v)}
                        onEndEditing={() => memberModal && commitNote(mid, it.id)}
                        placeholder="Add a note (optional)"
                        placeholderTextColor={colors.textTertiary}
                        testID={`paperwork-m-note-${it.id}`}
                      />
                    </View>
                  );
                })}
              </ScrollView>
              <TouchableOpacity style={styles.confirm} onPress={() => setMemberModal(null)} testID="paperwork-m-done"><Text style={styles.confirmText}>Done</Text></TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Tally */}
      <Modal visible={tallyOpen} transparent animationType="slide" onRequestClose={() => setTallyOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setTallyOpen(false)}>
          <Pressable style={styles.sheetModal} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Completion</Text>
            <ScrollView style={{ maxHeight: 420 }} testID="paperwork-tally">
              {tally.length === 0 ? <Text style={styles.emptyText}>No items yet.</Text> : tally.map(({ item, done, total }) => {
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <View key={item.id} style={styles.tallyBlock}>
                    <View style={styles.tallyTitleRow}>
                      <Text style={styles.tallyItem}>{item.label}</Text>
                      <Text style={styles.tallyMeta}>{done}/{total}</Text>
                    </View>
                    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add item */}
      <Modal visible={addItemOpen} transparent animationType="slide" onRequestClose={() => setAddItemOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddItemOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheetModal} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Add an item</Text>
              <TextInput style={styles.input} value={newItemLabel} onChangeText={setNewItemLabel} placeholder="e.g. Medical waiver" placeholderTextColor={colors.textTertiary} testID="paperwork-new-item" autoFocus />
              <Text style={styles.itemLinkLabel}>Links (optional) — e.g. the waiver/form</Text>
              <LinksEditor value={newItemLinks} onChange={setNewItemLinks} testIDPrefix="paperwork-new-link" />
              <TouchableOpacity style={[styles.confirm, savingItem && { opacity: 0.6 }]} onPress={addItem} disabled={savingItem} testID="paperwork-new-item-save">
                {savingItem ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Add item</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Item menu */}
      <Modal visible={!!itemMenu} transparent animationType="slide" onRequestClose={() => setItemMenu(null)}>
        <Pressable style={styles.backdrop} onPress={() => setItemMenu(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheetModal} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Edit item</Text>
              <TextInput style={styles.input} value={renameLabel} onChangeText={setRenameLabel} placeholderTextColor={colors.textTertiary} testID="paperwork-rename-item" />
              <Text style={styles.itemLinkLabel}>Links (optional) — e.g. the waiver/form</Text>
              <LinksEditor value={editItemLinks} onChange={setEditItemLinks} testIDPrefix="paperwork-edit-link" />
              <TouchableOpacity style={styles.confirm} onPress={renameItem} testID="paperwork-rename-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.remindBtn, nudging && { opacity: 0.6 }]} disabled={nudging} onPress={remindItem} testID="paperwork-item-remind">
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
                <Text style={styles.remindText}>Text those still missing this</Text>
              </TouchableOpacity>
              {!!itemMenu?.last_reminded_at && (
                <Text style={styles.itemLastReminded} testID="paperwork-item-last-reminded">Last reminded {formatDateTime12(itemMenu.last_reminded_at)}</Text>
              )}
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteItem} testID="paperwork-item-delete">
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteText}>Delete item</Text>
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Sheet menu */}
      <Modal visible={sheetMenuOpen} transparent animationType="slide" onRequestClose={() => setSheetMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetMenuOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheetModal} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Edit sheet</Text>
              <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={colors.textTertiary} testID="paperwork-edit-name" />
              <TouchableOpacity style={styles.confirm} onPress={renameSheet} testID="paperwork-edit-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteSheet} testID="paperwork-sheet-delete">
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteText}>Delete sheet</Text>
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
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  teamChips: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: 8 },
  teamChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  teamChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  teamChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  teamChipTextOn: { color: "white" },
  hint: { ...typography.micro, color: c.textTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  row: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderBottomColor: c.border },
  rowAlt: { backgroundColor: c.card },
  headCell: { paddingVertical: 12, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: c.border, backgroundColor: c.card, justifyContent: "center" },
  headText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  nameCell: { paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: c.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  nameText: { ...typography.caption, fontWeight: "700", color: c.textPrimary, flex: 1 },
  checkCell: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: c.accent, borderColor: c.accent },
  noteDot: { position: "absolute", top: 8, right: 18, width: 7, height: 7, borderRadius: 999, backgroundColor: c.warningText || c.accent },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18, marginTop: spacing.md },
  emptyBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetModal: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.md },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
  itemLinkLabel: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  remindBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent + "33" },
  remindText: { ...typography.caption, fontWeight: "800", color: c.accent },
  itemLastReminded: { ...typography.micro, color: c.textTertiary, textAlign: "center", marginTop: 8 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md, paddingVertical: 12 },
  deleteText: { color: c.danger, fontWeight: "700" },
  mItem: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  mItemHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  mItemLabel: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700", flex: 1 },
  mItemLabelDone: { color: c.textSecondary },
  noteInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, ...typography.caption, color: c.textPrimary, marginTop: 8, marginLeft: 38 },
  tallyBlock: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  tallyTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  tallyItem: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  tallyMeta: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: c.divider, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: c.accent },
});
