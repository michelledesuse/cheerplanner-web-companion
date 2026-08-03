import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate } from "@/src/utils/format";
import ApplyPaymentSheet from "@/src/components/ApplyPaymentSheet";
import TeamAvatar from "@/src/components/TeamAvatar";

type Team = { id: string; name: string; color?: string | null; logo_image?: string | null };
type Athlete = { id: string; name: string; team?: string; gym?: string; team_ids?: string[] | null; avatar_color?: string; avatar_image?: string | null; competition_ids?: string[] };
type Expense = { id: string; category: string; amount: number; paid_amount?: number; balance_due?: number; note?: string; incurred_on: string; due_date?: string; paid: boolean };
type Payment = { id: string; amount: number; paid_on: string; method?: string; note?: string; applied_expense_ids?: string[]; allocations?: { expense_id: string; amount: number }[] };
type Competition = { id: string; name: string; location?: string; event_date: string };
type ScheduleEvent = { id: string; title: string; event_type: string; date: string; start_time?: string; location?: string; athlete_ids?: string[] };

export default function AthleteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [tab, setTab] = useState<"expenses" | "payments" | "events">("expenses");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingComps, setSavingComps] = useState(false);
  const [applySheet, setApplySheet] = useState<Expense | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, e, p, c, s] = await Promise.all([
        api.get<Athlete[]>("/athletes"),
        api.get<Expense[]>(`/expenses?athlete_id=${id}`),
        api.get<Payment[]>(`/payments?athlete_id=${id}`),
        api.get<Competition[]>("/competitions"),
        api.get<ScheduleEvent[]>("/schedule"),
      ]);
      setAthlete(a.data.find((x) => x.id === id) || null);
      setExpenses(e.data);
      setPayments(p.data);
      setCompetitions(c.data);
      setEvents(s.data);
      try { const tr = await api.get<Team[]>("/teams"); setTeams(tr.data); } catch (_) { /* ignore */ }
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Aggregates computed from the backend's canonical fields:
  //   - expense.amount      → what was billed
  //   - expense.paid_amount → what's actually been paid (the backend forces this
  //                           to equal amount when the expense is flagged paid,
  //                           so "already paid" items are included automatically)
  //   - expense.balance_due → what's still owed
  // This way toggling the paid bubble updates all three numbers in lockstep,
  // and "already paid" expenses count toward Paid the same as a logged payment.
  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPaid = expenses.reduce((s, e) => s + Number(e.paid_amount || 0), 0);
  const unpaidBalance = expenses.reduce((s, e) => s + Number(e.balance_due ?? Math.max(0, Number(e.amount || 0) - Number(e.paid_amount || 0))), 0);

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
  /**
   * Remove this expense from a specific payment's coverage. Does NOT delete the
   * payment itself — the payment stays put and its money becomes unallocated.
   * The backend re-runs the paid-flag refresh so the expense's balance pops
   * back into Open immediately.
   */
  const unapplyPayment = async (payment: Payment, expense: Expense) => {
    const nextIds = (payment.applied_expense_ids || []).filter((eid) => eid !== expense.id);
    const nextAllocs = (payment.allocations || []).filter((a) => a.expense_id !== expense.id);
    try {
      await api.patch(`/payments/${payment.id}`, {
        applied_expense_ids: nextIds,
        // Explicitly send allocations so the server doesn't waterfall this
        // payment again across the remaining expenses (the user just chose
        // to unapply, they didn't ask for a re-distribution).
        allocations: nextAllocs,
      });
      load();
    } catch (err: any) {
      Alert.alert("Couldn't unapply", err?.response?.data?.detail || "Please try again.");
    }
  };
  const deletePayment = async (pid: string) => {
    await api.delete(`/payments/${pid}`);
    load();
  };

  const toggleCompetition = async (compId: string) => {
    if (!athlete) return;
    const current = new Set(athlete.competition_ids || []);
    if (current.has(compId)) current.delete(compId); else current.add(compId);
    const next = Array.from(current);
    // Optimistic update
    setAthlete({ ...athlete, competition_ids: next });
    setSavingComps(true);
    try {
      await api.patch(`/athletes/${athlete.id}`, { competition_ids: next });
    } catch (_e) {
      // Revert on failure
      setAthlete(athlete);
      Alert.alert("Error", "Could not update competitions.");
    } finally {
      setSavingComps(false);
    }
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
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/athletes/new", params: { id } })}
            style={styles.iconBtn}
            testID="athlete-edit-btn"
          >
            <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={removeAthlete} style={styles.iconBtn} testID="athlete-delete-btn">
            <Ionicons name="trash-outline" size={20} color={colors.dangerText} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        <View style={styles.summaryCard}>
          <View style={[styles.avatar, { backgroundColor: athlete?.avatar_color || colors.accent }]}>
            {athlete?.avatar_image ? (
              <Image source={{ uri: athlete.avatar_image }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{athlete?.name?.[0]?.toUpperCase() || "?"}</Text>
            )}
          </View>
          <Text style={styles.athleteName}>{athlete?.name}</Text>
          {(() => {
            const at =
              (athlete?.team_ids || []).map((tid) => teams.find((t) => t.id === tid)).find(Boolean) ||
              (athlete?.team ? teams.find((t) => t.name.toLowerCase() === String(athlete.team).toLowerCase()) : undefined);
            if (at) {
              return (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <TeamAvatar logoImage={at.logo_image} color={at.color} size={18} />
                  <Text style={styles.athleteMeta}>{[at.name, athlete?.gym].filter(Boolean).join(" • ")}</Text>
                </View>
              );
            }
            if (athlete?.team || athlete?.gym) {
              return <Text style={styles.athleteMeta}>{[athlete?.team, athlete?.gym].filter(Boolean).join(" • ")}</Text>;
            }
            return null;
          })()}
          <View style={styles.summaryRow}>
            <Stat label="Season Total" value={formatCurrency(totalSpent)} />
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
          <TouchableOpacity onPress={() => setTab("events")} style={[styles.tab, tab === "events" && styles.tabActive]} testID="tab-events">
            <Text style={[styles.tabText, tab === "events" && styles.tabTextActive]}>Events</Text>
          </TouchableOpacity>
        </View>

        {/* Competitions attending */}
        <View style={styles.compSection} testID="athlete-competitions-section">
          <View style={styles.compHeader}>
            <Text style={styles.sectionTitle}>Competitions attending</Text>
            {savingComps && <ActivityIndicator size="small" color={colors.accent} />}
          </View>
          {competitions.length === 0 ? (
            <TouchableOpacity onPress={() => router.push("/competitions/new")} style={styles.compEmpty}>
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.compEmptyText}>Add a competition first</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.compChips}>
              {competitions.map((c) => {
                const on = (athlete?.competition_ids || []).includes(c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => toggleCompetition(c.id)}
                    style={[styles.compChip, on && styles.compChipOn]}
                    testID={`comp-toggle-${c.id}`}
                  >
                    <Ionicons
                      name={on ? "checkmark-circle" : "ellipse-outline"}
                      size={16}
                      color={on ? "white" : colors.textSecondary}
                    />
                    <Text style={[styles.compChipText, on && styles.compChipTextOn]} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
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
            ) : expenses.map((e) => {
              const paidAmt = Number(e.paid_amount || 0);
              const balance = Math.max(0, Number(e.balance_due ?? (Number(e.amount) - paidAmt)));
              const fullyPaid = e.paid || balance <= 0.001;
              const partiallyPaid = paidAmt > 0.001 && !fullyPaid;
              const pct = Number(e.amount) > 0 ? Math.min(100, Math.round((paidAmt / Number(e.amount)) * 100)) : 0;
              return (
                <View key={e.id} style={styles.row} testID={`expense-row-${e.id}`}>
                  <TouchableOpacity onPress={() => togglePaid(e)} style={[styles.statusDot, fullyPaid && { backgroundColor: colors.successText, borderColor: colors.successText }]}>
                    {fullyPaid && <Ionicons name="checkmark" size={14} color="white" />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, marginLeft: spacing.md }}
                    onPress={() => router.push({ pathname: "/expenses/new", params: { id: e.id } })}
                    activeOpacity={0.7}
                    testID={`expense-edit-${e.id}`}
                  >
                    <Text style={styles.rowTitle}>{e.category}</Text>
                    <Text style={styles.rowMeta}>
                      {formatDate(e.incurred_on)}{e.due_date ? ` • due ${formatDate(e.due_date)}` : ""}
                    </Text>
                    {partiallyPaid && (
                      <View style={styles.progressWrap}>
                        <View style={[styles.progressFill, { width: `${pct}%` }]} />
                      </View>
                    )}
                    {(partiallyPaid || fullyPaid) && (
                      <Text style={[styles.rowNote, { color: fullyPaid ? colors.successText : colors.textSecondary }]}>
                        Paid {formatCurrency(paidAmt)}{!fullyPaid ? ` of ${formatCurrency(e.amount)}` : ""}
                      </Text>
                    )}
                    {/* Show each payment covering this expense with an Unapply button. */}
                    {(() => {
                      const covering = payments.filter((p) =>
                        (p.applied_expense_ids || []).includes(e.id) ||
                        (p.allocations || []).some((a) => a.expense_id === e.id)
                      );
                      if (covering.length === 0) return null;
                      return (
                        <View style={styles.applChipRow}>
                          {covering.map((p) => {
                            const alloc = (p.allocations || []).find((a) => a.expense_id === e.id);
                            const amt = alloc ? alloc.amount : p.amount;
                            return (
                              <View key={p.id} style={styles.applChip} testID={`applied-chip-${e.id}-${p.id}`}>
                                <Ionicons name="link" size={11} color={colors.accent} />
                                <Text style={styles.applChipText} numberOfLines={1}>
                                  {formatDate(p.paid_on)} • {formatCurrency(amt)}
                                </Text>
                                <TouchableOpacity
                                  onPress={() => Alert.alert(
                                    "Unapply this payment?",
                                    `Remove ${formatCurrency(amt)} (${formatDate(p.paid_on)}) from this expense? The payment stays put, but the expense balance reopens.`,
                                    [
                                      { text: "Cancel", style: "cancel" },
                                      { text: "Unapply", style: "destructive", onPress: () => unapplyPayment(p, e) },
                                    ],
                                  )}
                                  hitSlop={6}
                                  testID={`unapply-${e.id}-${p.id}`}
                                >
                                  <Ionicons name="close-circle" size={14} color={colors.textTertiary} />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      );
                    })()}
                    {e.note && <Text style={styles.rowNote} numberOfLines={1}>{e.note}</Text>}
                  </TouchableOpacity>
                  <View style={{ alignItems: "flex-end" }}>
                    {fullyPaid ? (
                      <Text style={[styles.rowAmount, { color: colors.successText, textDecorationLine: "line-through" }]}>
                        {formatCurrency(e.amount)}
                      </Text>
                    ) : (
                      <>
                        <Text style={styles.rowAmount}>{formatCurrency(balance)}</Text>
                        <TouchableOpacity
                          onPress={() => setApplySheet(e)}
                          style={styles.payBtn}
                          testID={`apply-payment-${e.id}`}
                        >
                          <Ionicons name="cash-outline" size={12} color="white" />
                          <Text style={styles.payBtnText}>Apply</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity onPress={() => deleteExpense(e.id)} hitSlop={10} style={{ marginTop: 4 }}>
                      <Ionicons name="trash-outline" size={14} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
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
            ) : payments.map((p) => {
              const linkedCats = (p.applied_expense_ids || [])
                .map((eid) => expenses.find((e) => e.id === eid)?.category)
                .filter(Boolean) as string[];
              return (
              <View key={p.id} style={styles.row}>
                <View style={[styles.iconCircle, { backgroundColor: colors.successBg }]}>
                  <Ionicons name="cash" size={16} color={colors.successText} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowTitle}>{p.method || "Payment"}</Text>
                  <Text style={styles.rowMeta}>{formatDate(p.paid_on, { withYear: true })}</Text>
                  {linkedCats.length > 0 && (
                    <Text style={[styles.rowNote, { color: colors.accent, fontWeight: "600" }]} numberOfLines={1}>
                      Applied to: {linkedCats.join(", ")}
                    </Text>
                  )}
                  {p.note && <Text style={styles.rowNote} numberOfLines={1}>{p.note}</Text>}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.rowAmount, { color: colors.successText }]}>{formatCurrency(p.amount)}</Text>
                  <TouchableOpacity onPress={() => deletePayment(p.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              </View>
              );
            })}
          </>
        )}

        {tab === "events" && (() => {
          // An event is "for this athlete" if they're either explicitly assigned
          // to the schedule event, or attending a competition that has an
          // event_date in range. We also expose a way to add a new event
          // pre-filled with this athlete.
          const todayStr = new Date().toISOString().slice(0, 10);
          const myEvents = events
            .filter((ev) => (ev.athlete_ids || []).includes(id!) && ev.date >= todayStr)
            .sort((a, b) => (a.date < b.date ? -1 : 1));
          const myComps = competitions
            .filter((c) => (athlete?.competition_ids || []).includes(c.id) && c.event_date >= todayStr)
            .sort((a, b) => (a.event_date < b.event_date ? -1 : 1));

          if (myEvents.length === 0 && myComps.length === 0) {
            return (
              <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.lg }}>
                <Text style={styles.emptyHint}>
                  No upcoming events for this {athlete?.team ? "athlete" : "person"}. Add a schedule event or
                  attach a competition above.
                </Text>
              </View>
            );
          }

          const fmtT = (t?: string) => {
            if (!t || !/^\d{1,2}:\d{2}/.test(t)) return "";
            const [hS, m] = t.split(":");
            let h = Number(hS); const p = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
            return `${h}:${m} ${p}`;
          };

          return (
            <View>
              {myComps.length > 0 && <Text style={styles.eventsHead}>Competitions</Text>}
              {myComps.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.eventRow}
                  onPress={() => router.push(`/competitions/${c.id}`)}
                  testID={`event-comp-${c.id}`}
                >
                  <Ionicons name="trophy-outline" size={18} color={colors.accent} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.rowTitle}>{c.name}</Text>
                    <Text style={styles.rowMeta}>
                      {formatDate(c.event_date, { withYear: true })}{c.location ? ` • ${c.location}` : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}

              {myEvents.length > 0 && <Text style={styles.eventsHead}>Practices & lessons</Text>}
              {myEvents.map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  style={styles.eventRow}
                  onPress={() => router.push({ pathname: "/schedule/new", params: { id: ev.id } })}
                  testID={`event-row-${ev.id}`}
                >
                  <Ionicons name="time-outline" size={18} color={colors.accent} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.rowTitle}>{ev.title}</Text>
                    <Text style={styles.rowMeta}>
                      {formatDate(ev.date, { withYear: true })}
                      {ev.start_time ? ` • ${fmtT(ev.start_time)}` : ""}
                      {ev.location ? ` • ${ev.location}` : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          );
        })()}
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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: "center", marginHorizontal: spacing.md },
  summaryCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  avatar: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: spacing.md, overflow: "hidden" },
  avatarText: { color: "white", fontSize: 28, fontWeight: "800" },
  avatarImage: { width: 64, height: 64, borderRadius: 22 },
  athleteName: { ...typography.h2, color: colors.textPrimary },
  athleteMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  summaryRow: { flexDirection: "row", marginTop: spacing.lg, width: "100%" },
  vdiv: { width: 1, backgroundColor: colors.border },
  statLabel: { ...typography.micro, color: colors.textTertiary },
  statValue: { ...typography.h3, color: colors.textPrimary, marginTop: 2 },
  tabs: { flexDirection: "row", marginTop: spacing.lg, backgroundColor: colors.card, padding: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: colors.accent },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" },
  tabTextActive: { color: "white" },
  compSection: { marginTop: spacing.lg, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  compHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  compChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  compChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, maxWidth: "100%" },
  compChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  compChipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  compChipTextOn: { color: "white" },
  compEmpty: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.sm },
  compEmptyText: { ...typography.body, color: colors.accent, fontWeight: "600" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  addRowText: { color: colors.accent, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  statusDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  iconCircle: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowNote: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  rowAmount: { ...typography.h3, color: colors.textPrimary, marginBottom: 4 },
  payBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.accent, borderRadius: 999, marginTop: 2 },
  payBtnText: { color: "white", fontWeight: "700", fontSize: 11, letterSpacing: 0.3 },
  progressWrap: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: colors.successText },
  emptyHint: { ...typography.body, color: colors.textTertiary, textAlign: "center", marginTop: spacing.xl },
  applChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  applChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.accentSubtle, borderRadius: 999, borderWidth: 1, borderColor: colors.accent, maxWidth: 220 },
  applChipText: { ...typography.micro, color: colors.accent, fontWeight: "700" },
  eventsHead: { ...typography.caption, color: colors.textTertiary, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginTop: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  eventRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: 8 },
});
