import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Linking, Modal, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, type DateData } from "react-native-calendars";
import { useFocusEffect, useRouter } from "expo-router";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDateLong, todayISO } from "@/src/utils/format";
import TeamAvatar from "@/src/components/TeamAvatar";
import DateJumpDropdown from "@/src/components/DateJumpDropdown";
import HomeButton from "@/src/components/HomeButton";
import FilterChipRow from "@/src/components/FilterChipRow";
import ActiveFiltersBar from "@/src/components/ActiveFiltersBar";
import { toggleId } from "@/src/utils/filters";

type CalEvent = {
  id: string;
  kind: string;
  date: string;
  title: string;
  subtitle?: string;
  amount?: number;
  color: string;
  event_type?: string;
  logo_image?: string | null;
  link?: string;
  links?: { label: string; url: string }[];
};

const BUILTIN_TYPE_LABEL: Record<string, string> = {
  practice: "Practice", team_bonding: "Team Bonding", private_lesson: "Private Lesson",
  choreography: "Choreography", class: "Class", fundraiser: "Fundraiser", other: "Other",
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
  team_meet: "people",
  team_performance: "ribbon",
  team_to_watch: "eye",
};

type CalView = "month" | "week" | "day";

function isoAddDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoStartOfWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return isoAddDays(iso, -d.getDay());
}

