import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { filterAndSplit, type GridMember } from "@/src/utils/rosterGroups";
import { shareTeamLink } from "@/src/utils/shareLink";
import { exportAoa } from "@/src/utils/exportFile";
import AttachSection from "@/src/components/AttachSection";
import LinksEditor, { cleanLinks, type ExternalLink } from "@/src/components/LinksEditor";

type Claim = { id: string; member_id?: string | null; guest_name?: string | null; qty: number; note?: string | null };
type SlotKind = "item" | "duty" | "time";
type Slot = { id: string; label: string; kind?: SlotKind; time_label?: string | null; qty_needed: number; order: number; claims: Claim[] };
type Sheet = { id: string; name: string; links?: ExternalLink[]; competition_ids?: string[]; event_ids?: string[]; slots: Slot[] };
type Member = GridMember & { role: string };

const KINDS: { value: SlotKind; label: string; icon: any }[] = [
  { value: "item", label: "Item", icon: "cube-outline" },
  { value: "duty", label: "Duty", icon: "people-outline" },
  { value: "time", label: "Time slot", icon: "time-outline" },
];

export default function SignupSheetScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [roster, setRoster] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [slotLabel, setSlotLabel] = useState("");
  const [slotQty, setSlotQty] = useState("1");
  const [slotKind, setSlotKind] = useState<SlotKind>("item");
  const [slotTime, setSlotTime] = useState("");
  const [savingSlot, setSavingSlot] = useState(false);

  const [slotMenu, setSlotMenu] = useState<Slot | null>(null);
  const [editSlotLabel, setEditSlotLabel] = useState("");
  const [editSlotQty, setEditSlotQty] = useState("1");
  const [editSlotKind, setEditSlotKind] = useState<SlotKind>("item");
  const [editSlotTime, setEditSlotTime] = useState("");

  const [sheetMenuOpen, setSheetMenuOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLinks, setEditLinks] = useState<ExternalLink[]>([]);
  const [nudging, setNudging] = useState(false);

  const [claimSlot, setClaimSlot] = useState<Slot | null>(null);
  const [claimMemberId, setClaimMemberId] = useState<string | null>(null);
  const [claimQty, setClaimQty] = useState("1");
  const [claimNote, setClaimNote] = useState("");
  const [claimSearch, setClaimSearch] = useState("");
  const [savingClaim, setSavingClaim] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api.get<Sheet>(`/team/signups/${params.id}`),
        api.get<Member[]>("/roster"),
      ]);
      setSheet(s.data);
      setRoster(r.data.filter((m) => m.role !== "parent"));
    } finally { setLoading(false); setRefreshing(false); }
  }, [params.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const slots = useMemo(() => {
    const claimedOf = (s: Slot) => (s.claims || []).reduce((n, c) => n + (c.qty || 1), 0);
    return (sheet?.slots || []).slice().sort((a, b) => {
      const af = claimedOf(a) >= a.qty_needed ? 1 : 0;
      const bf = claimedOf(b) >= b.qty_needed ? 1 : 0;
      if (af !== bf) return af - bf; // fully-filled slots sink to the bottom
      return a.order - b.order;
    });
  }, [sheet]);
  const memberName = (id?: string | null) => roster.find((m) => m.id === id)?.name || "Unknown";
  const claimName = (cl: Claim) => cl.guest_name || memberName(cl.member_id);
  const claimedQty = (slot: Slot) => (slot.claims || []).reduce((s, c) => s + (c.qty || 0), 0);

  const pickerGroups = useMemo(() => {
    const q = claimSearch.trim().toLowerCase();
    const list = q ? roster.filter((m) => m.name.toLowerCase().includes(q)) : roster;
    return filterAndSplit(list, null);
  }, [roster, claimSearch]);

  const addSlot = async () => {
    if (!sheet || !slotLabel.trim()) return;
    setSavingSlot(true);
    try {
      const r = await api.post<Sheet>(`/team/signups/${sheet.id}/slots`, {
        label: slotLabel.trim(),
        kind: slotKind,
        time_label: slotKind === "time" ? (slotTime.trim() || null) : null,
        qty_needed: Math.max(1, Number(slotQty) || 1),
      });
      setSheet(r.data); setSlotLabel(""); setSlotQty("1"); setSlotKind("item"); setSlotTime(""); setAddSlotOpen(false);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not add slot."); }
    finally { setSavingSlot(false); }
  };

  const openSlotMenu = (slot: Slot) => {
    setSlotMenu(slot); setEditSlotLabel(slot.label); setEditSlotQty(String(slot.qty_needed));
    setEditSlotKind(slot.kind || "item"); setEditSlotTime(slot.time_label || "");
  };

  const saveSlot = async () => {
    if (!sheet || !slotMenu || !editSlotLabel.trim()) return;
    try {
      const r = await api.patch<Sheet>(`/team/signups/${sheet.id}/slots/${slotMenu.id}`, {
        label: editSlotLabel.trim(),
        kind: editSlotKind,
        time_label: editSlotKind === "time" ? (editSlotTime.trim() || null) : null,
        qty_needed: Math.max(1, Number(editSlotQty) || 1),
      });
      setSheet(r.data); setSlotMenu(null);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save."); }
  };

  const deleteSlot = () => {
    if (!sheet || !slotMenu) return;
    Alert.alert("Delete slot?", `"${slotMenu.label}" and its sign-ups will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { const r = await api.delete<Sheet>(`/team/signups/${sheet.id}/slots/${slotMenu.id}`); setSheet(r.data); setSlotMenu(null); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  const openClaim = (slot: Slot) => { setClaimSlot(slot); setClaimMemberId(null); setClaimQty("1"); setClaimNote(""); setClaimSearch(""); };

  const submitClaim = async () => {
    if (!sheet || !claimSlot || !claimMemberId) { Alert.alert("Pick a person", "Choose who's signing up."); return; }
    setSavingClaim(true);
    try {
      const r = await api.post<Sheet>(`/team/signups/${sheet.id}/slots/${claimSlot.id}/claims`, { member_id: claimMemberId, qty: Math.max(1, Number(claimQty) || 1), note: claimNote.trim() || null });
      setSheet(r.data); setClaimSlot(null);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not sign up."); }
    finally { setSavingClaim(false); }
  };

  const removeClaim = async (slot: Slot, claim: Claim) => {
    if (!sheet) return;
    try {
      const r = await api.delete<Sheet>(`/team/signups/${sheet.id}/slots/${slot.id}/claims/${claim.id}`);
      setSheet(r.data);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not remove."); }
  };

  const openSheetMenu = () => { if (sheet) { setEditName(sheet.name); setEditLinks(sheet.links || []); setSheetMenuOpen(true); } };

  const saveSheet = async () => {
    if (!sheet || !editName.trim()) return;
    try { await api.patch(`/team/signups/${sheet.id}`, { name: editName.trim(), links: cleanLinks(editLinks) }); setSheetMenuOpen(false); await load(); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save."); }
  };

  const downloadList = async () => {
    if (!sheet) return;
    const aoa: (string | number)[][] = [["Slot", "Type", "Time", "Qty needed", "Signed up by", "Qty", "Note"]];
    for (const slot of slots) {
      const claims = slot.claims || [];
      if (claims.length === 0) {
        aoa.push([slot.label, slot.kind || "item", slot.time_label || "", slot.qty_needed, "(unclaimed)", "", ""]);
      } else {
        for (const cl of claims) {
          aoa.push([slot.label, slot.kind || "item", slot.time_label || "", slot.qty_needed, claimName(cl), cl.qty || 1, cl.note || ""]);
        }
      }
    }
    try {
      const safe = (sheet.name || "signup").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      await exportAoa(`signup-${safe}`, aoa, "csv", "Sign-ups");
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Could not export the list.");
    }
  };

  const sendReminder = () => {
    if (!sheet) return;
    Alert.alert(
      "Send sign-up reminder?",
      "We'll text each person on the roster who hasn't signed up yet, including any links on this sheet. Athletes' texts go to the parent's number.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send texts", onPress: async () => {
          setNudging(true);
          try {
            const r = await api.post<{ sent: number; no_phone: string[]; failed: string[] }>(`/team/signups/${sheet.id}/remind`, {});
            const { sent, no_phone } = r.data;
            let msg = `Sent ${sent} reminder${sent === 1 ? "" : "s"}.`;
            if (no_phone?.length) msg += `\n\nNo phone on file: ${no_phone.join(", ")}.`;
            Alert.alert("Reminders sent", msg);
          } catch (e: any) {
            Alert.alert("Couldn't send", e?.response?.data?.detail || "Please try again.");
          } finally { setNudging(false); }
        } },
      ]
    );
  };

  const deleteSheet = () => {
    if (!sheet) return;
    Alert.alert("Delete sheet?", "This removes the sheet and all sign-ups.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/team/signups/${sheet.id}`); router.back(); }
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
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="signup-detail-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{sheet.name}</Text>
          {((sheet.event_ids?.length || 0) + (sheet.competition_ids?.length || 0)) > 0 && (
            <Text style={styles.headerSub} numberOfLines={1}>
              🔗 Attached to {(sheet.event_ids?.length || 0) + (sheet.competition_ids?.length || 0)} item(s)
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => shareTeamLink("signup", sheet.id)} style={styles.iconBtn} testID="signup-share" hitSlop={8}>
          <Ionicons name="share-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openSheetMenu} style={styles.iconBtn} testID="signup-sheet-edit" hitSlop={8}>
          <Ionicons name="create-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setSlotLabel(""); setSlotQty("1"); setSlotKind("item"); setSlotTime(""); setAddSlotOpen(true); }} style={styles.addBtn} testID="signup-add-slot">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {slots.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="add-circle-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Add your first slot</Text>
          <Text style={styles.emptyText}>Add things people can sign up for &mdash; like &ldquo;Water ×12&rdquo; or &ldquo;Chaperone.&rdquo;</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setAddSlotOpen(true)} testID="signup-empty-add">
            <Ionicons name="add" size={16} color="white" />
            <Text style={styles.emptyBtnText}>Add slot</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="signup-detail"
        >
          {slots.map((slot) => {
            const claimed = claimedQty(slot);
            const remaining = Math.max(0, slot.qty_needed - claimed);
            const full = remaining === 0;
            return (
              <View key={slot.id} style={styles.slotCard}>
                <View style={styles.slotHead}>
                  <View style={styles.slotKindIcon}>
                    <Ionicons name={(KINDS.find((k) => k.value === (slot.kind || "item"))?.icon) || "cube-outline"} size={16} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.slotLabel}>{slot.label}</Text>
                    {!!slot.time_label && <Text style={styles.slotTime}>{slot.time_label}</Text>}
                    <Text style={[styles.slotMeta, full && { color: colors.successText }]}>{claimed}/{slot.qty_needed} filled{remaining > 0 ? ` · ${remaining} needed` : " · complete"}</Text>
                  </View>
                  <TouchableOpacity onPress={() => openSlotMenu(slot)} style={styles.slotEdit} testID={`signup-slot-edit-${slot.id}`} hitSlop={8}>
                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {(slot.claims || []).map((cl) => (
                  <View key={cl.id} style={styles.claimRow}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
                    <Text style={styles.claimName} numberOfLines={1}>{claimName(cl)}{cl.qty > 1 ? ` ×${cl.qty}` : ""}{cl.note ? ` — ${cl.note}` : ""}</Text>
                    <TouchableOpacity onPress={() => removeClaim(slot, cl)} testID={`signup-claim-remove-${cl.id}`} hitSlop={8}>
                      <Ionicons name="close" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity style={[styles.signupBtn, full && styles.signupBtnFull]} onPress={() => openClaim(slot)} testID={`signup-claim-add-${slot.id}`}>
                  <Ionicons name="add" size={15} color={full ? colors.textSecondary : colors.accent} />
                  <Text style={[styles.signupBtnText, full && { color: colors.textSecondary }]}>{full ? "Add another" : "Sign up"}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.deleteBar} onPress={deleteSheet} testID="signup-sheet-delete-bar">
        <Ionicons name="trash-outline" size={16} color={colors.danger} />
        <Text style={styles.deleteText}>Delete sheet</Text>
      </TouchableOpacity>

      {/* Claim (sign up) */}
      <Modal visible={!!claimSlot} transparent animationType="slide" onRequestClose={() => setClaimSlot(null)}>
        <Pressable style={styles.backdrop} onPress={() => setClaimSlot(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheetModal} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Sign up · {claimSlot?.label}</Text>
              <Text style={styles.label}>Who&apos;s signing up?</Text>
              <TextInput style={styles.input} value={claimSearch} onChangeText={setClaimSearch} placeholder="Search roster" placeholderTextColor={colors.textTertiary} testID="signup-claim-search" />
              <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                {(["Personnel", "Athletes"] as const).map((title) => {
                  const list = title === "Personnel" ? pickerGroups.personnel : pickerGroups.athletes;
                  if (list.length === 0) return null;
                  return (
                    <View key={title}>
                      <Text style={styles.pickerGroup}>{title}</Text>
                      {list.map((m) => (
                        <TouchableOpacity key={m.id} style={styles.pickerRow} onPress={() => setClaimMemberId(m.id)} testID={`signup-pick-${m.id}`}>
                          <View style={[styles.radio, claimMemberId === m.id && styles.radioOn]}>{claimMemberId === m.id && <View style={styles.radioDot} />}</View>
                          <Text style={styles.pickerName}>{m.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ width: 100 }}>
                  <Text style={styles.label}>Quantity</Text>
                  <TextInput style={styles.input} value={claimQty} onChangeText={setClaimQty} keyboardType="number-pad" testID="signup-claim-qty" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Note (optional)</Text>
                  <TextInput style={styles.input} value={claimNote} onChangeText={setClaimNote} placeholder="e.g. bringing Gatorade" placeholderTextColor={colors.textTertiary} testID="signup-claim-note" />
                </View>
              </View>
              <TouchableOpacity style={[styles.confirm, savingClaim && { opacity: 0.6 }]} onPress={submitClaim} disabled={savingClaim} testID="signup-claim-submit">
                {savingClaim ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Sign up</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Add slot */}
      <Modal visible={addSlotOpen} transparent animationType="slide" onRequestClose={() => setAddSlotOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddSlotOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheetModal} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Add a slot</Text>
              <Text style={styles.label}>Type</Text>
              <View style={styles.kindRow}>
                {KINDS.map((k) => (
                  <TouchableOpacity key={k.value} onPress={() => setSlotKind(k.value)} style={[styles.kindChip, slotKind === k.value && styles.kindChipOn]} testID={`signup-slot-kind-${k.value}`}>
                    <Ionicons name={k.icon} size={15} color={slotKind === k.value ? "white" : colors.textSecondary} />
                    <Text style={[styles.kindChipText, slotKind === k.value && styles.kindChipTextOn]}>{k.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>{slotKind === "duty" ? "Duty name" : slotKind === "time" ? "Slot name" : "What to sign up for"}</Text>
              <TextInput style={styles.input} value={slotLabel} onChangeText={setSlotLabel} placeholder={slotKind === "duty" ? "e.g. Chaperone" : slotKind === "time" ? "e.g. Front desk" : "e.g. Water bottles"} placeholderTextColor={colors.textTertiary} testID="signup-slot-label" autoFocus />
              {slotKind === "time" && (
                <>
                  <Text style={styles.label}>Time (optional)</Text>
                  <TextInput style={styles.input} value={slotTime} onChangeText={setSlotTime} placeholder="e.g. 9:00–10:00 AM" placeholderTextColor={colors.textTertiary} testID="signup-slot-time" />
                </>
              )}
              <Text style={styles.label}>{slotKind === "item" ? "How many needed" : "How many people needed"}</Text>
              <TextInput style={styles.input} value={slotQty} onChangeText={setSlotQty} keyboardType="number-pad" testID="signup-slot-qty" />
              <TouchableOpacity style={[styles.confirm, savingSlot && { opacity: 0.6 }]} onPress={addSlot} disabled={savingSlot} testID="signup-slot-save">
                {savingSlot ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Add slot</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Slot menu */}
      <Modal visible={!!slotMenu} transparent animationType="slide" onRequestClose={() => setSlotMenu(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSlotMenu(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheetModal} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Edit slot</Text>
              <Text style={styles.label}>Type</Text>
              <View style={styles.kindRow}>
                {KINDS.map((k) => (
                  <TouchableOpacity key={k.value} onPress={() => setEditSlotKind(k.value)} style={[styles.kindChip, editSlotKind === k.value && styles.kindChipOn]} testID={`signup-slot-edit-kind-${k.value}`}>
                    <Ionicons name={k.icon} size={15} color={editSlotKind === k.value ? "white" : colors.textSecondary} />
                    <Text style={[styles.kindChipText, editSlotKind === k.value && styles.kindChipTextOn]}>{k.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={editSlotLabel} onChangeText={setEditSlotLabel} placeholderTextColor={colors.textTertiary} testID="signup-slot-edit-label" />
              {editSlotKind === "time" && (
                <>
                  <Text style={styles.label}>Time (optional)</Text>
                  <TextInput style={styles.input} value={editSlotTime} onChangeText={setEditSlotTime} placeholder="e.g. 9:00–10:00 AM" placeholderTextColor={colors.textTertiary} testID="signup-slot-edit-time" />
                </>
              )}
              <Text style={styles.label}>{editSlotKind === "item" ? "How many needed" : "How many people needed"}</Text>
              <TextInput style={styles.input} value={editSlotQty} onChangeText={setEditSlotQty} keyboardType="number-pad" testID="signup-slot-edit-qty" />
              <TouchableOpacity style={styles.confirm} onPress={saveSlot} testID="signup-slot-edit-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteSlot} testID="signup-slot-delete">
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteText}>Delete slot</Text>
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
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={colors.textTertiary} testID="signup-edit-name" />
              <Text style={styles.label}>Sign-up links (optional)</Text>
              <LinksEditor value={editLinks} onChange={setEditLinks} testIDPrefix="signup-link" />
              {sheet && <AttachSection endpoint={`/team/signups/${sheet.id}`} competitionIds={sheet.competition_ids || []} eventIds={sheet.event_ids || []} onChange={(c, e) => setSheet((prev) => (prev ? { ...prev, competition_ids: c, event_ids: e } : prev))} />}
              <TouchableOpacity style={styles.confirm} onPress={saveSheet} testID="signup-edit-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => { setSheetMenuOpen(false); downloadList(); }} testID="signup-download">
                  <Ionicons name="download-outline" size={16} color={colors.accent} />
                  <Text style={styles.actionText}>Download list</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, nudging && { opacity: 0.6 }]} disabled={nudging} onPress={() => { setSheetMenuOpen(false); sendReminder(); }} testID="signup-remind">
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
                  <Text style={styles.actionText}>Send reminder text</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteSheet} testID="signup-sheet-delete">
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
  headerTitle: { ...typography.h2, color: c.textPrimary },
  headerSub: { ...typography.caption, color: c.accent, fontWeight: "700" },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  slotCard: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, marginBottom: spacing.md },
  slotHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  slotKindIcon: { width: 30, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accentSubtle },
  slotLabel: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  slotTime: { ...typography.caption, color: c.accent, fontWeight: "700", marginTop: 1 },
  slotMeta: { ...typography.caption, color: c.textSecondary, marginTop: 2, fontWeight: "700" },
  slotEdit: { padding: 4 },
  kindRow: { flexDirection: "row", gap: 8 },
  kindChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  kindChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  kindChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  kindChipTextOn: { color: "white" },
  claimRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  claimName: { ...typography.caption, color: c.textPrimary, flex: 1 },
  signupBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent + "33" },
  signupBtnFull: { backgroundColor: c.card, borderColor: c.border },
  signupBtnText: { ...typography.caption, fontWeight: "800", color: c.accent },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18, marginTop: spacing.md },
  emptyBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
  deleteBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  deleteText: { color: c.danger, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetModal: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  pickerGroup: { ...typography.micro, color: c.textSecondary, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginTop: spacing.md, marginBottom: 4 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 9 },
  radio: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: c.accent },
  radioDot: { width: 11, height: 11, borderRadius: 999, backgroundColor: c.accent },
  pickerName: { ...typography.bodyMedium, color: c.textPrimary },
  compRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  compChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, maxWidth: 220 },
  compChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  compChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  compChipTextOn: { color: "white" },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent + "33" },
  actionText: { ...typography.caption, fontWeight: "800", color: c.accent },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md, paddingVertical: 12 },
});
