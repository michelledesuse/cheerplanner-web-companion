import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { todayDisplay, userDateToISO } from "@/src/utils/format";

export default function NewPayment() {
  const router = useRouter();
  const params = useLocalSearchParams<{ athlete_id?: string }>();
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayDisplay());
  const [method, setMethod] = useState("Card");
  const [note, setNote] = useState("");
  const [athletes, setAthletes] = useState<{ id: string; name: string }[]>([]);
  const [athleteId, setAthleteId] = useState<string>(params.athlete_id || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const a = await api.get("/athletes");
      setAthletes(a.data);
      if (!athleteId && a.data.length) setAthleteId(a.data[0].id);
    })();
  }, []);

  const save = async () => {
    if (!athleteId) { Alert.alert("Missing", "Select an athlete first."); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { Alert.alert("Missing", "Enter a valid amount."); return; }
    setSaving(true);
    try {
      await api.post("/payments", { athlete_id: athleteId, amount: amt, paid_on: userDateToISO(paidOn), method, note: note || null });
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  const METHODS = ["Card", "Bank", "Cash", "Fundraiser", "Other"];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New payment</Text>
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

          <Text style={styles.label}>Amount (USD)</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="payment-amount-input" />

          <Text style={styles.label}>Date paid</Text>
          <TextInput style={styles.input} value={paidOn} onChangeText={setPaidOn} placeholder="DD-MM-YYYY" placeholderTextColor={colors.textTertiary} testID="payment-date-input" />

          <Text style={styles.label}>Method</Text>
          <View style={styles.chips}>
            {METHODS.map((m) => (
              <TouchableOpacity key={m} onPress={() => setMethod(m)} style={[styles.chip, method === m && styles.chipActive]}>
                <Text style={[styles.chipText, method === m && styles.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={note} onChangeText={setNote} multiline placeholder="e.g. October tuition" placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="payment-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>Save payment</Text>}
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
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