export default function CalendarTab() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [selected, setSelected] = useState<string>(todayISO());
  const [month, setMonth] = useState<string>(todayISO().slice(0, 7));
  const [view, setView] = useState<CalView>("month");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [customTypes, setCustomTypes] = useState<{ id: string; label: string; color: string }[]>([]);

  useEffect(() => {
    api.get("/household/custom-types").then((r) => setCustomTypes(r.data.event_types || [])).catch(() => {});
  }, []);

  const startAdd = (kind: "competition" | "event") => {
    setAddOpen(false);
    const d = selected || todayISO();
    if (kind === "competition") router.push(`/competitions/new?date=${d}` as any);
    else router.push(`/schedule/new?date=${d}` as any);
  };

  const applyJump = (iso: string) => {
    if (!iso) return;
    setSelected(iso);
    setMonth(iso.slice(0, 7));
  };

  const range = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    if (view === "day") return { start: selected, end: selected };
    if (view === "week") { const s = isoStartOfWeek(selected); return { start: s, end: isoAddDays(s, 6) }; }
    const [y, m] = month.split("-").map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 0));
    return {
      start: `${startDate.getUTCFullYear()}-${pad(startDate.getUTCMonth() + 1)}-${pad(startDate.getUTCDate())}`,
      end: `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}`,
    };
  }, [view, selected, month]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: CalEvent[] }>(`/calendar?start=${range.start}&end=${range.end}`);
      setEvents(r.data.items);
    } finally { setLoading(false); setRefreshing(false); }
  }, [range.start, range.end]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRealtimeRefetch(load);

  const passesType = useCallback(
    (e: CalEvent) => typeFilter.length === 0 || e.kind !== "schedule" || (!!e.event_type && typeFilter.includes(e.event_type)),
    [typeFilter],
  );

  const typeOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color?: string }>();
    for (const e of events) {
      if (e.kind === "schedule" && e.event_type && !seen.has(e.event_type)) {
        const label = BUILTIN_TYPE_LABEL[e.event_type] || customTypes.find((t) => t.id === e.event_type)?.label || "Other";
        seen.set(e.event_type, { id: e.event_type, label, color: e.color });
      }
    }
    return Array.from(seen.values());
  }, [events, customTypes]);

  // Group dots per date
  const markedDates = useMemo(() => {
    const map: Record<string, { dots: Array<{ key: string; color: string }>; marked?: boolean; selected?: boolean; selectedColor?: string }> = {};
    const seen: Record<string, Set<string>> = {};
    for (const e of events) {
      if (!passesType(e)) continue;
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
  }, [events, selected, passesType]);

  const dayEvents = (d: string) => events.filter((e) => e.date === d && passesType(e));

  const renderEvent = (e: CalEvent) => (
    <View key={e.id} style={styles.eventRow} testID={`event-${e.id}`}>
      <TouchableOpacity
        onPress={() => { if (e.link) router.push(e.link as any); }}
        style={styles.eventMain}
        testID={`event-open-${e.id}`}
      >
        {e.logo_image ? (
          <TeamAvatar logoImage={e.logo_image} color={e.color} size={36} />
        ) : (
          <View style={[styles.eventIcon, { backgroundColor: e.color + "22" }]}>
            <Ionicons name={KIND_ICONS[e.kind] || "calendar"} size={18} color={e.color} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.eventTitle}>{e.title}</Text>
          {!!e.subtitle && <Text style={styles.eventMeta}>{e.subtitle}</Text>}
        </View>
        {e.amount != null && (
          <Text style={[styles.eventAmount, { color: e.color }]}>{formatCurrency(e.amount)}</Text>
        )}
      </TouchableOpacity>

      {Array.isArray(e.links) && e.links.length > 0 && (
        <View style={styles.linkChips}>
          {e.links.map((lnk, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.linkChip, { borderColor: e.color }]}
              onPress={() => Linking.openURL(lnk.url)}
              testID={`event-link-${e.id}-${i}`}
            >
              <Ionicons name="link-outline" size={13} color={e.color} />
              <Text style={[styles.linkChipText, { color: e.color }]} numberOfLines={1}>
                {lnk.label || lnk.url}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const weekDays = useMemo(() => {
    const s = isoStartOfWeek(selected);
    return Array.from({ length: 7 }, (_, i) => isoAddDays(s, i));
  }, [selected]);

  const spinner = <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />;
  const emptyText = <Text style={styles.empty}>Nothing scheduled.</Text>;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Calendar</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <HomeButton />
          {selected !== todayISO() && (
            <TouchableOpacity onPress={() => applyJump(todayISO())} style={styles.todayBtn} testID="cal-today">
              <Ionicons name="today-outline" size={14} color={colors.accent} />
              <Text style={styles.todayText}>Today</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setJumpOpen(true)} style={styles.jumpBtn} testID="cal-jump" accessibilityLabel="Jump to date">
            <Ionicons name="calendar-clear-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.addBtn} testID="cal-add" accessibilityLabel="Add to calendar">
            <Ionicons name="add" size={22} color="white" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.viewToggleRow}>
        <View style={styles.viewToggle}>
          {(["month", "week", "day"] as const).map((v) => (
            <TouchableOpacity key={v} onPress={() => setView(v)} style={[styles.viewChip, view === v && styles.viewChipOn]} testID={`calview-${v}`}>
              <Text style={[styles.viewChipText, view === v && styles.viewChipTextOn]}>{v[0].toUpperCase() + v.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {typeOptions.length > 0 && (
        <View style={{ marginBottom: spacing.sm }}>
          <FilterChipRow
            label="Event types"
            testIDPrefix="cal-filter-type"
            selectedIds={typeFilter}
            onToggle={(id) => setTypeFilter((p) => toggleId(p, id))}
            onClear={() => setTypeFilter([])}
            options={typeOptions}
          />
          <ActiveFiltersBar testIDPrefix="cal-filters" count={typeFilter.length} onClear={() => setTypeFilter([])} />
        </View>
      )}

      <DateJumpDropdown
        visible={jumpOpen}
        currentISO={selected}
        onJump={applyJump}
        onClose={() => setJumpOpen(false)}
      />

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAddOpen(false)} testID="cal-add-backdrop">
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Add to {formatDateLong(selected)}</Text>
            <TouchableOpacity style={styles.sheetRow} onPress={() => startAdd("competition")} testID="cal-add-competition">
              <View style={[styles.sheetIcon, { backgroundColor: "#007CFF22" }]}>
                <Ionicons name="trophy" size={20} color="#007CFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetRowTitle}>Competition</Text>
                <Text style={styles.sheetRowSub}>Add a competition or event day</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetRow} onPress={() => startAdd("event")} testID="cal-add-event">
              <View style={[styles.sheetIcon, { backgroundColor: "#EA580C22" }]}>
                <Ionicons name="calendar" size={20} color="#EA580C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetRowTitle}>Event</Text>
                <Text style={styles.sheetRowSub}>Practice, lesson, bonding & more</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setAddOpen(false)} testID="cal-add-cancel">
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {view === "month" && (
          <>
            <Calendar
              key={selected}
              current={selected}
              markingType="multi-dot"
              markedDates={markedDates}
              onDayPress={(d: DateData) => setSelected(d.dateString)}
              onMonthChange={(d: DateData) => setMonth(`${d.year}-${String(d.month).padStart(2, "0")}`)}
              theme={{
                backgroundColor: colors.bg, calendarBackground: colors.bg,
                todayTextColor: colors.accent, selectedDayBackgroundColor: colors.accent,
                selectedDayTextColor: "white", arrowColor: colors.accent,
                textMonthFontWeight: "800", textDayFontWeight: "500", textDayHeaderFontWeight: "700",
                monthTextColor: colors.textPrimary, dayTextColor: colors.textPrimary,
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
              {loading ? spinner : dayEvents(selected).length === 0 ? emptyText : dayEvents(selected).map(renderEvent)}
            </View>
          </>
        )}

        {view === "day" && (
          <View style={styles.daySection}>
            <View style={styles.navRow}>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, -1))} style={styles.navBtn} testID="cal-prev"><Ionicons name="chevron-back" size={20} color={colors.textPrimary} /></TouchableOpacity>
              <Text style={styles.dayTitle}>{formatDateLong(selected)}</Text>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, 1))} style={styles.navBtn} testID="cal-next"><Ionicons name="chevron-forward" size={20} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            {loading ? spinner : dayEvents(selected).length === 0 ? emptyText : dayEvents(selected).map(renderEvent)}
          </View>
        )}

        {view === "week" && (
          <View style={styles.daySection}>
            <View style={styles.navRow}>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, -7))} style={styles.navBtn} testID="cal-prev"><Ionicons name="chevron-back" size={20} color={colors.textPrimary} /></TouchableOpacity>
              <Text style={styles.dayTitle}>Week of {formatDateLong(weekDays[0])}</Text>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, 7))} style={styles.navBtn} testID="cal-next"><Ionicons name="chevron-forward" size={20} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            {loading ? spinner : weekDays.map((d) => (
              <View key={d} style={{ marginBottom: spacing.md }}>
                <Text style={styles.weekDayHead}>{formatDateLong(d)}</Text>
                {dayEvents(d).length === 0 ? <Text style={styles.weekEmpty}>—</Text> : dayEvents(d).map(renderEvent)}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: c.textPrimary },
  viewToggle: { flexDirection: "row", backgroundColor: c.card, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: c.border },
  viewToggleRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  jumpBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  sheetIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sheetRowTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  sheetRowSub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  sheetCancel: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  sheetCancelText: { ...typography.bodyMedium, fontWeight: "700", color: c.textSecondary },
  todayBtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 38, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent },
  todayText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  viewChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  viewChipOn: { backgroundColor: c.accent },
  viewChipText: { ...typography.caption, fontWeight: "800", color: c.textSecondary },
  viewChipTextOn: { color: "white" },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  weekDayHead: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, marginBottom: 6 },
  weekEmpty: { ...typography.caption, color: c.textTertiary, marginBottom: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.caption, color: c.textSecondary },
  daySection: { padding: spacing.lg },
  dayTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.md },
  empty: { ...typography.body, color: c.textTertiary, marginTop: spacing.lg, textAlign: "center" },
  eventRow: { padding: spacing.md, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, marginBottom: 8 },
  eventMain: { flexDirection: "row", alignItems: "center" },
  linkChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginLeft: 48 },
  linkChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 200 },
  linkChipText: { ...typography.caption, fontWeight: "700", flexShrink: 1 },
  eventIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  eventTitle: { ...typography.bodyMedium, color: c.textPrimary },
  eventMeta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  eventAmount: { ...typography.h3, fontWeight: "800" },
});
