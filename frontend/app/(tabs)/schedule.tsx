import React, { useCallback, useState } from "react";
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

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.get<Evt[]>("/schedule"), api.get<Athlete[]>("/athletes")]);
      setEvents(s.data); setAthletes(a.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const grouped = (typeFilter ? events.filter(e => e.event_type === typeFilter) : events);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = grouped.filter(e => e.date >= today);
  const past = grouped.filter(e => e.date < today);

  const athleteName = (id: string) => athletes.find(a => a.id === id)?.name || "";

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Schedule</Text>
        <TouchableOpacity onPress={() => router.push("/schedule/new")} style={styles.addBtn} testID="add-schedule">
          <Ionicons name="add" size={20} color="white" />
          <Text style={styles.addBtnText}>Event</Text>
        </TouchableOpacity>
      </View>

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
            {upcoming.map(e => <Row key={e.id} e={e} athletes={athletes} onPress={() => router.push({ pathname: "/schedule/new", params: { id: e.id } })} onDelete={() => remove(e)} />)}
            {past.length > 0 && <Text style={styles.sectionHead}>Past</Text>}
            {past.map(e => <Row key={e.id} e={e} athletes={athletes} onPress={() => router.push({ pathname: "/schedule/new", params: { id: e.id } })} onDelete={() => remove(e)} />)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ e, athletes, onPress, onDelete }: { e: Evt; athletes: Athlete[]; onPress: () => void; onDelete: () => void }) {
  const color = TYPE_COLOR[e.event_type] || "#64748B";
  const fmt12 = (t?: string) => {
    if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t || "";
    const [hS, m] = t.split(":");
    let h = Number(hS); const p = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
    return `${h}:${m} ${p}`;
  };
  const time = e.start_time ? (e.end_time ? `${fmt12(e.start_time)} – ${fmt12(e.end_time)}` : fmt12(e.start_time)) : "";
  const names = (e.athlete_ids || []).map(id => athletes.find(a => a.id === id)?.name).filter(Boolean).join(", ");
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.row} testID={`schedule-row-${e.id}`}>
      <View style={[styles.typeStripe, { backgroundColor: color }]} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
          {e.series_id ? <Ionicons name="repeat" size={14} color={colors.accent} /> : null}
        </View>
        <Text style={styles.rowMeta}>
          {formatDate(e.date, { withYear: true })}{time ? ` • ${time}` : ""}{e.location ? ` • ${e.location}` : ""}
        </Text>
        {names ? <Text style={styles.rowAthletes}>{names}</Text> : null}
      </View>
      <TouchableOpacity onPress={(ev) => { ev.stopPropagation?.(); onDelete(); }} hitSlop={10}>
        <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
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
