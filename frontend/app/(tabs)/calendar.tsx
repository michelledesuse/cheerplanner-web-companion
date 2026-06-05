import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, type DateData } from "react-native-calendars";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatCurrency, formatDateLong, todayISO } from "@/src/utils/format";

type CalEvent = {
  id: string;
  kind: string;
  date: string;
  title: string;
  subtitle?: string;
  amount?: number;
  color: string;
  link?: string;
};

const KIND_ICONS: Record<string, any> = {
  expense_due: "alert-circle",
  competition: "trophy",
  hotel_checkin: "bed",
  hotel_checkout: "bed-outline",
  hotel_stay: "bed",
  flight_depart: "airplane",
  flight_return: "airplane",
  flight_arrive: "airplane",
  travel_day: "navigate",
  transport: "car",
  fundraiser: "gift",
};

export default function CalendarTab() {
  const router = useRouter();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [selected, setSelected] = useState<string>(todayISO());
  const [month, setMonth] = useState<string>(todayISO().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const monthRange = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 0));
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = `${startDate.getUTCFullYear()}-${pad(startDate.getUTCMonth() + 1)}-${pad(startDate.getUTCDate())}`;
    const end = `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}`;
    return { start, end };
  }, [month]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: CalEvent[] }>(`/calendar?start=${monthRange.start}&end=${monthRange.end}`);
      setEvents(r.data.items);
    } finally { setLoading(false); setRefreshing(false); }
  }, [monthRange.start, monthRange.end]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Group dots per date
  const markedDates = useMemo(() => {
    const map: Record<string, { dots: Array<{ key: string; color: string }>; marked?: boolean; selected?: boolean; selectedColor?: string }> = {};
    const seen: Record<string, Set<string>> = {};
    for (const e of events) {
      if (!seen[e.date]) seen[e.date] = new Set();
      if (!seen[e.date].has(e.color)) {
        seen[e.date].add(e.color);
        if (!map[e.date]) map[e.date] = { dots: [] };
        map[e.date].dots.push({ key: `${e.kind}-${map[e.date].dots.length}`, color: e.color });
        map[e.date].marked = true;
      }
    }
    // Selection style
    map[selected] = {
      ...(map[selected] || { dots: [] }),
      selected: true,
      selectedColor: colors.accent,
    };
    return map;
  }, [events, selected]);

  const dayEvents = events.filter((e) => e.date === selected);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Calendar</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        <Calendar
          current={selected}
          markingType="multi-dot"
          markedDates={markedDates}
          onDayPress={(d: DateData) => setSelected(d.dateString)}
          onMonthChange={(d: DateData) => setMonth(`${d.year}-${String(d.month).padStart(2, "0")}`)}
          theme={{
            backgroundColor: colors.bg,
            calendarBackground: colors.bg,
            todayTextColor: colors.accent,
            selectedDayBackgroundColor: colors.accent,
            selectedDayTextColor: "white",
            arrowColor: colors.accent,
            textMonthFontWeight: "800",
            textDayFontWeight: "500",
            textDayHeaderFontWeight: "700",
            monthTextColor: colors.textPrimary,
            dayTextColor: colors.textPrimary,
            textSectionTitleColor: colors.textSecondary,
          }}
          style={{ marginHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingBottom: 8 }}
        />

        <View style={styles.legend}>
          {[
            { color: "#E11D48", label: "Due" },
            { color: "#007CFF", label: "Comp" },
            { color: "#7C3AED", label: "Travel" },
            { color: "#16A34A", label: "Fundraiser" },
          ].map((l) => (
            <View key={l.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: l.color }]} />
              <Text style={styles.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.daySection}>
          <Text style={styles.dayTitle}>{formatDateLong(selected)}</Text>
          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
          ) : dayEvents.length === 0 ? (
            <Text style={styles.empty}>Nothing scheduled.</Text>
          ) : (
            dayEvents.map((e) => (
              <TouchableOpacity
                key={e.id}
                onPress={() => { if (e.link) router.push(e.link as any); }}
                style={styles.eventRow}
                testID={`event-${e.id}`}
              >
                <View style={[styles.eventIcon, { backgroundColor: e.color + "22" }]}>
                  <Ionicons name={KIND_ICONS[e.kind] || "calendar"} size={18} color={e.color} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.eventTitle}>{e.title}</Text>
                  {!!e.subtitle && <Text style={styles.eventMeta}>{e.subtitle}</Text>}
                </View>
                {e.amount != null && (
                  <Text style={[styles.eventAmount, { color: e.color }]}>{formatCurrency(e.amount)}</Text>
                )}
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  headerBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: colors.textPrimary },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.caption, color: colors.textSecondary },
  daySection: { padding: spacing.lg },
  dayTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  empty: { ...typography.body, color: colors.textTertiary, marginTop: spacing.lg, textAlign: "center" },
  eventRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  eventIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  eventTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  eventMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  eventAmount: { ...typography.h3, fontWeight: "800" },
});
