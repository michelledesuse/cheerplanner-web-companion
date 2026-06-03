import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { todayISO, formatCurrency } from "@/src/utils/format";
import DateField from "@/src/components/DateField";

type Athlete = { id: string; name: string; avatar_color?: string };

export default function ExpenseForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ athlete_id?: string; id?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("Tuition");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [incurredOn, setIncurredOn] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [paid, setPaid] = useState(false);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  // Multi-select set of athlete ids
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(params.athlete_id ? [params.athlete_id] : [])
  );
  const [splitMode, setSplitMode] = useState<"equal" | "same">("equal");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([api.get("/expenses/categories"), api.get("/athletes")]);
      setCategories(c.data.categories);
      setAthletes(a.data);
      // Default-select first if none and not edit
      if (selectedIds.size === 0 && !isEdit && a.data.length) {
        setSelectedIds(new Set([a.data[0].id]));
      }
      if (isEdit) {
        try {
          const all = await api.get("/expenses");
          const e = (all.data as any[]).find((x) => x.id === editingId);
          if (e) {
            setSelectedIds(new Set([e.athlete_id]));
            setCategory(e.category);
            setAmount(String(e.amount));
            setNote(e.note || "");
            setIncurredOn(e.incurred_on || "");
            setDueDate(e.due_date || "");
            setPaid(!!e.paid);
          }
        } finally { setLoading(false); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAthlete = (id: string) => {
    setSelectedIds((s) => {
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

  const save = async () => {
    if (selectedIds.size === 0) { Alert.alert("Missing", "Select at least one athlete."); return; }
    if (isNaN(amt) || amt <= 0) { Alert.alert("Missing", "Enter a valid amount."); return; }
    setSaving(true);
    try {
      if (isEdit) {
        const payload = {
          athlete_id: Array.from(selectedIds)[0],
          category, amount: amt, note: note || null,
          incurred_on: incurredOn || todayISO(), due_date: dueDate || null, paid,
        };
        await api.patch(`/expenses/${editingId}`, payload);
      } else if (selectedIds.size === 1) {
        const payload = {
          athlete_id: Array.from(selectedIds)[0],
          category, amount: amt, note: note || null,
          incurred_on: incurredOn || todayISO(), due_date: dueDate || null, paid,
        };
        await api.post("/expenses", payload);
      } else {
        // bulk
        await api.post("/expenses/bulk", {
          athlete_ids: Array.from(selectedIds),
          category, amount: amt, split_mode: splitMode,
          incurred_on: incurredOn || todayISO(), due_date: dueDate || null,
          note: note || null, paid,
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
          <Text style={styles.headerTitle}>{isEdit ? "Edit" : "New"} expense</Text>
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
                      testID={`expense-athlete-${a.id}`}
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
                      testID="split-equal"
                    >
                      <Text style={[styles.segmentText, splitMode === "equal" && styles.segmentTextActive]}>Split equally</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setSplitMode("same")}
                      style={[styles.segment, splitMode === "same" && styles.segmentActive]}
                      testID="split-same"
                    >
                      <Text style={[styles.segmentText, splitMode === "same" && styles.segmentTextActive]}>Same per athlete</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.splitHint}>
                    {splitMode === "equal"
                      ? `Each athlete: ${formatCurrency(perAthlete)} · Total ${formatCurrency(totalCost)}`
                      : `Each athlete: ${formatCurrency(perAthlete)} · Total ${formatCurrency(totalCost)}`}
                  </Text>
                </View>
              )}
            </>
          )}

          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>
            {categories.map((c) => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]} testID={`expense-cat-${c}`}>
                <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>
            Amount (USD) {selectedCount > 1 && splitMode === "equal" ? "— total to split" : ""}
            {selectedCount > 1 && splitMode === "same" ? "— per athlete" : ""}
          </Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="expense-amount-input" />

          <Text style={styles.label}>Date</Text>
          <DateField value={incurredOn} onChange={setIncurredOn} testID="expense-date-input" />

          <Text style={styles.label}>Due date (optional)</Text>
          <DateField value={dueDate} onChange={setDueDate} testID="expense-due-input" />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={note} onChangeText={setNote} placeholder="e.g. October tuition" placeholderTextColor={colors.textTertiary} multiline />

          <View style={styles.switchRow}>
            <Text style={styles.bodyText}>Already paid</Text>
            <Switch value={paid} onValueChange={setPaid} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="white" />
          </View>

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="expense-save-btn">
            {saving ? <ActivityIndicator color="white" /> : (
              <Text style={styles.saveBtnText}>
                {isEdit ? "Save changes" : selectedCount > 1 ? `Add ${selectedCount} expenses` : "Save expense"}
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
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  bodyText: { ...typography.bodyMedium, color: colors.textPrimary },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
