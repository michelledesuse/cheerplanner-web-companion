import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/context/ThemeContext";
import { colors, radius, spacing, typography, shadow } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDateLong, daysBetween } from "@/src/utils/format";

type Dashboard = {
  athletes_count: number;
  competitions_count: number;
  total_expenses_ytd: number;
  total_payments_ytd: number;
  outstanding_balance: number;
  due_today: number;
  booking_balance: number;
  unpaid_expense_balance: number;
  month_spend: number;
  total_raised: number;
  next_competition: any | null;
};

type ReminderItem = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  amount?: number | null;
  due_date: string;
  days_until: number;
};

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { refreshPresets } = useTheme(); // subscribe + sync the household theme on first mount
  const styles = useThemedStyles(makeStyles);
  // Bootstrap: pull the saved household preset once after login so a cold start
  // with empty AsyncStorage paints the user's real theme (not the default).
  useEffect(() => { refreshPresets(); }, [refreshPresets]);
  const [data, setData] = useState<Dashboard | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api.get("/dashboard"), api.get("/reminders")]);
      setData(d.data);
      setReminders((r.data.items as ReminderItem[]).filter((x) => x.days_until <= 14).slice(0, 4));
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const nextComp = data?.next_competition;
  const nextCompDays = nextComp ? daysBetween(nextComp.event_date) : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
        testID="dashboard-screen"
      >
        <View style={styles.header}>
          <View style={{ flex: 1, marginRight: spacing.md, minWidth: 0 }}>
            <Text style={styles.greeting} numberOfLines={1}>Hi {user?.name || user?.email?.split("@")[0]}</Text>
            <Text style={styles.subGreeting} numberOfLines={1}>Here's your cheer season at a glance</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/settings")}
            style={styles.headerRight}
            testID="settings-gear"
          >
            <View style={styles.gearBtn}>
              <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(user?.name || user?.email || "?")[0]?.toUpperCase()}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Stat tiles — tappable, each routes to its primary tab */}
        <View style={styles.tileRow}>
          <TouchableOpacity activeOpacity={0.7} style={styles.tile} onPress={() => router.push("/(tabs)/expenses")} testID="tile-this-month">
            <View style={[styles.tileIcon, { backgroundColor: colors.accentSubtle }]}>
              <Ionicons name="trending-up" size={18} color={colors.accent} />
            </View>
            <Text style={styles.tileValue}>{formatCurrency(data?.month_spend || 0)}</Text>
            <Text style={styles.tileLabel}>This month</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} style={styles.tile} onPress={() => router.push("/(tabs)/expenses?tab=payments")} testID="tile-paid-ytd">
            <View style={[styles.tileIcon, { backgroundColor: colors.successBg }]}>
              <Ionicons name="cash" size={18} color={colors.successText} />
            </View>
            <Text style={styles.tileValue}>{formatCurrency(data?.total_payments_ytd || 0)}</Text>
            <Text style={styles.tileLabel}>Paid YTD</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.tileRow}>
          <TouchableOpacity activeOpacity={0.7} style={styles.tile} onPress={() => router.push("/(tabs)/athletes")} testID="tile-athletes">
            <View style={[styles.tileIcon, { backgroundColor: colors.divider }]}>
              <Ionicons name="people" size={18} color={colors.primary} />
            </View>
            <Text style={styles.tileValue}>{data?.athletes_count || 0}</Text>
            <Text style={styles.tileLabel}>Athletes</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} style={styles.tile} onPress={() => router.push("/(tabs)/expenses?tab=fundraisers")} testID="tile-raised">
            <View style={[styles.tileIcon, { backgroundColor: colors.warningBg }]}>
              <Ionicons name="gift" size={18} color={colors.warningText} />
            </View>
            <Text style={styles.tileValue}>{formatCurrency(data?.total_raised || 0)}</Text>
            <Text style={styles.tileLabel}>Raised</Text>
          </TouchableOpacity>
        </View>

        {(data?.due_today || 0) > 0 && (
          <TouchableOpacity
            style={styles.dueTodayCard}
            activeOpacity={0.85}
            onPress={() => router.push("/(tabs)/expenses?filter=open")}
            testID="due-today-card"
          >
            <View style={styles.dueTodayIcon}>
              <Ionicons name="alarm-outline" size={16} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dueTodayLabel}>Total due today</Text>
              <Text style={styles.dueTodaySub}>Due today + overdue · expenses & travel</Text>
            </View>
            <Text style={styles.dueTodayValue}>{formatCurrency(data?.due_today || 0)}</Text>
          </TouchableOpacity>
        )}

        {/* Next competition */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Next competition</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/competitions")} testID="see-all-competitions">
            <Text style={styles.linkText}>See all</Text>
          </TouchableOpacity>
        </View>

        {nextComp ? (
          <TouchableOpacity
            style={styles.nextCompCard}
            onPress={() => router.push(`/competitions/${nextComp.id}`)}
            activeOpacity={0.9}
            testID="next-competition-card"
          >
            <Image
              source={{ uri: "https://images.pexels.com/photos/10183989/pexels-photo-10183989.jpeg" }}
              style={styles.nextCompImage}
            />
            <View style={styles.nextCompOverlay} />
            <View style={styles.nextCompContent}>
              <View style={styles.nextCompPill}>
                <Text style={styles.nextCompPillText}>
                  {nextCompDays !== null && nextCompDays >= 0 ? `In ${nextCompDays} days` : "Soon"}
                </Text>
              </View>
              <Text style={styles.nextCompName} numberOfLines={1}>{nextComp.name}</Text>
              <Text style={styles.nextCompMeta}>{nextComp.location || ""}</Text>
              <Text style={styles.nextCompDate}>{formatDateLong(nextComp.event_date)}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="trophy-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No upcoming competitions</Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push("/competitions/new")}
              testID="add-first-competition"
            >
              <Text style={styles.emptyBtnText}>Add competition</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Reminders */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Upcoming reminders</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/calendar")} testID="see-all-reminders">
            <Text style={styles.linkText}>See all</Text>
          </TouchableOpacity>
        </View>

        {reminders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={28} color={colors.successText} />
            <Text style={styles.emptyText}>You&apos;re all caught up</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {reminders.map((r) => (
              <TouchableOpacity
                key={r.id}
                activeOpacity={0.7}
                onPress={() => {
                  // Route the user to where they'd manage this kind of item.
                  if (r.kind === "expense" || r.kind === "payment") router.push("/(tabs)/expenses");
                  else if (r.kind === "booking_due" || r.kind === "cancel_by") router.push(`/competitions/${r.competition_id || r.ref_id}`);
                  else if (r.kind === "competition" || r.kind === "booking_release") router.push("/(tabs)/competitions");
                  else if (r.kind === "packing") router.push(`/competitions/${r.competition_id || r.ref_id}`);
                  else router.push("/(tabs)/calendar");
                }}
                testID={`reminder-${r.id}`}
              >
                <ReminderRow item={r} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Minimized balance summary — moved to bottom */}
        <TouchableOpacity
          style={styles.miniBalanceCard}
          testID="dashboard-balance-card"
          activeOpacity={0.85}
          onPress={() => router.push("/athletes")}
        >
          <View style={styles.miniBalanceItem}>
            <Text style={styles.miniBalanceLabel}>Outstanding</Text>
            <Text style={styles.miniBalanceValue}>{formatCurrency(data?.outstanding_balance || 0)}</Text>
          </View>
          <View style={styles.miniDivider} />
          <View style={styles.miniBalanceItem}>
            <Text style={styles.miniBalanceLabel}>Expenses due</Text>
            <Text style={styles.miniBalanceValueSm}>{formatCurrency(data?.unpaid_expense_balance || 0)}</Text>
          </View>
          <View style={styles.miniDivider} />
          <View style={styles.miniBalanceItem}>
            <Text style={styles.miniBalanceLabel}>Travel</Text>
            <Text style={styles.miniBalanceValueSm}>{formatCurrency(data?.booking_balance || 0)}</Text>
          </View>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ReminderRow({ item }: { item: ReminderItem }) {
  const styles = useThemedStyles(makeStyles);
  const overdue = item.days_until < 0;
  const soon = item.days_until <= 3 && item.days_until >= 0;
  const bg = overdue ? colors.dangerBg : soon ? colors.warningBg : colors.divider;
  const fg = overdue ? colors.dangerText : soon ? colors.warningText : colors.textSecondary;
  const label = overdue ? `${Math.abs(item.days_until)}d overdue` : item.days_until === 0 ? "Due today" : `${item.days_until}d`;
  return (
    <View style={styles.reminderRow} testID={`reminder-${item.kind}-${item.id}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.reminderTitle} numberOfLines={1}>{item.title}</Text>
        {item.amount != null ? (
          <Text style={styles.reminderAmount}>{formatCurrency(item.amount)}</Text>
        ) : (
          <Text style={styles.reminderSub} numberOfLines={1}>{item.subtitle || ""}</Text>
        )}
      </View>
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  greeting: { ...typography.h1, color: c.textPrimary },
  subGreeting: { ...typography.body, color: c.textSecondary, marginTop: 2 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "white", fontWeight: "800", fontSize: 16 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  gearBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border,
    alignItems: "center", justifyContent: "center",
  },
  miniBalanceCard: {
    marginTop: spacing.lg,
    backgroundColor: c.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  miniBalanceItem: { flex: 1, alignItems: "center" },
  dueTodayCard: {
    marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  dueTodayIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.divider, alignItems: "center", justifyContent: "center" },
  dueTodayLabel: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  dueTodaySub: { ...typography.micro, color: c.textTertiary, marginTop: 1 },
  dueTodayValue: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary },
  miniBalanceLabel: { ...typography.micro, color: c.textSecondary, marginBottom: 4 },
  miniBalanceValue: { fontSize: 17, fontWeight: "800", color: c.textPrimary, letterSpacing: -0.2 },
  miniBalanceValueSm: { fontSize: 14, fontWeight: "700", color: c.textPrimary },
  miniDivider: { width: 1, height: 28, backgroundColor: c.border },
  heroCard: {
    backgroundColor: c.primary, borderRadius: radius.xl, padding: spacing.xl,
    ...shadow.card,
  },
  heroLabel: { color: "rgba(255,255,255,0.65)", ...typography.micro },
  heroAmount: { color: "white", fontSize: 36, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  heroSplit: {
    marginTop: spacing.lg, flexDirection: "row", backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radius.md, padding: spacing.md, gap: spacing.md,
  },
  heroSplitItem: { flex: 1 },
  heroSplitLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  heroSplitValue: { color: "white", fontSize: 16, fontWeight: "700", marginTop: 2 },
  divider: { width: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  tileRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  tile: {
    flex: 1, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: c.border,
  },
  tileIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  tileValue: { ...typography.h2, color: c.textPrimary },
  tileLabel: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: c.textPrimary },
  linkText: { ...typography.bodyMedium, color: c.accent, fontWeight: "600" },
  nextCompCard: { borderRadius: radius.xl, overflow: "hidden", height: 160, position: "relative" },
  nextCompImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  nextCompOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.6)" },
  nextCompContent: { flex: 1, padding: spacing.lg, justifyContent: "flex-end" },
  nextCompPill: { alignSelf: "flex-start", backgroundColor: c.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: spacing.sm },
  nextCompPillText: { color: "white", fontWeight: "700", fontSize: 11, letterSpacing: 0.5 },
  nextCompName: { color: "white", fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  nextCompMeta: { color: "rgba(255,255,255,0.85)", marginTop: 2, fontSize: 14 },
  nextCompDate: { color: "rgba(255,255,255,0.7)", marginTop: 6, fontSize: 13, fontWeight: "500" },
  emptyCard: {
    backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    padding: spacing.xl, alignItems: "center",
  },
  emptyText: { ...typography.body, color: c.textSecondary, marginTop: spacing.sm },
  emptyBtn: { marginTop: spacing.md, backgroundColor: c.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  emptyBtnText: { color: "white", fontWeight: "700" },
  reminderRow: {
    backgroundColor: c.card, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center",
  },
  reminderTitle: { ...typography.bodyMedium, color: c.textPrimary },
  reminderAmount: { ...typography.h3, color: c.textPrimary, marginTop: 2 },
  reminderSub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
});
