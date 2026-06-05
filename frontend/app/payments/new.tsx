import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { todayISO, formatCurrency, formatDate } from "@/src/utils/format";
import DateField from "@/src/components/DateField";

const METHODS = ["Card", "Bank", "Cash", "Fundraiser", "Other"];

type Athlete = { id: string; name: string; avatar_color?: string };
type ExpenseLite = { id: string; category: string; amount: number; incurred_on: string; paid: boolean };

export default function PaymentForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ athlete_id?: string; id?: string; expense_id?: string; amount?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  const [amount, setAmount] = useState(params.amount || "");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState("Card");
  const [note, setNote] = useState("");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(params.athlete_id ? [params.athlete_id] : [])
  );
  const [splitMode, setSplitMode] = useState<"equal" | "same">("equal");
  const [unpaidExpenses, setUnpaidExpenses] = useState<ExpenseLite[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(
    new Set(params.expense_id ? [params.expense_id] : [])
  );
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    (async () => {
      const a = await api.get("/athletes");
      setAthletes(a.data);
      if (selectedIds.size === 0 && !isEdit && a.data.length) {
        setSelectedIds(new Set([a.data[0].id]));
      }
      if (isEdit) {
        try {
          const all = await api.get("/payments");
          const p = (all.data as any[]).find((x) => x.id === editingId);
          if (p) {
            setSelectedIds(new Set([p.athlete_id]));
            setAmount(String(p.amount));
            setPaidOn(p.paid_on || "");
            setMethod(p.method || "Card");
            setNote(p.note || "");
            setAppliedIds(new Set(p.applied_expense_ids || []));
          }
        } finally { setLoading(false); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a single athlete selected, fetch its unpaid expenses for the "apply to" picker
  useEffect(() => {
    (async () => {
      if (selectedIds.size !== 1) { setUnpaidExpenses([]); return; }
      const id = Array.from(selectedIds)[0];
      const r = await api.get(`/expenses?athlete_id=${id}`);
      setUnpaidExpenses((r.data as ExpenseLite[]).filter((e) => !e.paid || appliedIds.has(e.id)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, editingId]);

  const toggleAthlete = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    // Clear applied expenses when switching to multi
    setAppliedIds(new Set());
  };

  const toggleApply = (id: string) => {
    setAppliedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const amt = parseFloat(amount) || 0;
  const perAthlete = useMemo(() => {
    if (selectedCount === 0 || amt <= 0) return 0;
    return splitMode === "equal" ? +(amt / selectedCount).toFixed(2) : +amt.toFixed(2);
  }, [amt, splitMode, selectedCount]);
  const totalCost = useMemo(() => {
    if (selectedCount === 0 || amt <= 0) return 0;
    return splitMode === "equal" ? +amt.toFixed(2) : +(amt * selectedCount).toFixed(2);
  }, [amt, splitMode, selectedCount]);

  const appliedTotal = unpaidExpenses
    .filter((e) => appliedIds.has(e.id))
    .reduce((s, e) => s + Number(e.amount), 0);

  const save = async () => {
    if (selectedIds.size === 0) { Alert.alert("Missing", "Select at least one athlete."); return; }
    if (isNaN(amt) || amt <= 0) { Alert.alert("Missing", "Enter a valid amount."); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/payments/${editingId}`, {
          amount: amt, paid_on: paidOn || todayISO(), method, note: note || null,
          applied_expense_ids: Array.from(appliedIds),
        });
      } else if (selectedIds.size === 1) {
        await api.post("/payments", {
          athlete_id: Array.from(selectedIds)[0],
          amount: amt, paid_on: paidOn || todayISO(), method, note: note || null,
          applied_expense_ids: Array.from(appliedIds),
        });
      } else {
        await api.post("/payments/bulk", {
          athlete_ids: Array.from(selectedIds),
          amount: amt, split_mode: splitMode,
          paid_on: paidOn || todayISO(), method, note: note || null,
        });
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={{flex:1,alignItems:"center",justifyContent:"center"}}><ActivityIndicator color={colors.accent}/></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? "Edit" : "New"} payment</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {!isEdit && athletes.length > 0 && (
            <>
              <Text style={styles.label}>Athletes {selectedCount > 1 ? `(${selectedCount} selected)` : ""}</Text>
              <View style={styles.chips}>
                {athletes.map((a) => {
                  const on = selectedIds.has(a.id);
                  return (
                    <TouchableOpacity
                      key={a.id}
                      onPress={() => toggleAthlete(a.id)}
                      style={[styles.chip, on && styles.chipActive]}
                      testID={`payment-athlete-${a.id}`}
                    >
                      {on && <Ionicons name="checkmark" size={14} color="white" style={{ marginRight: 4 }} />}
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{a.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selectedCount > 1 && (
                <View style={styles.splitCard}>
                  <Text style={styles.label}>Split mode</Text>
                  <View style={styles.segmented}>
                    <TouchableOpacity
                      onPress={() => setSplitMode("equal")}
                      style={[styles.segment, splitMode === "equal" && styles.segmentActive]}
                      testID="payment-split-equal"
                    >
                      <Text style={[styles.segmentText, splitMode === "equal" && styles.segmentTextActive]}>Split equally</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setSplitMode("same")}
                      style={[styles.segment, splitMode === "same" && styles.segmentActive]}
                      testID="payment-split-same"
                    >
                      <Text style={[styles.segmentText, splitMode === "same" && styles.segmentTextActive]}>Same per athlete</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.splitHint}>
                    Each athlete: {formatCurrency(perAthlete)} · Total {formatCurrency(totalCost)}
                  </Text>
                </View>
              )}
            </>
          )}

          <Text style={styles.label}>
            Amount (USD) {selectedCount > 1 && splitMode === "equal" ? "— total to split" : ""}
            {selectedCount > 1 && splitMode === "same" ? "— per athlete" : ""}
          </Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="payment-amount-input" />

          <Text style={styles.label}>Date paid</Text>
          <DateField value={paidOn} onChange={setPaidOn} testID="payment-date-input" />

          <Text style={styles.label}>Method</Text>
          <View style={styles.chips}>
            {METHODS.map((m) => (
              <TouchableOpacity key={m} onPress={() => setMethod(m)} style={[styles.chip, method === m && styles.chipActive]}>
                <Text style={[styles.chipText, method === m && styles.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {selectedCount === 1 && unpaidExpenses.length > 0 && (
            <>
              <Text style={styles.label}>Apply to expenses (optional)</Text>
              <Text style={styles.helperText}>Selected expenses will be marked paid when fully covered. Total selected: {formatCurrency(appliedTotal)}</Text>
              <View style={{ gap: 8, marginTop: 4 }}>
                {unpaidExpenses.map((e) => {
                  const on = appliedIds.has(e.id);
                  return (
                    <TouchableOpacity
                      key={e.id}
                      onPress={() => toggleApply(e.id)}
                      style={[styles.expRow, on && styles.expRowOn]}
                      testID={`apply-expense-${e.id}`}
                    >
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on && <Ionicons name="checkmark" size={14} color="white" />}
                      </View>
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={styles.expTitle}>{e.category}</Text>
                        <Text style={styles.expMeta}>{formatDate(e.incurred_on)}</Text>
                      </View>
                      <Text style={styles.expAmount}>{formatCurrency(e.amount)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={note} onChangeText={setNote} multiline placeholder="e.g. October tuition" placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="payment-save-btn">
            {saving ? <ActivityIndicator color="white" /> : (
              <Text style={styles.saveBtnText}>
                {isEdit ? "Save changes" : selectedCount > 1 ? `Add ${selectedCount} payments` : "Save payment"}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: 6 },
  helperText: { ...typography.caption, color: colors.textTertiary, marginTop: -2, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  chipTextActive: { color: "white" },
  splitCard: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  segmented: { flexDirection: "row", backgroundColor: colors.bg, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { ...typography.caption, fontWeight: "700", color: colors.textSecondary },
  segmentTextActive: { color: "white" },
  splitHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  expRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  expRowOn: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  expTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  expMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  expAmount: { ...typography.h3, color: colors.textPrimary },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
