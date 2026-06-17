import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatDate } from "@/src/utils/format";
import MapLink from "@/src/components/MapLink";

type Athlete = { id: string; name: string; avatar_color?: string };
type Evt = {
  id: string; event_type: string; title: string; location?: string;
  date: string; start_time?: string; end_time?: string;
  athlete_ids?: string[]; notes?: string;
  series_id?: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  practice: "Practice", team_bonding: "Team Bonding", private_lesson: "Private Lesson",
  choreography: "Choreography", class: "Class", other: "Other",
};
const TYPE_COLOR: Record<string, string> = {
  practice: "#EA580C", team_bonding: "#0EA5E9", private_lesson: "#DB2777",
  choreography: "#9333EA", class: "#0891B2", other: "#64748B",
};

export default function ScheduleTab() {
  const router = useRouter();
  const [events, setEvents] = useState<Evt[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const enterSelectMode = () => { setSelectMode(true); setSelectedIds(new Set()); };
  const toggleSelected = (id: string) => {
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.get<Evt[]>("/schedule"), api.get<Athlete[]>("/athletes")]);
      setEvents(s.data); setAthletes(a.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    return () => { setSelectMode(false); setSelectedIds(new Set()); };
  }, [load]));

  const remove = async (e: Evt) => {
    const cleanup = async (scope: "single" | "series") => {
      try { await api.delete(`/schedule/${e.id}?scope=${scope}`); } finally { load(); }
    };
    if (e.series_id) {
      Alert.alert(
        "Delete recurring event",
        "This event is part of a recurring series.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "This event only", style: "destructive", onPress: () => cleanup("single") },
          { text: "All events in series", style: "destructive", onPress: () => cleanup("series") },
        ],
      );
    } else {
      Alert.alert("Delete event?", "This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => cleanup("single") },
      ]);
    }
  };

  const filtered = useMemo(() => (typeFilter ? events.filter((e) => e.event_type === typeFilter) : events), [events, typeFilter]);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => filtered.filter((e) => e.date >= today), [filtered, today]);
  const past = useMemo(() => filtered.filter((e) => e.date < today), [filtered, today]);

  const visibleIds = useMemo(() => filtered.map((e) => e.id), [filtered]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (allSelected) visibleIds.forEach((id) => n.delete(id));
      else visibleIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const bulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Note: bulk-delete deletes the individual event IDs only; recurring series
    // members must be selected individually (matches the "this event only" scope).
    Alert.alert(
      `Delete ${ids.length} event${ids.length === 1 ? "" : "s"}?`,
      "Only the selected events are removed. Recurring series stay otherwise intact.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.post("/bulk-delete", { resource: "schedule_events", ids });
              exitSelectMode();
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.response?.data?.detail || "Could not delete.");
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        {selectMode ? (
          <View style={styles.selectBar}>
            <TouchableOpacity onPress={exitSelectMode} hitSlop={10} testID="sched-select-cancel">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.selectBarText}>{selectedIds.size} selected</Text>
            <TouchableOpacity onPress={toggleSelectAll} hitSlop={6} testID="sched-select-all">
              <Text style={{ color: colors.accent, fontWeight: "700" }}>{allSelected ? "Clear" : "Select all"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={bulkDelete}
              disabled={selectedIds.size === 0}
              style={[styles.deleteBtn, { opacity: selectedIds.size === 0 ? 0.4 : 1 }]}
              testID="sched-bulk-delete"
            >
              <Ionicons name="trash" size={18} color="#DC2626" />
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.headerTitle}>Schedule</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {events.length > 0 && (
                <TouchableOpacity onPress={enterSelectMode} style={styles.selectBtn} testID="sched-enter-select">
                  <Ionicons name="checkmark-done" size={16} color={colors.accent} />
                  <Text style={styles.selectBtnText}>Select</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => router.push("/schedule/new")} style={styles.addBtn} testID="add-schedule">
                <Ionicons name="add" size={20} color="white" />
                <Text style={styles.addBtnText}>Event</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {!selectMode && (
        <View style={styles.filterWrap}>
          <TouchableOpacity onPress={() => setTypeFilter(null)} style={[styles.chip, typeFilter === null && styles.chipOn]}>
            <Text style={[styles.chipText, typeFilter === null && styles.chipTextOn]}>All</Text>
          </TouchableOpacity>
          {Object.entries(TYPE_LABEL).map(([k, label]) => (
            <TouchableOpacity key={k} onPress={() => setTypeFilter(k)} style={[styles.chip, typeFilter === k && styles.chipOn, { borderColor: TYPE_COLOR[k] }]}>
              <View style={[styles.chipDot, { backgroundColor: TYPE_COLOR[k] }]} />
              <Text style={[styles.chipText, typeFilter === k && styles.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {events.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="time-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.empty}>No events yet.</Text>
            <Text style={styles.emptySub}>Add practices, team bondings, lessons, and more.</Text>
            <TouchableOpacity onPress={() => router.push("/schedule/new")} style={styles.bigAddBtn}>
              <Ionicons name="add" size={18} color="white" />
              <Text style={styles.bigAddBtnText}>Add first event</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/import")} style={styles.bigAddBtnAlt}>
              <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} />
              <Text style={styles.bigAddBtnAltText}>Import from spreadsheet</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {upcoming.length > 0 && <Text style={styles.sectionHead}>Upcoming</Text>}
            {upcoming.map((e) => (
              <Row
                key={e.id}
                e={e}
                athletes={athletes}
                selectMode={selectMode}
                selected={selectedIds.has(e.id)}
                onPress={() => {
                  if (selectMode) { toggleSelected(e.id); return; }
                  router.push({ pathname: "/schedule/new", params: { id: e.id } });
                }}
                onLongPress={() => { setSelectMode(true); toggleSelected(e.id); }}
                onDelete={() => remove(e)}
              />
            ))}
            {past.length > 0 && <Text style={styles.sectionHead}>Past</Text>}
            {past.map((e) => (
              <Row
                key={e.id}
                e={e}
                athletes={athletes}
                selectMode={selectMode}
                selected={selectedIds.has(e.id)}
                onPress={() => {
                  if (selectMode) { toggleSelected(e.id); return; }
                  router.push({ pathname: "/schedule/new", params: { id: e.id } });
                }}
                onLongPress={() => { setSelectMode(true); toggleSelected(e.id); }}
                onDelete={() => remove(e)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ e, athletes, onPress, onLongPress, onDelete, selectMode, selected }: {
  e: Evt; athletes: Athlete[]; onPress: () => void; onLongPress?: () => void; onDelete: () => void; selectMode?: boolean; selected?: boolean;
}) {
  const color = TYPE_COLOR[e.event_type] || "#64748B";
  const fmt12 = (t?: string) => {
    if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t || "";
    const [hS, m] = t.split(":");
    let h = Number(hS); const p = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
    return `${h}:${m} ${p}`;
  };
  const time = e.start_time ? (e.end_time ? `${fmt12(e.start_time)} – ${fmt12(e.end_time)}` : fmt12(e.start_time)) : "";
  const names = (e.athlete_ids || []).map((id) => athletes.find((a) => a.id === id)?.name).filter(Boolean).join(", ");
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      style={[styles.row, selected && { borderColor: colors.accent, backgroundColor: colors.accentSubtle }]}
      testID={`schedule-row-${e.id}`}
    >
      {selectMode ? (
        <View style={[styles.checkBox, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
          {selected && <Ionicons name="checkmark" size={14} color="white" />}
        </View>
      ) : (
        <View style={[styles.typeStripe, { backgroundColor: color }]} />
      )}
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
          {e.series_id ? <Ionicons name="repeat" size={14} color={colors.accent} /> : null}
        </View>
        <Text style={styles.rowMeta}>
          {formatDate(e.date, { withYear: true })}{time ? ` • ${time}` : ""}
        </Text>
        {e.location ? (
          <View style={{ marginTop: 2 }}>
            <MapLink
              address={e.location}
              color={colors.textSecondary}
              numberOfLines={1}
              testID={`sched-map-${e.id}`}
            />
          </View>
        ) : null}
        {names ? <Text style={styles.rowAthletes}>{names}</Text> : null}
      </View>
      {!selectMode && (
        <TouchableOpacity onPress={(ev) => { ev.stopPropagation?.(); onDelete(); }} hitSlop={10}>
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: colors.textPrimary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.accent, borderRadius: 999 },
  addBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  selectBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accentSubtle, borderRadius: 999, borderWidth: 1, borderColor: colors.accent },
  selectBtnText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  selectBar: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  selectBarText: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1 },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleteBtnText: { color: "#DC2626", fontWeight: "700" },
  checkBox: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDot: { width: 7, height: 7, borderRadius: 3.5 },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600", fontSize: 12 },
  chipTextOn: { color: "white" },
  filterWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  sectionHead: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  typeStripe: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowAthletes: { ...typography.caption, color: colors.accent, marginTop: 2, fontWeight: "600" },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  empty: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  emptySub: { ...typography.body, color: colors.textTertiary, textAlign: "center" },
  bigAddBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.accent, borderRadius: 999, marginTop: spacing.md },
  bigAddBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  bigAddBtnAlt: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: colors.accentSubtle, borderRadius: 999, marginTop: 4 },
  bigAddBtnAltText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
});
