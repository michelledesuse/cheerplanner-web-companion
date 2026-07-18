import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { formatCurrency, formatDate, todayISO } from "@/src/utils/format";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import DateField from "@/src/components/DateField";

type Entry = { member_id: string; paid: boolean; amount_paid?: number | null; method?: string | null; note?: string | null; paid_at?: string | null };
type Tracker = { id: string; name: string; amount?: number | null; note?: string | null; entries: Entry[]; summary: { paid_count: number; member_total: number; collected: number } };
type Member = { id: string; name: string; role: string };

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

  // Per-member payment sheet
  const [mMember, setMMember] = useState<Member | null>(null);
  const [mAmount, setMAmount] = useState("");
  const [mMethod, setMMethod] = useState("");
  const [mMethodOther, setMMethodOther] = useState("");
  const [mDate, setMDate] = useState(todayISO());
  const [mNote, setMNote] = useState("");
  const [mSaving, setMSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        api.get<Tracker>(`/team/payments/${params.id}`),
        api.get<Member[]>("/roster"),
      ]);
      setTracker(t.data);
      setRoster(r.data.filter((m) => m.role !== "parent"));
    } finally { setLoading(false); }
  }, [params.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const entryFor = (mid: string) => tracker?.entries.find((e) => e.member_id === mid);

  const openMember = (m: Member) => {
    const e = entryFor(m.id);
    setMMember(m);
    setMAmount(e?.amount_paid != null ? String(e.amount_paid) : (tracker?.amount != null ? String(tracker.amount) : ""));
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

  const openEdit = () => { if (tracker) { setEditName(tracker.name); setEditAmount(tracker.amount != null ? String(tracker.amount) : ""); setEditOpen(true); } };

  const saveEdit = async () => {
    if (!tracker || !editName.trim()) return;
    try {
      await api.patch(`/team/payments/${tracker.id}`, { name: editName.trim(), amount: editAmount ? Number(editAmount) : null });
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

  const { paid_count, member_total, collected } = tracker.summary;
  const pct = member_total > 0 ? Math.round((paid_count / member_total) * 100) : 0;
  const alreadyPaid = mMember ? !!entryFor(mMember.id)?.paid : false;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="payment-detail-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{tracker.name}</Text>
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
        </View>

        {roster.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>Add people to your Roster first &mdash; they&apos;ll appear here to record payments.</Text>
          </View>
        ) : roster.map((m) => {
          const e = entryFor(m.id);
          const paid = !!e?.paid;
          return (
            <TouchableOpacity key={m.id} style={styles.memberRow} onPress={() => openMember(m)} testID={`payment-member-${m.id}`}>
              <View style={[styles.check, paid && styles.checkOn]}>
                {paid ? <Ionicons name="checkmark" size={16} color="white" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.memberName, paid && styles.memberNamePaid]}>{m.name}</Text>
                {paid && (
                  <Text style={styles.memberDetail} numberOfLines={1}>
                    {e?.amount_paid != null ? formatCurrency(e.amount_paid) : ""}
                    {e?.method ? `${e?.amount_paid != null ? " · " : ""}${e.method}` : ""}
                    {e?.paid_at ? ` · ${formatDate(e.paid_at)}` : ""}
                  </Text>
                )}
              </View>
              <Text style={[styles.statusText, { color: paid ? colors.successText : colors.textTertiary }]}>{paid ? "Paid" : "Record"}</Text>
            </TouchableOpacity>
          );
        })}
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
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
                <Text style={styles.label}>Amount paid</Text>
                <TextInput style={styles.input} value={mAmount} onChangeText={setMAmount} placeholder={tracker.amount != null ? String(tracker.amount) : "e.g. 25"} placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" testID="payment-member-amount" />

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
              {alreadyPaid && (
                <TouchableOpacity style={styles.unpaidBtn} onPress={markUnpaid} disabled={mSaving} testID="payment-member-unpaid">
                  <Text style={styles.unpaidText}>Mark unpaid</Text>
                </TouchableOpacity>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Edit tracker</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={colors.textTertiary} testID="payment-edit-name" />
            <Text style={styles.label}>Expected amount per person (optional)</Text>
            <TextInput style={styles.input} value={editAmount} onChangeText={setEditAmount} keyboardType="decimal-pad" placeholderTextColor={colors.textTertiary} testID="payment-edit-amount" />
            <TouchableOpacity style={styles.confirm} onPress={saveEdit} testID="payment-edit-save"><Text style={styles.confirmText}>Save</Text></TouchableOpacity>
          </Pressable>
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
  progressTrack: { height: 10, borderRadius: 999, backgroundColor: c.divider, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 999, backgroundColor: c.accent },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, marginBottom: spacing.sm },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: c.accent, borderColor: c.accent },
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
