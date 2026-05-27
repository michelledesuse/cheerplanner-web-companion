import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatCurrency, formatDate } from "@/src/utils/format";

type Athlete = { id: string; name: string; team?: string; gym?: string; avatar_color?: string };
type Expense = { id: string; category: string; amount: number; note?: string; incurred_on: string; due_date?: string; paid: boolean };
type Payment = { id: string; amount: number; paid_on: string; method?: string; note?: string };

export default function AthleteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [tab, setTab] = useState<"expenses" | "payments">("expenses");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, e, p] = await Promise.all([
        api.get<Athlete[]>("/athletes"),
        api.get<Expense[]>(`/expenses?athlete_id=${id}`),
        api.get<Payment[]>(`/payments?athlete_id=${id}`),
      ]);
      setAthlete(a.data.find((x) => x.id === id) || null);
      setExpenses(e.data);
      setPayments(p.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const unpaidBalance = expenses.filter(e => !e.paid).reduce((s, e) => s + Number(e.amount || 0), 0);

  const removeAthlete = () => {
    Alert.alert("Delete athlete?", "This removes all expenses & payments for this athlete.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await api.delete(`/athletes/${id}`);
        router.back();
      }},
    ]);
  };

  const deleteExpense = async (eid: string) => {
    await api.delete(`/expenses/${eid}`);
    load();
  };
  const togglePaid = async (e: Expense) => {
    await api.patch(`/expenses/${e.id}`, { paid: !e.paid });
    load();
  };
  const deletePayment = async (pid: string) => {
    await api.delete(`/payments/${pid}`);
    load();
  };

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.centered}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="athlete-detail-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{athlete?.name || "Athlete"}</Text>
        <TouchableOpacity onPress={removeAthlete} style={styles.iconBtn} testID="athlete-delete-btn">
          <Ionicons name="trash-outline" size={20} color={colors.dangerText} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        <View style={styles.summaryCard}>
          <View style={[styles.avatar, { backgroundColor: athlete?.avatar_color || colors.accent }]}>
            <Text style={styles.avatarText}>{athlete?.name?.[0]?.toUpperCase() || "?"}</Text>
          </View>
          <Text style={styles.athleteName}>{athlete?.name}</Text>
          {(athlete?.team || athlete?.gym) && (
            <Text style={styles.athleteMeta}>{[athlete?.team, athlete?.gym].filter(Boolean).join(" • ")}</Text>
          )}
          <View style={styles.summaryRow}>
            <Stat label="Total spent" value={formatCurrency(totalSpent)} />
            <View style={styles.vdiv} />
            <Stat label="Paid" value={formatCurrency(totalPaid)} color={colors.successText} />
            <View style={styles.vdiv} />
            <Stat label="Open" value={formatCurrency(unpaidBalance)} color={colors.accent} />
          </View>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity onPress={() => setTab("expenses")} style={[styles.tab, tab === "expenses" && styles.tabActive]} testID="tab-expenses">
            <Text style={[styles.tabText, tab === "expenses" && styles.tabTextActive]}>Expenses ({expenses.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTab("payments")} style={[styles.tab, tab === "payments" && styles.tabActive]} testID="tab-payments">
            <Text style={[styles.tabText, tab === "payments" && styles.tabTextActive]}>Payments ({payments.length})</Text>
          </TouchableOpacity>
        </View>

        {tab === "expenses" && (
          <>
            <TouchableOpacity
              style={styles.addRow}
              onPress={() => router.push({ pathname: "/expenses/new", params: { athlete_id: id } })}
              testID="add-expense-btn"
            >
              <Ionicons name="add-circle" size={20} color={colors.accent} />
              <Text style={styles.addRowText}>Add expense</Text>
            </TouchableOpacity>
            {expenses.length === 0 ? (
              <Text style={styles.emptyHint}>No expenses logged yet.</Text>
            ) : expenses.map((e) => (
              <View key={e.id} style={styles.row} testID={`expense-row-${e.id}`}>
                <TouchableOpacity onPress={() => togglePaid(e)} style={[styles.statusDot, e.paid && { backgroundColor: colors.successText, borderColor: colors.successText }]}>
                  {e.paid && <Ionicons name="checkmark" size={14} color="white" />}
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowTitle}>{e.category}</Text>
                  <Text style={styles.rowMeta}>
                    {formatDate(e.incurred_on)}{e.due_date ? ` • due ${formatDate(e.due_date)}` : ""}
                  </Text>
                  {e.note && <Text style={styles.rowNote} numberOfLines={1}>{e.note}</Text>}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.rowAmount, e.paid && { color: colors.successText, textDecorationLine: "line-through" }]}>
                    {formatCurrency(e.amount)}
                  </Text>
                  <TouchableOpacity onPress={() => deleteExpense(e.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        {tab === "payments" && (
          <>
            <TouchableOpacity
              style={styles.addRow}
              onPress={() => router.push({ pathname: "/payments/new", params: { athlete_id: id } })}
              testID="add-payment-btn"
            >
              <Ionicons name="add-circle" size={20} color={colors.accent} />
              <Text style={styles.addRowText}>Add payment</Text>
            </TouchableOpacity>
            {payments.length === 0 ? (
              <Text style={styles.emptyHint}>No payments logged yet.</Text>
            ) : payments.map((p) => (
              <View key={p.id} style={styles.row}>
                <View style={[styles.iconCircle, { backgroundColor: colors.successBg }]}>
                  <Ionicons name="cash" size={16} color={colors.successText} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowTitle}>{p.method || "Payment"}</Text>
                  <Text style={styles.rowMeta}>{formatDate(p.paid_on, { withYear: true })}</Text>
                  {p.note && <Text style={styles.rowNote} numberOfLines={1}>{p.note}</Text>}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.rowAmount, { color: colors.successText }]}>{formatCurrency(p.amount)}</Text>
                  <TouchableOpacity onPress={() => deletePayment(p.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: "center", marginHorizontal: spacing.md },
  summaryCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  avatar: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  avatarText: { color: "white", fontSize: 28, fontWeight: "800" },
  athleteName: { ...typography.h2, color: colors.textPrimary },
  athleteMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  summaryRow: { flexDirection: "row", marginTop: spacing.lg, width: "100%" },
  vdiv: { width: 1, backgroundColor: colors.border },
  statLabel: { ...typography.micro, color: colors.textTertiary },
  statValue: { ...typography.h3, color: colors.textPrimary, marginTop: 2 },
  tabs: { flexDirection: "row", marginTop: spacing.lg, backgroundColor: colors.card, padding: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" },
  tabTextActive: { color: "white" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  addRowText: { color: colors.accent, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  statusDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  iconCircle: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowNote: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  rowAmount: { ...typography.h3, color: colors.textPrimary, marginBottom: 4 },
  emptyHint: { ...typography.body, color: colors.textTertiary, textAlign: "center", marginTop: spacing.xl },
});
