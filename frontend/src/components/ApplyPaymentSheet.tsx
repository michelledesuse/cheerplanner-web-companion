import React, { useEffect, useMemo, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatCurrency, todayISO } from "@/src/utils/format";
import DateField from "@/src/components/DateField";

type Fundraiser = { id: string; name: string; amount_raised: number; applied_amount?: number; available?: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  expense: {
    id: string;
    category: string;
    amount: number;
    paid_amount?: number;
    balance_due?: number;
  } | null;
  onApplied: () => void;
};

export default function ApplyPaymentSheet({ visible, onClose, expense, onApplied }: Props) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [note, setNote] = useState("");
  const [sourceType, setSourceType] = useState<"manual" | "fundraiser">("manual");
  const [fundraiserId, setFundraiserId] = useState<string | null>(null);
  const [fundraisers, setFundraisers] = useState<Fundraiser[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const balance = Number(expense?.balance_due ?? expense?.amount ?? 0);

  useEffect(() => {
    if (!visible) return;
    setAmount(balance > 0 ? balance.toFixed(2) : "");
    setPaidOn(todayISO());
    setNote("");
    setSourceType("manual");
    setFundraiserId(null);
    (async () => {
      setLoading(true);
      try {
        const r = await api.get<Fundraiser[]>("/fundraisers");
        setFundraisers(r.data);
      } catch (_e) {} finally { setLoading(false); }
    })();
  }, [visible, balance]);

  const availableFundraisers = useMemo(
    () => fundraisers.filter((f) => Number(f.available ?? f.amount_raised) > 0),
    [fundraisers]
  );

  const submit = async () => {
    if (!expense) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid amount", "Enter a positive amount to apply.");
      return;
    }
    if (sourceType === "fundraiser" && !fundraiserId) {
      Alert.alert("Pick a fundraiser", "Select a fundraiser to draw from.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/expenses/${expense.id}/apply-payment`, {
        amount: amt,
        source_type: sourceType,
        fundraiser_id: sourceType === "fundraiser" ? fundraiserId : undefined,
        paid_on: paidOn,
        note: note.trim() || undefined,
      });
      onApplied();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Could not apply payment.";
      Alert.alert("Error", String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  if (!expense) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity style={styles.dim} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet} testID="apply-payment-sheet">
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Apply payment</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
            <View style={styles.summary}>
              <Text style={styles.summaryLine}>{expense.category}</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total</Text>
                <Text style={styles.summaryValue}>{formatCurrency(expense.amount)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Paid</Text>
                <Text style={[styles.summaryValue, { color: colors.successText }]}>
                  {formatCurrency(Number(expense.paid_amount || 0))}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Balance due</Text>
                <Text style={[styles.summaryValue, { color: colors.textPrimary, fontWeight: "800" }]}>
                  {formatCurrency(balance)}
                </Text>
              </View>
            </View>

            <Text style={styles.label}>Apply amount (USD)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
              testID="apply-amount-input"
            />

            <Text style={styles.label}>Source</Text>
            <View style={styles.segmented}>
              <TouchableOpacity
                onPress={() => setSourceType("manual")}
                style={[styles.segment, sourceType === "manual" && styles.segmentActive]}
                testID="source-manual"
              >
                <Ionicons name="cash" size={16} color={sourceType === "manual" ? "white" : colors.textSecondary} />
                <Text style={[styles.segmentText, sourceType === "manual" && styles.segmentTextActive]}>Manual</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSourceType("fundraiser")}
                style={[styles.segment, sourceType === "fundraiser" && styles.segmentActive]}
                testID="source-fundraiser"
              >
                <Ionicons name="gift" size={16} color={sourceType === "fundraiser" ? "white" : colors.textSecondary} />
                <Text style={[styles.segmentText, sourceType === "fundraiser" && styles.segmentTextActive]}>Fundraiser</Text>
              </TouchableOpacity>
            </View>

            {sourceType === "fundraiser" && (
              <View>
                <Text style={styles.label}>Pick a fundraiser</Text>
                {loading ? (
                  <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
                ) : availableFundraisers.length === 0 ? (
                  <Text style={styles.helperText}>No fundraisers with available balance. Add one first.</Text>
                ) : (
                  <View style={{ gap: 8, marginTop: 6 }}>
                    {availableFundraisers.map((f) => {
                      const avail = Number(f.available ?? f.amount_raised);
                      const sel = fundraiserId === f.id;
                      return (
                        <TouchableOpacity
                          key={f.id}
                          onPress={() => { setFundraiserId(f.id); if (parseFloat(amount) > avail) setAmount(avail.toFixed(2)); }}
                          style={[styles.fundRow, sel && styles.fundRowSel]}
                          testID={`fundraiser-pick-${f.id}`}
                        >
                          <Ionicons
                            name={sel ? "radio-button-on" : "radio-button-off"}
                            size={18}
                            color={sel ? colors.accent : colors.textSecondary}
                          />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.fundName}>{f.name}</Text>
                            <Text style={styles.fundMeta}>Available {formatCurrency(avail)}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            <Text style={styles.label}>Date</Text>
            <DateField value={paidOn} onChange={setPaidOn} />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              style={styles.input}
              placeholder="e.g. Bake sale proceeds"
              placeholderTextColor={colors.textTertiary}
            />

            <TouchableOpacity
              style={[styles.submitBtn, (submitting || balance <= 0) && { opacity: 0.6 }]}
              onPress={submit}
              disabled={submitting || balance <= 0}
              testID="apply-submit-btn"
            >
              {submitting ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.submitText}>Apply {amount ? formatCurrency(parseFloat(amount) || 0) : "payment"}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "92%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { ...typography.h2, color: colors.textPrimary },
  summary: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryLine: { ...typography.bodyMedium, color: colors.textPrimary, marginBottom: 6 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  summaryLabel: { ...typography.caption, color: colors.textSecondary },
  summaryValue: { ...typography.body, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  helperText: { ...typography.caption, color: colors.textTertiary, marginTop: 4 },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
  },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { ...typography.caption, fontWeight: "700", color: colors.textSecondary },
  segmentTextActive: { color: "white" },
  fundRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fundRowSel: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  fundName: { ...typography.bodyMedium, color: colors.textPrimary },
  fundMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  submitBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  submitText: { color: "white", fontWeight: "800", fontSize: 16 },
});
