import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { todayDisplay, userDateToISO } from "@/src/utils/format";

export default function NewExpense() {
  const router = useRouter();
  const params = useLocalSearchParams<{ athlete_id?: string }>();
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("Tuition");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [incurredOn, setIncurredOn] = useState(todayDisplay());
  const [dueDate, setDueDate] = useState("");
  const [paid, setPaid] = useState(false);
  const [athletes, setAthletes] = useState<{ id: string; name: string }[]>([]);
  const [athleteId, setAthleteId] = useState<string>(params.athlete_id || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, a] = await Promise.all([api.get("/expenses/categories"), api.get("/athletes")]);
        setCategories(c.data.categories);
        setAthletes(a.data);
        if (!athleteId && a.data.length) setAthleteId(a.data[0].id);
      } catch (_e) { /* noop */ }
    })();
  }, []);

  const save = async () => {
    if (!athleteId) { Alert.alert("Missing", "Select an athlete first."); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { Alert.alert("Missing", "Enter a valid amount."); return; }
    setSaving(true);
    try {
      await api.post("/expenses", {
        athlete_id: athleteId, category, amount: amt, note: note || null,
        incurred_on: userDateToISO(incurredOn), due_date: userDateToISO(dueDate), paid,
      });
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New expense</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {!params.athlete_id && athletes.length > 1 && (
            <>
              <Text style={styles.label}>Athlete</Text>
              <View style={styles.chips}>
                {athletes.map((a) => (
                  <TouchableOpacity key={a.id} onPress={() => setAthleteId(a.id)} style={[styles.chip, athleteId === a.id && styles.chipActive]}>
                    <Text style={[styles.chipText, athleteId === a.id && styles.chipTextActive]}>{a.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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

          <Text style={styles.label}>Amount (USD)</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="expense-amount-input" />

          <Text style={styles.label}>Date</Text>
          <TextInput style={styles.input} value={incurredOn} onChangeText={setIncurredOn} placeholder="DD-MM-YYYY" placeholderTextColor={colors.textTertiary} testID="expense-date-input" />

          <Text style={styles.label}>Due date (optional)</Text>
          <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="DD-MM-YYYY" placeholderTextColor={colors.textTertiary} testID="expense-due-input" />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={note} onChangeText={setNote} placeholder="e.g. October tuition" placeholderTextColor={colors.textTertiary} multiline />

          <View style={styles.switchRow}>
            <Text style={styles.bodyText}>Already paid</Text>
            <Switch value={paid} onValueChange={setPaid} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="white" />
          </View>

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="expense-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>Save expense</Text>}
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
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  chipTextActive: { color: "white" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  bodyText: { ...typography.bodyMedium, color: colors.textPrimary },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
