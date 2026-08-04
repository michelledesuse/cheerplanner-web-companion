import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { formatCurrency, formatDate, formatDateTime12, todayISO } from "@/src/utils/format";
import { colors, radius, spacing, typography } from "@/src/theme";
import ManageAccessButton from "@/src/components/ManageAccessButton";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import DateField from "@/src/components/DateField";
import AttachSection from "@/src/components/AttachSection";
import LinksEditor, { cleanLinks, type ExternalLink } from "@/src/components/LinksEditor";
import PhotoGallery from "@/src/components/PhotoGallery";
import { filterAndSplit, type GridMember } from "@/src/utils/rosterGroups";

type Entry = { member_id: string; paid: boolean; amount_paid?: number | null; amount_due?: number | null; method?: string | null; note?: string | null; paid_at?: string | null };
type Tracker = { id: string; name: string; amount?: number | null; note?: string | null; links?: ExternalLink[]; photos?: string[]; season_ids?: string[]; last_reminded_at?: string | null; entries: Entry[]; excluded_member_ids?: string[]; competition_ids?: string[]; event_ids?: string[]; summary: { paid_count: number; member_total: number; collected: number; outstanding: number | null; short_count: number; unpaid_count: number } };
type Member = GridMember & { role: string; phone?: string | null; parent_phone?: string | null };

const METHODS = ["Cash", "Check", "Venmo", "Zelle", "CashApp", "PayPal", "Card", "Other"];

