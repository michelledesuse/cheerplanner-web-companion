import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";
import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate } from "@/src/utils/format";

type Reminder = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  amount?: number | null;
  due_date: string;
  days_until: number;
  athlete_id?: string;
  competition_id?: string;
  ref_id: string;
};

export default function RemindersScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/reminders");
      setItems(r.data.items as Reminder[]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRealtimeRefetch(load);

  const overdue = items.filter(i => i.days_until < 0);
  const soon = items.filter(i => i.days_until >= 0 && i.days_until <= 7);
  const upcoming = items.filter(i => i.days_until > 7);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Reminders</Text>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyCircle}>
            <Ionicons name="checkmark" size={32} color={colors.successText} />
          </View>
          <Text style={styles.emptyTitle}>All clear!</Text>
          <Text style={styles.emptySub}>No upcoming payments or deadlines.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="reminders-list"
        >
          {overdue.length > 0 && (
            <View style={styles.overdueBanner} testID="overdue-banner">
              <Ionicons name="alert-circle" size={18} color={colors.dangerText} />
              <Text style={styles.overdueBannerText}>
                {overdue.length} {overdue.length === 1 ? "item" : "items"} overdue
              </Text>
            </View>
          )}

          {overdue.length > 0 && <Text style={styles.sectionHead}>Overdue</Text>}
          {overdue.map((r) => <ReminderCard key={r.id} item={r} onPress={() => navigate(router, r)} />)}

          {soon.length > 0 && <Text style={[styles.sectionHead, overdue.length > 0 && { marginTop: spacing.xl }]}>Due soon</Text>}
          {soon.map((r) => <ReminderCard key={r.id} item={r} onPress={() => navigate(router, r)} />)}

          {upcoming.length > 0 && <Text style={[styles.sectionHead, { marginTop: spacing.xl }]}>Upcoming</Text>}
          {upcoming.map((r) => <ReminderCard key={r.id} item={r} onPress={() => navigate(router, r)} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function navigate(router: any, r: Reminder) {
  if (r.kind === "expense" && r.athlete_id) router.push(`/athletes/${r.athlete_id}`);
  else if ((r.kind === "booking" || r.kind === "booking_release" || r.kind === "cancel_by") && r.competition_id) router.push(`/competitions/${r.competition_id}`);
  else if (r.kind === "booking_release") router.push(`/competitions/${r.ref_id}`);
}

function ReminderCard({ item, onPress }: { item: Reminder; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const overdue = item.days_until < 0;
  const soon = item.days_until >= 0 && item.days_until <= 3;
  const label = overdue
    ? `${Math.abs(item.days_until)}d overdue`
    : item.days_until === 0
    ? "Today"
    : item.days_until === 1
    ? "Tomorrow"
    : `in ${item.days_until}d`;
  const bg = overdue ? colors.dangerBg : soon ? colors.warningBg : "#F1F5F9";
  const fg = overdue ? colors.dangerText : soon ? colors.warningText : colors.textSecondary;
  const iconName =
    item.kind === "expense" ? "wallet" :
    item.kind === "booking" ? "card" :
    item.kind === "booking_release" ? "alarm" :
    item.kind === "cancel_by" ? "close-circle" : "notifications";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85} testID={`reminder-card-${item.id}`}>
      <View style={[styles.iconBox, { backgroundColor: bg }]}>
        <Ionicons name={iconName as any} size={18} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardMeta}>{formatDate(item.due_date, { withYear: true })}</Text>
        {item.amount != null && (
          <Text style={styles.cardAmount}>{formatCurrency(item.amount)}</Text>
        )}
      </View>
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: { padding: spacing.lg },
  title: { ...typography.display, color: colors.textPrimary },
  emptyCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  emptyTitle: { ...typography.h2, color: colors.textPrimary },
  emptySub: { ...typography.body, color: colors.textSecondary, marginTop: 4 },
  overdueBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.md, backgroundColor: colors.dangerBg, borderRadius: radius.md, marginBottom: spacing.lg },
  overdueBannerText: { color: colors.dangerText, fontWeight: "700" },
  sectionHead: { ...typography.micro, color: colors.textTertiary, marginBottom: spacing.md },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, gap: spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  cardMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cardAmount: { ...typography.h3, color: colors.accent, marginTop: 4 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
});
