import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { todayISO, formatCurrency } from "@/src/utils/format";
import DateField from "@/src/components/DateField";
import AddTypeModal from "@/src/components/AddTypeModal";

type Athlete = { id: string; name: string; avatar_color?: string };

export default function ExpenseForm() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ athlete_id?: string; id?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  const [builtinCats, setBuiltinCats] = useState<string[]>([]);
  const [customCats, setCustomCats] = useState<string[]>([]);
  const categories = useMemo(() => [...builtinCats, ...customCats], [builtinCats, customCats]);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [category, setCategory] = useState<string>("Tuition");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [incurredOn, setIncurredOn] = useState(todayISO());
  // Mirror incurred_on into due_date by default; user can manually override.
  const [dueDate, setDueDate] = useState(todayISO());
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const handleIncurredOnChange = (next: string) => {
    setIncurredOn(next);
    if (!dueDateTouched) setDueDate(next);
  };
  const handleDueDateChange = (next: string) => {
    setDueDate(next);
    setDueDateTouched(true);
  };
  const addCategory = async (name: string) => {
    try {
      const r = await api.post("/household/custom-types/expense-category", { name });
      setCustomCats(r.data.expense_categories || []);
      setCategory(name);
      setAddCatOpen(false);
    } catch (e: any) {
      Alert.alert("Couldn't add", e?.response?.data?.detail || "Try a different name.");
    }
  };
  const deleteCategory = (name: string) => {
    Alert.alert(`Delete "${name}"?`, "Existing expenses keep this label — it's just removed from the picker.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          const r = await api.delete("/household/custom-types/expense-category", { data: { name } });
          setCustomCats(r.data.expense_categories || []);
          if (category === name) setCategory(builtinCats[0] || "Misc");
        } catch (_) { /* ignore */ }
      } },
    ]);
  };
  const [paid, setPaid] = useState(false);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<"none" | "monthly" | "weekly" | "biweekly">("none");
  const [recurrenceCount, setRecurrenceCount] = useState("1");
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
      setBuiltinCats(c.data.categories);
      setAthletes(a.data);
      try { const ht = await api.get("/household/custom-types"); setCustomCats(ht.data.expense_categories || []); } catch (_) { /* ignore */ }
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
            setDueDate(e.due_date || e.incurred_on || "");  // fallback to incurred_on for legacy data
            setDueDateTouched(true);  // editing existing record — user owns the value
            setPaid(!!e.paid);
            setReceiptImage(e.receipt_image || null);
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
          receipt_image: receiptImage,
        };
        await api.patch(`/expenses/${editingId}`, payload);
      } else if (selectedIds.size === 1) {
        const payload: any = {
          athlete_id: Array.from(selectedIds)[0],
          category, amount: amt, note: note || null,
          incurred_on: incurredOn || todayISO(), due_date: dueDate || null, paid,
          receipt_image: receiptImage,
        };
        if (recurrence !== "none") {
          payload.recurrence = recurrence;
          payload.recurrence_count = Math.max(1, parseInt(recurrenceCount) || 1);
        }
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

  const pickReceipt = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) Alert.alert("Permission needed", "Enable photo access in Settings.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.4,
        base64: true,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        const mime = a.mimeType || "image/jpeg";
        if (a.base64) setReceiptImage(`data:${mime};base64,${a.base64}`);
      }
    } catch (_e) { Alert.alert("Error", "Could not load image."); }
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
            {categories.map((c) => {
              const isCustom = customCats.includes(c);
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCategory(c)}
                  onLongPress={isCustom ? () => deleteCategory(c) : undefined}
                  style={[styles.chip, category === c && styles.chipActive]}
                  testID={`expense-cat-${c}`}
                >
                  <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => setAddCatOpen(true)} style={[styles.chip, styles.addChip]} testID="expense-cat-add">
              <Ionicons name="add" size={14} color={colors.accent} />
              <Text style={[styles.chipText, { color: colors.accent }]}>New</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>
            Amount (USD) {selectedCount > 1 && splitMode === "equal" ? "— total to split" : ""}
            {selectedCount > 1 && splitMode === "same" ? "— per athlete" : ""}
          </Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="expense-amount-input" />

          <Text style={styles.label}>Date</Text>
          <DateField value={incurredOn} onChange={handleIncurredOnChange} testID="expense-date-input" />

          <Text style={styles.label}>Due date</Text>
          <DateField value={dueDate} onChange={handleDueDateChange} testID="expense-due-input" />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={note} onChangeText={setNote} placeholder="e.g. October tuition" placeholderTextColor={colors.textTertiary} multiline />

          <View style={styles.switchRow}>
            <Text style={styles.bodyText}>Already paid</Text>
            <Switch value={paid} onValueChange={setPaid} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="white" />
          </View>

          {/* Receipt attachment */}
          <Text style={styles.label}>Receipt photo (optional)</Text>
          {receiptImage ? (
            <View style={styles.receiptBox}>
              <Image source={{ uri: receiptImage }} style={styles.receiptImg} resizeMode="contain" />
              <View style={styles.receiptActions}>
                <TouchableOpacity onPress={pickReceipt} style={styles.smallBtn}>
                  <Ionicons name="image" size={14} color={colors.accent} />
                  <Text style={styles.smallBtnText}>Replace</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setReceiptImage(null)} style={[styles.smallBtn, { backgroundColor: colors.dangerBg }]}>
                  <Ionicons name="trash" size={14} color={colors.dangerText} />
                  <Text style={[styles.smallBtnText, { color: colors.dangerText }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.receiptUpload} onPress={pickReceipt} testID="expense-pick-receipt">
              <Ionicons name="receipt-outline" size={22} color={colors.accent} />
              <Text style={styles.receiptUploadText}>Attach receipt photo</Text>
            </TouchableOpacity>
          )}

          {/* Recurrence — only available for single-athlete create (NOT edit, NOT multi) */}
          {!isEdit && selectedCount === 1 && (
            <>
              <Text style={styles.label}>Repeat (optional)</Text>
              <View style={styles.chips}>
                {(["none","weekly","biweekly","monthly"] as const).map((r) => (
                  <TouchableOpacity key={r} onPress={() => setRecurrence(r)} style={[styles.chip, recurrence === r && styles.chipActive]} testID={`recur-${r}`}>
                    <Text style={[styles.chipText, recurrence === r && styles.chipTextActive]}>
                      {r === "none" ? "One-time" : r === "biweekly" ? "Bi-weekly" : r[0].toUpperCase() + r.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {recurrence !== "none" && (
                <>
                  <Text style={styles.label}>How many occurrences?</Text>
                  <TextInput
                    style={styles.input}
                    value={recurrenceCount}
                    onChangeText={setRecurrenceCount}
                    keyboardType="number-pad"
                    placeholder="e.g. 12"
                    placeholderTextColor={colors.textTertiary}
                    testID="recur-count-input"
                  />
                  <Text style={styles.helperText}>Creates {parseInt(recurrenceCount) || 1} {recurrence} entries starting on the expense date.</Text>
                </>
              )}
            </>
          )}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="expense-save-btn">
            {saving ? <ActivityIndicator color="white" /> : (
              <Text style={styles.saveBtnText}>
                {isEdit ? "Save changes" : selectedCount > 1 ? `Add ${selectedCount} expenses` : "Save expense"}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      <AddTypeModal
        visible={addCatOpen}
        title="New category"
        placeholder="e.g. Choreo Deposit"
        onSubmit={(name) => addCategory(name)}
        onClose={() => setAddCatOpen(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  addChip: { gap: 4, borderStyle: "dashed", borderColor: colors.accent },
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
  helperText: { ...typography.caption, color: colors.textTertiary, marginTop: 4 },
  receiptUpload: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", backgroundColor: colors.card },
  receiptUploadText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
  receiptBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: "center" },
  receiptImg: { width: "100%", height: 220, borderRadius: radius.md, backgroundColor: colors.bg },
  receiptActions: { flexDirection: "row", gap: 8, marginTop: spacing.sm },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accentSubtle, borderRadius: 999 },
  smallBtnText: { color: colors.accent, fontWeight: "700", fontSize: 12 },
});
