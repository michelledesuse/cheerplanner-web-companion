import React, { useCallback, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatCurrency, formatDate, todayISO } from "@/src/utils/format";
import DateField from "@/src/components/DateField";

type Fundraiser = { id: string; name: string; amount_raised: number; raised_on: string; note?: string };

export default function FundraisersScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Fundraiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [raisedOn, setRaisedOn] = useState(todayISO());

  const load = useCallback(async () => {
    try {
      const r = await api.get("/fundraisers");
      setItems(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = items.reduce((s, i) => s + Number(i.amount_raised || 0), 0);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Missing", "Add a name"); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0) { Alert.alert("Missing", "Enter a valid amount"); return; }
    await api.post("/fundraisers", { name: name.trim(), amount_raised: amt, raised_on: raisedOn });
    setName(""); setAmount(""); setRaisedOn(todayISO()); setShowAdd(false);
    load();
  };
  const remove = async (id: string) => { await api.delete(`/fundraisers/${id}`); load(); };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Fundraisers</Text>
          <TouchableOpacity onPress={() => setShowAdd((s) => !s)} style={[styles.iconBtn, { backgroundColor: colors.primary }]} testID="toggle-fundraiser-form">
            <Ionicons name={showAdd ? "close" : "add"} size={20} color="white" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>TOTAL RAISED</Text>
            <Text style={styles.heroAmount}>{formatCurrency(total)}</Text>
            <Text style={styles.heroMeta}>{items.length} {items.length === 1 ? "fundraiser" : "fundraisers"}</Text>
          </View>

          {showAdd && (
            <View style={styles.formCard}>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Bake sale" placeholderTextColor={colors.textTertiary} testID="fundraiser-name-input" />
              <Text style={styles.label}>Amount raised (USD)</Text>
              <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="fundraiser-amount-input" />
              <Text style={styles.label}>Date</Text>
              <DateField value={raisedOn} onChange={setRaisedOn} />
              <TouchableOpacity style={styles.saveBtn} onPress={save} testID="fundraiser-save-btn">
                <Text style={styles.saveBtnText}>Add fundraiser</Text>
              </TouchableOpacity>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
          ) : items.length === 0 ? (
            <Text style={styles.emptyHint}>No fundraisers yet. Add your first one!</Text>
          ) : (
            items.map((f) => (
              <View key={f.id} style={styles.row}>
                <View style={[styles.iconCircle, { backgroundColor: colors.warningBg }]}>
                  <Ionicons name="gift" size={16} color={colors.warningText} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowTitle}>{f.name}</Text>
                  <Text style={styles.rowMeta}>{formatDate(f.raised_on, { withYear: true })}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.rowAmount}>{formatCurrency(f.amount_raised)}</Text>
                  <TouchableOpacity onPress={() => remove(f.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.xl },
  heroLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  heroAmount: { color: "white", fontSize: 40, fontWeight: "800", marginTop: 4, letterSpacing: -0.5 },
  heroMeta: { color: "rgba(255,255,255,0.7)", marginTop: 4 },
  formCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 6 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  saveBtn: { marginTop: spacing.md, backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  iconCircle: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowAmount: { ...typography.h3, color: colors.successText, marginBottom: 4 },
  emptyHint: { ...typography.body, color: colors.textTertiary, textAlign: "center", marginTop: spacing.xl },
});
