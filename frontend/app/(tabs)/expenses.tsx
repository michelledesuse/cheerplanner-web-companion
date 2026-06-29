import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate } from "@/src/utils/format";
import ApplyPaymentSheet from "@/src/components/ApplyPaymentSheet";
import ApplyFundraiserSheet from "@/src/components/ApplyFundraiserSheet";

type Athlete = { id: string; name: string; avatar_color?: string };
type Expense = { id: string; athlete_id: string; category: string; amount: number; paid_amount?: number; balance_due?: number; incurred_on: string; due_date?: string; paid: boolean; note?: string };
type Payment = { id: string; athlete_id: string; amount: number; paid_on: string; method?: string; note?: string; applied_expense_ids?: string[] };
type Fundraiser = { id: string; name: string; amount_raised: number; applied_amount?: number; available?: number; raised_on: string };

export default function ExpensesTab() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState<"expenses" | "payments" | "fundraisers">("expenses");
  const [filter, setFilter] = useState<"all" | "open" | "paid">("all");
  const [athleteFilter, setAthleteFilter] = useState<string | null>(null);  // null = all athletes
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [fundraisers, setFundraisers] = useState<Fundraiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applySheet, setApplySheet] = useState<Expense | null>(null);
  const [applyFund, setApplyFund] = useState<Fundraiser | null>(null);
  // Multi-select mode (tap to toggle, long-press a row to enter)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelected = (id: string) => {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const enterSelectMode = () => { setSelectMode(true); setSelectedIds(new Set()); };

  // Maps the current tab to the resource string the bulk-delete endpoint expects.
  const resourceForTab = (t: typeof tab) =>
    t === "expenses" ? "expenses" : t === "payments" ? "payments" : "fundraisers";

  const bulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const noun = tab === "expenses" ? "expense" : tab === "payments" ? "payment" : "fundraiser";
    Alert.alert(
      `Delete ${ids.length} ${noun}${ids.length === 1 ? "" : "s"}?`,
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await api.post<{ deleted: number }>("/bulk-delete", {
                resource: resourceForTab(tab),
                ids,
              });
              exitSelectMode();
              await load();
              if ((r.data?.deleted || 0) === 0) {
                Alert.alert("Nothing deleted", "Those items may have already been removed.");
              }
            } catch (e: any) {
              Alert.alert("Error", e?.response?.data?.detail || "Could not delete.");
            }
          },
        },
      ],
    );
  };

  const load = useCallback(async () => {
    try {
      const [a, e, p, f] = await Promise.all([
        api.get<Athlete[]>("/athletes"),
        api.get<Expense[]>("/expenses"),
        api.get<Payment[]>("/payments"),
        api.get<Fundraiser[]>("/fundraisers"),
      ]);
      setAthletes(a.data); setExpenses(e.data); setPayments(p.data); setFundraisers(f.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    return () => { setSelectMode(false); setSelectedIds(new Set()); };
  }, [load]));

  const athleteName = (id: string) => athletes.find((a) => a.id === id)?.name || "";
  const athleteColor = (id: string) => athletes.find((a) => a.id === id)?.avatar_color || colors.accent;

  const filteredExpenses = useMemo(() => {
    let list = athleteFilter ? expenses.filter((e) => e.athlete_id === athleteFilter) : expenses;
    if (filter === "open") list = list.filter((e) => !e.paid && Number(e.balance_due || 0) > 0);
    else if (filter === "paid") list = list.filter((e) => e.paid || Number(e.balance_due || 0) <= 0.001);
    return list;
  }, [expenses, filter, athleteFilter]);

  const filteredPayments = useMemo(() => {
    return athleteFilter ? payments.filter((p) => p.athlete_id === athleteFilter) : payments;
  }, [payments, athleteFilter]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const isOverdue = (e: Expense) => !!e.due_date && e.due_date < todayStr && !e.paid && Number(e.balance_due ?? Number(e.amount) - Number(e.paid_amount || 0)) > 0;

  const totals = useMemo(() => {
    // Aggregates use the backend's canonical fields so that:
    //   1. Marking an expense paid by tapping its bubble (which sets paid=true)
    //      immediately moves the value from Open Balance into Paid YTD.
    //   2. Expenses created with the "Already paid" flag count toward Paid YTD
    //      the same as a logged payment would (the backend forces
    //      paid_amount=amount whenever paid=true).
    const totalDue = expenses.reduce((s, e) => s + Number(e.balance_due ?? Math.max(0, Number(e.amount) - Number(e.paid_amount || 0))), 0);
    const totalPaid = expenses.reduce((s, e) => s + Number(e.paid_amount || 0), 0);
    return { totalDue, totalPaid };
  }, [expenses, payments]);

  // Items currently visible in the active tab — used for "Select all"
  const visibleIds = useMemo(() => {
    if (tab === "expenses") return filteredExpenses.map((e) => e.id);
    if (tab === "payments") return filteredPayments.map((p) => p.id);
    return fundraisers.map((f) => f.id);
  }, [tab, filteredExpenses, filteredPayments, fundraisers]);

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (allSelected) {
        visibleIds.forEach((id) => n.delete(id));
      } else {
        visibleIds.forEach((id) => n.add(id));
      }
      return n;
    });
  };

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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {!selectMode && visibleIds.length > 0 && (
            <TouchableOpacity
              onPress={enterSelectMode}
              style={styles.selectBtn}
              testID="enter-select-mode"
              accessibilityLabel="Select multiple"
            >
              <Ionicons name="checkmark-done" size={16} color={colors.accent} />
              <Text style={styles.selectBtnText}>Select</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() =>
              router.push(
                tab === "expenses" ? "/expenses/new"
                : tab === "payments" ? "/payments/new"
                : "/fundraisers"
              )
            }
            style={styles.addBtn}
            testID="add-money-entry"
          >
            <Ionicons name="add" size={20} color="white" />
            <Text style={styles.addBtnText}>{tab === "expenses" ? "Expense" : tab === "payments" ? "Payment" : "Fundraiser"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tabs}>
        {selectMode ? (
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: spacing.md, paddingHorizontal: 4 }}>
            <TouchableOpacity onPress={exitSelectMode} testID="select-cancel" hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={{ ...typography.bodyMedium, color: colors.textPrimary, flex: 1 }}>
              {selectedIds.size} selected
            </Text>
            <TouchableOpacity onPress={toggleSelectAll} testID="select-all-btn" hitSlop={6}>
              <Text style={{ color: colors.accent, fontWeight: "700" }}>
                {allSelected ? "Clear" : "Select all"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={bulkDelete}
              disabled={selectedIds.size === 0}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, opacity: selectedIds.size === 0 ? 0.4 : 1 }}
              testID="bulk-delete-btn"
            >
              <Ionicons name="trash" size={18} color={colors.danger} />
              <Text style={{ color: colors.danger, fontWeight: "700" }}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity onPress={() => { setTab("expenses"); exitSelectMode(); }} style={[styles.tab, tab === "expenses" && styles.tabActive]} testID="tab-expenses">
              <Text style={[styles.tabText, tab === "expenses" && styles.tabTextActive]}>Expenses</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setTab("payments"); exitSelectMode(); }} style={[styles.tab, tab === "payments" && styles.tabActive]} testID="tab-payments">
              <Text style={[styles.tabText, tab === "payments" && styles.tabTextActive]}>Payments</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setTab("fundraisers"); exitSelectMode(); }} style={[styles.tab, tab === "fundraisers" && styles.tabActive]} testID="tab-fundraisers">
              <Text style={[styles.tabText, tab === "fundraisers" && styles.tabTextActive]}>Fundraisers</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.summary}>
        {tab === "fundraisers" ? (
          <>
            <View style={styles.sumItem}>
              <Text style={styles.sumLabel}>Total raised</Text>
              <Text style={[styles.sumValue, { color: colors.successText }]}>{formatCurrency(fundraisers.reduce((s, f) => s + Number(f.amount_raised || 0), 0))}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.sumItem}>
              <Text style={styles.sumLabel}>Available</Text>
              <Text style={[styles.sumValue, { color: colors.textPrimary }]}>{formatCurrency(fundraisers.reduce((s, f) => s + Number(f.available ?? Math.max(0, Number(f.amount_raised) - Number(f.applied_amount || 0))), 0))}</Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.sumItem}>
              <Text style={styles.sumLabel}>Open balance</Text>
              <Text style={[styles.sumValue, { color: colors.textPrimary }]}>{formatCurrency(totals.totalDue)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.sumItem}>
              <Text style={styles.sumLabel}>Paid YTD</Text>
              <Text style={[styles.sumValue, { color: colors.successText }]}>{formatCurrency(totals.totalPaid)}</Text>
            </View>
          </>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {tab !== "fundraisers" && athletes.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }} contentContainerStyle={{ gap: 8 }}>
            <TouchableOpacity onPress={() => setAthleteFilter(null)} style={[styles.athChipFilter, athleteFilter === null && styles.athChipFilterOn]} testID="ath-filter-all">
              <Text style={[styles.athChipText, athleteFilter === null && styles.athChipTextOn]}>All</Text>
            </TouchableOpacity>
            {athletes.map((a) => (
              <TouchableOpacity key={a.id} onPress={() => setAthleteFilter(a.id)} style={[styles.athChipFilter, athleteFilter === a.id && styles.athChipFilterOn]} testID={`ath-filter-${a.id}`}>
                <View style={[styles.athDotSm, { backgroundColor: a.avatar_color || colors.accent }]} />
                <Text style={[styles.athChipText, athleteFilter === a.id && styles.athChipTextOn]}>{a.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
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
                  onPress={() => {
                    if (selectMode) { toggleSelected(e.id); return; }
                    router.push({ pathname: "/expenses/new", params: { id: e.id } });
                  }}
                  onLongPress={() => { setSelectMode(true); toggleSelected(e.id); }}
                  activeOpacity={0.8}
                  style={[styles.row, selectedIds.has(e.id) && { backgroundColor: colors.accentSubtle }]}
                  testID={`expense-row-${e.id}`}
                >
                  {selectMode ? (
                    <View style={[styles.dot, selectedIds.has(e.id) && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                      {selectedIds.has(e.id) && <Ionicons name="checkmark" size={14} color="white" />}
                    </View>
                  ) : (
                    <TouchableOpacity onPress={(ev) => { ev.stopPropagation?.(); togglePaid(e); }} style={[styles.dot, isPaid && { backgroundColor: colors.successText, borderColor: colors.successText }]}>
                      {isPaid && <Ionicons name="checkmark" size={14} color="white" />}
                    </TouchableOpacity>
                  )}
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.rowTitle}>{e.category}</Text>
                      {isOverdue(e) && (
                        <View style={styles.overdueBadge}>
                          <Ionicons name="alert-circle" size={11} color="white" />
                          <Text style={styles.overdueText}>OVERDUE</Text>
                        </View>
                      )}
                    </View>
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
          filteredPayments.length === 0 ? (
            <Text style={styles.empty}>No payments yet.</Text>
          ) : filteredPayments.map((p) => {
            const cats = (p.applied_expense_ids || [])
              .map((eid) => expenses.find((e) => e.id === eid)?.category).filter(Boolean) as string[];
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => {
                  if (selectMode) { toggleSelected(p.id); return; }
                  router.push({ pathname: "/payments/new", params: { id: p.id } });
                }}
                onLongPress={() => { setSelectMode(true); toggleSelected(p.id); }}
                activeOpacity={0.8}
                style={[styles.row, selectedIds.has(p.id) && { backgroundColor: colors.accentSubtle }]}
                testID={`payment-row-${p.id}`}
              >
                {selectMode ? (
                  <View style={[styles.dot, selectedIds.has(p.id) && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                    {selectedIds.has(p.id) && <Ionicons name="checkmark" size={14} color="white" />}
                  </View>
                ) : (
                  <View style={[styles.iconCircle, { backgroundColor: colors.successBg }]}>
                    <Ionicons name="cash" size={16} color={colors.successText} />
                  </View>
                )}
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

        {tab === "fundraisers" && (
          fundraisers.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="gift-outline" size={36} color={colors.textTertiary} />
              <Text style={styles.empty}>No fundraisers yet.</Text>
              <TouchableOpacity onPress={() => router.push("/fundraisers")} style={styles.bigAddBtn} testID="fund-empty-add">
                <Ionicons name="add-circle" size={18} color="white" />
                <Text style={styles.bigAddBtnText}>Add fundraiser</Text>
              </TouchableOpacity>
            </View>
          ) : fundraisers.map((f) => {
            const applied = Number(f.applied_amount || 0);
            const avail = Number(f.available ?? Math.max(0, Number(f.amount_raised) - applied));
            return (
              <TouchableOpacity
                key={f.id}
                onPress={() => {
                  if (selectMode) { toggleSelected(f.id); return; }
                  router.push("/fundraisers");
                }}
                onLongPress={() => { setSelectMode(true); toggleSelected(f.id); }}
                activeOpacity={0.8}
                style={[styles.row, selectedIds.has(f.id) && { backgroundColor: colors.accentSubtle }]}
                testID={`fundraiser-row-${f.id}`}
              >
                {selectMode ? (
                  <View style={[styles.dot, selectedIds.has(f.id) && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                    {selectedIds.has(f.id) && <Ionicons name="checkmark" size={14} color="white" />}
                  </View>
                ) : (
                  <View style={[styles.iconCircle, { backgroundColor: colors.warningBg }]}>
                    <Ionicons name="gift" size={16} color={colors.warningText} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowTitle}>{f.name}</Text>
                  <Text style={styles.rowMeta}>
                    {formatDate(f.raised_on, { withYear: true })}
                    {applied > 0 ? ` • ${formatCurrency(applied)} applied` : ""}
                  </Text>
                  {avail > 0 && (
                    <TouchableOpacity
                      onPress={(ev) => { ev.stopPropagation?.(); setApplyFund(f); }}
                      style={styles.payBtn}
                      testID={`apply-fund-${f.id}`}
                    >
                      <Text style={styles.payBtnText}>Apply to expense</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.amount, { color: colors.successText }]}>{formatCurrency(f.amount_raised)}</Text>
                  {applied > 0 && (
                    <Text style={styles.rowMeta}>{formatCurrency(avail)} left</Text>
                  )}
                </View>
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
      <ApplyFundraiserSheet
        visible={!!applyFund}
        fundraiser={applyFund}
        onClose={() => setApplyFund(null)}
        onApplied={() => { load(); }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: c.textPrimary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: c.accent, borderRadius: 999 },
  addBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  selectBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.accentSubtle, borderRadius: 999, borderWidth: 1, borderColor: c.accent },
  selectBtnText: { color: c.accent, fontWeight: "700", fontSize: 13 },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, backgroundColor: c.card, padding: 4, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: c.primary },
  tabText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  tabTextActive: { color: "white" },
  summary: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  sumItem: { flex: 1, alignItems: "center" },
  sumLabel: { ...typography.micro, color: c.textSecondary, marginBottom: 4 },
  sumValue: { ...typography.h3, fontWeight: "800" },
  divider: { width: 1, height: 32, backgroundColor: c.border },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  filterChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  filterText: { ...typography.micro, fontWeight: "700", color: c.textSecondary, letterSpacing: 0.5 },
  filterTextOn: { color: "white" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, marginBottom: 8 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...typography.bodyMedium, color: c.textPrimary },
  rowMeta: { ...typography.caption, color: c.textSecondary },
  athChip: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  athDot: { width: 6, height: 6, borderRadius: 3 },
  amount: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  payBtn: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.accent, borderRadius: 999 },
  payBtnText: { color: "white", fontWeight: "700", fontSize: 11 },
  progressWrap: { height: 4, borderRadius: 2, backgroundColor: c.border, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: c.successText },
  appliedText: { ...typography.caption, color: c.accent, fontWeight: "600", marginTop: 2 },
  empty: { ...typography.body, color: c.textTertiary, textAlign: "center", marginTop: spacing.md },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  bigAddBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: c.accent, borderRadius: 999, marginTop: spacing.md },
  bigAddBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  athChipFilter: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.card, borderRadius: 999, borderWidth: 1, borderColor: c.border },
  athChipFilterOn: { backgroundColor: c.primary, borderColor: c.primary },
  athChipText: { ...typography.caption, fontWeight: "600", color: c.textPrimary },
  athChipTextOn: { color: "white" },
  athDotSm: { width: 8, height: 8, borderRadius: 4 },
  overdueBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: c.dangerText, borderRadius: 6 },
  overdueText: { color: "white", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
});
