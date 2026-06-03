import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatCurrency, formatDate } from "@/src/utils/format";
import ApplyPaymentSheet from "@/src/components/ApplyPaymentSheet";

type Athlete = { id: string; name: string; avatar_color?: string };
type Expense = { id: string; athlete_id: string; category: string; amount: number; paid_amount?: number; balance_due?: number; incurred_on: string; due_date?: string; paid: boolean; note?: string };
type Payment = { id: string; athlete_id: string; amount: number; paid_on: string; method?: string; note?: string; applied_expense_ids?: string[] };

export default function ExpensesTab() {
  const router = useRouter();
  const [tab, setTab] = useState<"expenses" | "payments">("expenses");
  const [filter, setFilter] = useState<"all" | "open" | "paid">("all");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applySheet, setApplySheet] = useState<Expense | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, e, p] = await Promise.all([
        api.get<Athlete[]>("/athletes"),
        api.get<Expense[]>("/expenses"),
        api.get<Payment[]>("/payments"),
      ]);
      setAthletes(a.data); setExpenses(e.data); setPayments(p.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const athleteName = (id: string) => athletes.find((a) => a.id === id)?.name || "";
  const athleteColor = (id: string) => athletes.find((a) => a.id === id)?.avatar_color || colors.accent;

  const filteredExpenses = useMemo(() => {
    if (filter === "all") return expenses;
    if (filter === "open") return expenses.filter((e) => !e.paid && Number(e.balance_due || 0) > 0);
    return expenses.filter((e) => e.paid || Number(e.balance_due || 0) <= 0.001);
  }, [expenses, filter]);

  const totals = useMemo(() => {
    const totalDue = expenses.reduce((s, e) => s + Number(e.balance_due ?? Math.max(0, Number(e.amount) - Number(e.paid_amount || 0))), 0);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    return { totalDue, totalPaid };
  }, [expenses, payments]);

  const togglePaid = async (e: Expense) => {
    await api.patch(`/expenses/${e.id}`, { paid: !e.paid });
    load();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Money</Text>
        <TouchableOpacity
          onPress={() => router.push(tab === "expenses" ? "/expenses/new" : "/payments/new")}
          style={styles.addBtn}
          testID="add-money-entry"
        >
          <Ionicons name="add" size={20} color="white" />
          <Text style={styles.addBtnText}>{tab === "expenses" ? "Expense" : "Payment"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity onPress={() => setTab("expenses")} style={[styles.tab, tab === "expenses" && styles.tabActive]} testID="tab-expenses">
          <Text style={[styles.tabText, tab === "expenses" && styles.tabTextActive]}>Expenses ({expenses.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("payments")} style={[styles.tab, tab === "payments" && styles.tabActive]} testID="tab-payments">
          <Text style={[styles.tabText, tab === "payments" && styles.tabTextActive]}>Payments ({payments.length})</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <View style={styles.sumItem}>
          <Text style={styles.sumLabel}>Open balance</Text>
          <Text style={[styles.sumValue, { color: colors.accent }]}>{formatCurrency(totals.totalDue)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.sumItem}>
          <Text style={styles.sumLabel}>Paid YTD</Text>
          <Text style={[styles.sumValue, { color: colors.successText }]}>{formatCurrency(totals.totalPaid)}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {tab === "expenses" && (
          <>
            <View style={styles.filterRow}>
              {(["all","open","paid"] as const).map((f) => (
                <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.filterChipOn]} testID={`filter-${f}`}>
                  <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>{f.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {filteredExpenses.length === 0 ? (
              <Text style={styles.empty}>No expenses to show.</Text>
            ) : filteredExpenses.map((e) => {
              const paid = Number(e.paid_amount || 0);
              const bal = Math.max(0, Number(e.balance_due ?? Math.max(0, Number(e.amount) - paid)));
              const isPaid = e.paid || bal <= 0.001;
              const isPartial = paid > 0.001 && !isPaid;
              const pct = Number(e.amount) > 0 ? Math.min(100, Math.round((paid / Number(e.amount)) * 100)) : 0;
              return (
                <TouchableOpacity
                  key={e.id}
                  onPress={() => router.push(`/athletes/${e.athlete_id}`)}
                  activeOpacity={0.8}
                  style={styles.row}
                  testID={`expense-row-${e.id}`}
                >
                  <TouchableOpacity onPress={(ev) => { ev.stopPropagation?.(); togglePaid(e); }} style={[styles.dot, isPaid && { backgroundColor: colors.successText, borderColor: colors.successText }]}>
                    {isPaid && <Ionicons name="checkmark" size={14} color="white" />}
                  </TouchableOpacity>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.rowTitle}>{e.category}</Text>
                    <View style={styles.athChip}>
                      <View style={[styles.athDot, { backgroundColor: athleteColor(e.athlete_id) }]} />
                      <Text style={styles.rowMeta}>{athleteName(e.athlete_id)} • {formatDate(e.incurred_on)}</Text>
                    </View>
                    {isPartial && (
                      <View style={styles.progressWrap}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    {isPaid ? (
                      <Text style={[styles.amount, { color: colors.successText, textDecorationLine: "line-through" }]}>{formatCurrency(e.amount)}</Text>
                    ) : (
                      <>
                        <Text style={styles.amount}>{formatCurrency(bal)}</Text>
                        <TouchableOpacity onPress={(ev) => { ev.stopPropagation?.(); setApplySheet(e); }} style={styles.payBtn} testID={`apply-${e.id}`}>
                          <Text style={styles.payBtnText}>Apply</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {tab === "payments" && (
          payments.length === 0 ? (
            <Text style={styles.empty}>No payments yet.</Text>
          ) : payments.map((p) => {
            const cats = (p.applied_expense_ids || [])
              .map((eid) => expenses.find((e) => e.id === eid)?.category).filter(Boolean) as string[];
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => router.push(`/athletes/${p.athlete_id}`)}
                activeOpacity={0.8}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: colors.successBg }]}>
                  <Ionicons name="cash" size={16} color={colors.successText} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowTitle}>{p.method || "Payment"}</Text>
                  <View style={styles.athChip}>
                    <View style={[styles.athDot, { backgroundColor: athleteColor(p.athlete_id) }]} />
                    <Text style={styles.rowMeta}>{athleteName(p.athlete_id)} • {formatDate(p.paid_on, { withYear: true })}</Text>
                  </View>
                  {cats.length > 0 && (
                    <Text style={styles.appliedText} numberOfLines={1}>Applied to: {cats.join(", ")}</Text>
                  )}
                </View>
                <Text style={[styles.amount, { color: colors.successText }]}>{formatCurrency(p.amount)}</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <ApplyPaymentSheet
        visible={!!applySheet}
        expense={applySheet}
        onClose={() => setApplySheet(null)}
        onApplied={() => { load(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: colors.textPrimary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.accent, borderRadius: 999 },
  addBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, backgroundColor: colors.card, padding: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" },
  tabTextActive: { color: "white" },
  summary: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  sumItem: { flex: 1, alignItems: "center" },
  sumLabel: { ...typography.micro, color: colors.textSecondary, marginBottom: 4 },
  sumValue: { ...typography.h3, fontWeight: "800" },
  divider: { width: 1, height: 32, backgroundColor: colors.border },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  filterChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { ...typography.micro, fontWeight: "700", color: colors.textSecondary, letterSpacing: 0.5 },
  filterTextOn: { color: "white" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary },
  athChip: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  athDot: { width: 6, height: 6, borderRadius: 3 },
  amount: { ...typography.h3, color: colors.textPrimary, marginBottom: 4 },
  payBtn: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.accent, borderRadius: 999 },
  payBtnText: { color: "white", fontWeight: "700", fontSize: 11 },
  progressWrap: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: colors.successText },
  appliedText: { ...typography.caption, color: colors.accent, fontWeight: "600", marginTop: 2 },
  empty: { ...typography.body, color: colors.textTertiary, textAlign: "center", marginTop: spacing.xl },
});
