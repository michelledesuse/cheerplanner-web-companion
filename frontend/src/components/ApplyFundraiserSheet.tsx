import React, { useCallback, useEffect, useState } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate, todayISO } from "@/src/utils/format";

type Fundraiser = { id: string; name: string; amount_raised: number; applied_amount?: number; available?: number };
type Expense = { id: string; athlete_id: string; category: string; amount: number; paid: boolean; paid_amount?: number; balance_due?: number; incurred_on: string };
type Athlete = { id: string; name: string; avatar_color?: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  fundraiser: Fundraiser | null;
  onApplied: () => void;
};

export default function ApplyFundraiserSheet({ visible, onClose, fundraiser, onApplied }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [amount, setAmount] = useState("");

  const available = Number(fundraiser?.available ?? Math.max(0, Number(fundraiser?.amount_raised || 0) - Number(fundraiser?.applied_amount || 0)));

  const load = useCallback(async () => {
    if (!visible || !fundraiser) return;
    setLoading(true);
    try {
      const [exp, ath] = await Promise.all([
        api.get<Expense[]>("/expenses"),
        api.get<Athlete[]>("/athletes"),
      ]);
      setExpenses(exp.data.filter((e) => !e.paid && Number(e.balance_due || 0) > 0));
      setAthletes(ath.data);
    } catch (_e) { /* ignore */ } finally {
      setLoading(false);
    }
  }, [visible, fundraiser]);

  useEffect(() => {
    if (visible) {
      setSelectedExpense(null);
      setAmount("");
      load();
    }
  }, [visible, load]);

  const pickExpense = (e: Expense) => {
    setSelectedExpense(e);
    const balance = Number(e.balance_due || 0);
    const suggested = Math.min(balance, available);
    setAmount(suggested.toFixed(2));
  };

  const apply = async () => {
    if (!fundraiser || !selectedExpense) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid amount", "Enter a positive amount.");
      return;
    }
    if (amt > available + 0.001) {
      Alert.alert("Too much", `Only ${formatCurrency(available)} available in this fundraiser.`);
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/expenses/${selectedExpense.id}/apply-payment`, {
        amount: amt,
        source_type: "fundraiser",
        fundraiser_id: fundraiser.id,
        paid_on: todayISO(),
      });
      onApplied();
      onClose();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not apply.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!fundraiser) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity style={styles.dim} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet} testID="apply-fundraiser-sheet">
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Apply {fundraiser.name}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.helper}>Available {formatCurrency(available)}</Text>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
          ) : expenses.length === 0 ? (
            <Text style={styles.empty}>No unpaid expenses to apply to.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
              {expenses.map((e) => {
                const ath = athletes.find((a) => a.id === e.athlete_id);
                const sel = selectedExpense?.id === e.id;
                return (
                  <TouchableOpacity
                    key={e.id}
                    onPress={() => pickExpense(e)}
                    style={[styles.row, sel && styles.rowSel]}
                    testID={`apply-fund-exp-${e.id}`}
                  >
                    <View style={[styles.dot, { backgroundColor: ath?.avatar_color || colors.accent }]}>
                      <Text style={styles.dotTxt}>{ath?.name?.[0]?.toUpperCase() || "?"}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={styles.rowTitle}>{ath?.name || "Athlete"} · {e.category}</Text>
                      <Text style={styles.rowMeta}>
                        {formatDate(e.incurred_on)} · Balance {formatCurrency(Number(e.balance_due || e.amount))}
                      </Text>
                    </View>
                    {sel && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {selectedExpense && (
            <>
              <Text style={styles.label}>Amount to apply</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                testID="apply-fund-amount"
              />
              <TouchableOpacity
                style={[styles.submit, submitting && { opacity: 0.6 }]}
                onPress={apply}
                disabled={submitting}
                testID="apply-fund-submit"
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.submitText}>Apply {formatCurrency(parseFloat(amount) || 0)}</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = () => ({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, maxHeight: "92%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  title: { ...typography.h2, color: colors.textPrimary, flex: 1 },
  helper: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  empty: { ...typography.body, color: colors.textTertiary, textAlign: "center", marginVertical: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  rowSel: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  dot: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  dotTxt: { color: "white", fontWeight: "800", fontSize: 13 },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  submit: { marginTop: spacing.md, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  submitText: { color: "white", fontWeight: "800", fontSize: 16 },
});