export default function PaymentDetail() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [roster, setRoster] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editLinks, setEditLinks] = useState<ExternalLink[]>([]);
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [nudging, setNudging] = useState(false);

  // Per-member payment sheet
  const [mMember, setMMember] = useState<Member | null>(null);
  const [mAmount, setMAmount] = useState("");
  const [mDue, setMDue] = useState("");
  const [mMethod, setMMethod] = useState("");
  const [mMethodOther, setMMethodOther] = useState("");
  const [mDate, setMDate] = useState(todayISO());
  const [mNote, setMNote] = useState("");
  const [mSaving, setMSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await api.get<Tracker>(`/team/payments/${params.id}`);
      const sid = t.data.season_ids?.[0];
      const r = await api.get<Member[]>("/roster", { params: sid ? { season_id: sid } : {} });
      setTracker(t.data);
      setRoster(r.data.filter((m) => m.role !== "parent"));
    } finally { setLoading(false); }
  }, [params.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const entryFor = (mid: string) => tracker?.entries.find((e) => e.member_id === mid);

  const openMember = (m: Member) => {
    const e = entryFor(m.id);
    setMMember(m);
    setMDue(e?.amount_due != null ? String(e.amount_due) : "");
    setMAmount(e?.amount_paid != null ? String(e.amount_paid) : (e?.amount_due != null ? String(e.amount_due) : (tracker?.amount != null ? String(tracker.amount) : "")));
    if (e?.method && METHODS.includes(e.method)) { setMMethod(e.method); setMMethodOther(""); }
    else if (e?.method) { setMMethod("Other"); setMMethodOther(e.method); }
    else { setMMethod(""); setMMethodOther(""); }
    setMDate(e?.paid_at ? e.paid_at.slice(0, 10) : todayISO());
    setMNote(e?.note || "");
  };

  const closeMember = () => setMMember(null);

  const saveMember = async () => {
    if (!tracker || !mMember) return;
    const method = mMethod === "Other" ? mMethodOther.trim() : mMethod;
    setMSaving(true);
    try {
      const r = await api.put<Tracker>(`/team/payments/${tracker.id}/member/${mMember.id}`, {
        paid: true,
        amount_paid: mAmount.trim() ? Number(mAmount) : null,
        amount_due: mDue.trim() ? Number(mDue) : null,
        method: method || null,
        paid_at: mDate || todayISO(),
        note: mNote.trim() || null,
      });
      setTracker(r.data);
      closeMember();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save.");
    } finally { setMSaving(false); }
  };

  const saveDueOnly = async () => {
    if (!tracker || !mMember) return;
    setMSaving(true);
    try {
      const r = await api.put<Tracker>(`/team/payments/${tracker.id}/member/${mMember.id}`, {
        amount_due: mDue.trim() ? Number(mDue) : null,
      });
      setTracker(r.data);
      closeMember();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save.");
    } finally { setMSaving(false); }
  };

  const markUnpaid = async () => {
    if (!tracker || !mMember) return;
    setMSaving(true);
    try {
      const r = await api.put<Tracker>(`/team/payments/${tracker.id}/member/${mMember.id}`, { paid: false });
      setTracker(r.data);
      closeMember();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not update.");
    } finally { setMSaving(false); }
  };

  const toggleExclude = async (val: boolean) => {
    if (!tracker || !mMember) return;
    setMSaving(true);
    try {
      const r = await api.put<Tracker>(`/team/payments/${tracker.id}/member/${mMember.id}/exclude`, { excluded: val });
      setTracker(r.data);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not update.");
    } finally { setMSaving(false); }
  };

  const openEdit = () => { if (tracker) { setEditName(tracker.name); setEditAmount(tracker.amount != null ? String(tracker.amount) : ""); setEditLinks(tracker.links || []); setEditPhotos(tracker.photos || []); setEditOpen(true); } };

  const saveEdit = async () => {
    if (!tracker || !editName.trim()) return;
    try {
      await api.patch(`/team/payments/${tracker.id}`, { name: editName.trim(), amount: editAmount ? Number(editAmount) : null, links: cleanLinks(editLinks), photos: editPhotos });
      setEditOpen(false); await load();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save."); }
  };

  const remove = () => {
    if (!tracker) return;
    Alert.alert("Delete tracker?", "This removes it and all payment records.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/team/payments/${tracker.id}`); router.back(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  if (loading || !tracker) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  const { paid_count, member_total, collected, outstanding, short_count } = tracker.summary;
  const pct = member_total > 0 ? Math.round((paid_count / member_total) * 100) : 0;
  const alreadyPaid = mMember ? !!entryFor(mMember.id)?.paid : false;
  const mExcluded = mMember ? (tracker.excluded_member_ids || []).includes(mMember.id) : false;
  const groups = filterAndSplit(roster, null);
  const expected = tracker.amount;

  const dueFor = (m: Member): number | null => {
    const e = entryFor(m.id);
    if (e?.amount_due != null) return e.amount_due;
    return expected != null ? expected : null;
  };

  const owedFor = (m: Member) => {
    if ((tracker.excluded_member_ids || []).includes(m.id)) return 0; // exempt — never owes
    const e = entryFor(m.id);
    const paid = !!e?.paid;
    const due = dueFor(m);
    const paidAmt = paid ? (e?.amount_paid != null ? e.amount_paid : (due ?? 0)) : 0;
    return due != null ? Math.max(0, due - paidAmt) : (paid ? 0 : -1); // -1 = owing but no $ target
  };
  const nudgeOwing = async () => {
    const owing = (groups.all as Member[]).filter((m) => owedFor(m) !== 0);
    if (owing.length === 0) { Alert.alert("All caught up", "Everyone has paid in full."); return; }
    Alert.alert(
      "Text everyone who owes?",
      `We'll send a separate, private reminder text to each person who still owes${expected != null ? ` (${formatCurrency(expected)} per person)` : ""}. Athletes' texts go to the parent's number.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send texts", onPress: async () => {
          setNudging(true);
          try {
            const r = await api.post<{ sent: number; no_phone: string[]; failed: string[] }>(`/team/payments/${tracker.id}/remind`, {});
            const { sent, no_phone, failed } = r.data;
            let msg = `Sent ${sent} individual reminder${sent === 1 ? "" : "s"}.`;
            if (no_phone.length) msg += `\n\nNo phone on file for: ${no_phone.slice(0, 8).join(", ")}${no_phone.length > 8 ? "…" : ""}.`;
            if (failed.length) msg += `\n\nCouldn't reach: ${failed.slice(0, 8).join(", ")}.`;
            if (sent > 0) await load();
            Alert.alert(sent > 0 ? "Reminders sent" : "Nothing sent", msg);
          } catch (e: any) {
            Alert.alert("Couldn't send", e?.response?.data?.detail || "Please try again.");
          } finally { setNudging(false); }
        } },
      ],
    );
  };

  const owingCount = (groups.all as Member[]).filter((m) => owedFor(m) !== 0).length;

  const renderRow = (m: Member) => {
    const e = entryFor(m.id);
    const paid = !!e?.paid;
    const excluded = (tracker.excluded_member_ids || []).includes(m.id);
    const owed = owedFor(m);
    const isShort = owed > 0;
    return (
      <TouchableOpacity key={m.id} style={styles.memberRow} onPress={() => openMember(m)} testID={`payment-member-${m.id}`}>
        <View style={[styles.check, paid && !excluded && styles.checkOn, excluded && styles.checkExempt]}>
          {excluded ? <Ionicons name="remove" size={16} color={colors.textTertiary} /> : (paid ? <Ionicons name="checkmark" size={16} color="white" /> : null)}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.memberName, paid && styles.memberNamePaid, excluded && { color: colors.textTertiary }]}>{m.name}</Text>
          {paid && !excluded && (
            <Text style={styles.memberDetail} numberOfLines={1}>
              {e?.amount_paid != null ? formatCurrency(e.amount_paid) : ""}
              {e?.method ? `${e?.amount_paid != null ? " · " : ""}${e.method}` : ""}
              {e?.paid_at ? ` · ${formatDate(e.paid_at)}` : ""}
            </Text>
          )}
        </View>
        {excluded ? (
          <Text style={styles.exemptTag}>Exempt</Text>
        ) : isShort ? (
          <Text style={styles.oweTag}>owes {formatCurrency(owed)}</Text>
        ) : (
          <Text style={[styles.statusText, { color: paid ? colors.successText : colors.textTertiary }]}>{paid ? "Paid" : "Record"}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="payment-detail-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{tracker.name}</Text>
        <ManageAccessButton resource="payment" resourceId={tracker.id} />
        <TouchableOpacity onPress={openEdit} style={styles.iconBtn} testID="payment-edit" hitSlop={8}>
          <Ionicons name="create-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} testID="payment-detail">
        <View style={styles.summaryCard}>
          {tracker.amount != null && <Text style={styles.summaryAmount}>Expected {formatCurrency(tracker.amount)} per person</Text>}
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={styles.summaryMeta}>{paid_count}/{member_total} paid</Text>
            <Text style={styles.summaryMeta}>{formatCurrency(collected)} collected</Text>
          </View>
          {short_count > 0 && (
            <View style={styles.oweBanner} testID="payment-owe-banner">
              <Ionicons name="alert-circle" size={15} color={colors.warningText} />
              <Text style={styles.oweBannerText}>
                {short_count} {short_count === 1 ? "person owes" : "people owe"}{outstanding != null ? ` · ${formatCurrency(outstanding)} outstanding` : ""}
              </Text>
            </View>
          )}
          {owingCount > 0 && (
            <TouchableOpacity style={[styles.nudgeBtn, nudging && { opacity: 0.6 }]} onPress={nudgeOwing} disabled={nudging} testID="payment-nudge">
              {nudging ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="chatbubble-ellipses-outline" size={16} color="white" />}
              <Text style={styles.nudgeText}>Text who owes ({owingCount})</Text>
            </TouchableOpacity>
          )}
          {!!tracker?.last_reminded_at && (
            <Text style={styles.lastReminded} testID="payment-last-reminded">Last reminded {formatDateTime12(tracker.last_reminded_at)}</Text>
          )}
        </View>

        {roster.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>Add people to your Roster first &mdash; they&apos;ll appear here to record payments.</Text>
          </View>
        ) : (
          <>
            {groups.personnel.length > 0 && (
              <>
                <Text style={styles.groupHeader}>Personnel</Text>
                {groups.personnel.map(renderRow)}
              </>
            )}
            {groups.athletes.length > 0 && (
              <>
                <Text style={styles.groupHeader}>Athletes</Text>
                {groups.athletes.map(renderRow)}
              </>
            )}
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.deleteBtn} onPress={remove} testID="payment-delete">
        <Ionicons name="trash-outline" size={16} color={colors.danger} />
        <Text style={styles.deleteText}>Delete tracker</Text>
      </TouchableOpacity>

      {/* Per-member payment sheet */}
      <Modal visible={!!mMember} transparent animationType="slide" onRequestClose={closeMember}>
        <Pressable style={styles.backdrop} onPress={closeMember}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>{mMember?.name}</Text>

              <View style={styles.exemptRow}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={styles.exemptLabel}>Not required to pay</Text>
                  <Text style={styles.exemptSub}>Exclude from totals &amp; the &ldquo;who owes&rdquo; list (e.g. doesn&apos;t need this item).</Text>
                </View>
                <Switch value={mExcluded} onValueChange={toggleExclude} disabled={mSaving} trackColor={{ true: colors.accent, false: colors.divider }} testID="payment-member-exclude" />
              </View>

              {mExcluded ? (
                <TouchableOpacity style={styles.confirm} onPress={closeMember} testID="payment-member-done"><Text style={styles.confirmText}>Done</Text></TouchableOpacity>
              ) : (
              <>
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
                <Text style={styles.label}>Amount due {tracker.amount != null ? `(default ${formatCurrency(tracker.amount)})` : "(optional)"}</Text>
                <TextInput style={styles.input} value={mDue} onChangeText={setMDue} placeholder={tracker.amount != null ? String(tracker.amount) : "e.g. 50"} placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" testID="payment-member-due" />
                <Text style={styles.dueHint}>Leave blank to use the tracker default. Set a different amount for this person if needed.</Text>

                <Text style={styles.label}>Amount paid</Text>
                <TextInput style={styles.input} value={mAmount} onChangeText={setMAmount} placeholder={mDue.trim() || (tracker.amount != null ? String(tracker.amount) : "e.g. 25")} placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" testID="payment-member-amount" />

                <Text style={styles.label}>Payment method</Text>
                <View style={styles.methodRow}>
                  {METHODS.map((mth) => (
                    <TouchableOpacity key={mth} onPress={() => setMMethod(mth)} style={[styles.methodChip, mMethod === mth && styles.methodChipOn]} testID={`payment-method-${mth}`}>
                      <Text style={[styles.methodChipText, mMethod === mth && styles.methodChipTextOn]}>{mth}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {mMethod === "Other" && (
                  <TextInput style={[styles.input, { marginTop: 8 }]} value={mMethodOther} onChangeText={setMMethodOther} placeholder="Method name" placeholderTextColor={colors.textTertiary} testID="payment-method-other" />
                )}

                <Text style={styles.label}>Date paid</Text>
                <DateField value={mDate} onChange={setMDate} testID="payment-member-date" clearable={false} />

                <Text style={styles.label}>Note (optional)</Text>
                <TextInput style={[styles.input, { height: 70, textAlignVertical: "top" }]} value={mNote} onChangeText={setMNote} placeholder="e.g. partial payment, owes $10" placeholderTextColor={colors.textTertiary} multiline testID="payment-member-note" />
              </ScrollView>

              <TouchableOpacity style={[styles.confirm, mSaving && { opacity: 0.6 }]} onPress={saveMember} disabled={mSaving} testID="payment-member-save">
                {mSaving ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>{alreadyPaid ? "Update payment" : "Mark paid"}</Text>}
              </TouchableOpacity>
              {alreadyPaid ? (
                <TouchableOpacity style={styles.unpaidBtn} onPress={markUnpaid} disabled={mSaving} testID="payment-member-unpaid">
                  <Text style={styles.unpaidText}>Mark unpaid</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.unpaidBtn} onPress={saveDueOnly} disabled={mSaving} testID="payment-member-savedue">
                  <Text style={styles.unpaidText}>Save</Text>
                </TouchableOpacity>
              )}
              </>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Edit tracker</Text>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={colors.textTertiary} testID="payment-edit-name" />
              <Text style={styles.label}>Expected amount per person (optional)</Text>
              <TextInput style={styles.input} value={editAmount} onChangeText={setEditAmount} keyboardType="decimal-pad" placeholderTextColor={colors.textTertiary} testID="payment-edit-amount" returnKeyType="done" />
              <Text style={styles.label}>Payment links (optional)</Text>
              <LinksEditor value={editLinks} onChange={setEditLinks} testIDPrefix="payment-edit-link" />
              <PhotoGallery photos={editPhotos} onChange={setEditPhotos} testIDPrefix="payment-photo" />
              {tracker && <AttachSection endpoint={`/team/payments/${tracker.id}`} competitionIds={tracker.competition_ids || []} eventIds={tracker.event_ids || []} onChange={(c, e) => setTracker((prev) => (prev ? { ...prev, competition_ids: c, event_ids: e } : prev))} />}
              <TouchableOpacity style={styles.confirm} onPress={saveEdit} testID="payment-edit-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
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
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  summaryCard: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, marginBottom: spacing.md },
  summaryAmount: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, marginBottom: 8 },
  summaryMeta: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  groupHeader: { ...typography.micro, color: c.textSecondary, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.md, marginBottom: 4 },
  oweBanner: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, backgroundColor: (c.warningText || c.accent) + "1A", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  oweBannerText: { ...typography.caption, color: c.warningText || c.accent, fontWeight: "800" },
  oweTag: { ...typography.caption, color: c.warningText || c.accent, fontWeight: "800" },
  nudgeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12 },
  nudgeText: { color: "white", fontWeight: "800", fontSize: 14 },
  lastReminded: { ...typography.micro, color: c.textTertiary, textAlign: "center", marginTop: 8 },
  progressTrack: { height: 10, borderRadius: 999, backgroundColor: c.divider, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 999, backgroundColor: c.accent },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, marginBottom: spacing.sm },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: c.accent, borderColor: c.accent },
  checkExempt: { backgroundColor: c.divider, borderColor: c.border },
  exemptTag: { ...typography.caption, color: c.textTertiary, fontWeight: "800" },
  exemptRow: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, marginBottom: spacing.sm },
  exemptLabel: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary },
  exemptSub: { ...typography.caption, color: c.textTertiary, marginTop: 2, lineHeight: 16 },
  dueHint: { ...typography.caption, color: c.textTertiary, marginTop: 4, marginBottom: 2, lineHeight: 15 },
  memberName: { ...typography.bodyMedium, color: c.textPrimary },
  memberNamePaid: { color: c.textPrimary, fontWeight: "700" },
  memberDetail: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  statusText: { ...typography.caption, fontWeight: "700" },
  emptyBlock: { padding: spacing.xl, alignItems: "center" },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  deleteText: { color: c.danger, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  methodRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  methodChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  methodChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  methodChipTextOn: { color: "white" },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
  unpaidBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  unpaidText: { color: c.danger, fontWeight: "700" },
});
