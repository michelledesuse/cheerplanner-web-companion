import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";

import { api } from "@/src/api/client";
import { useSeason } from "@/src/context/SeasonContext";
import SeasonBar from "@/src/components/SeasonBar";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatDate } from "@/src/utils/format";
import MapLink from "@/src/components/MapLink";
import TeamAvatar from "@/src/components/TeamAvatar";
import FilterChipRow, { type FilterOption } from "@/src/components/FilterChipRow";
import ActiveFiltersBar from "@/src/components/ActiveFiltersBar";
import HomeButton from "@/src/components/HomeButton";
import AddTypeModal from "@/src/components/AddTypeModal";
import { toggleId, passesMulti, passesMultiAny } from "@/src/utils/filters";

type Athlete = { id: string; name: string; avatar_color?: string };
type Team = { id: string; name: string; color?: string; logo_image?: string | null };
type Evt = {
  id: string; event_type: string; title: string; location?: string;
  date: string; start_time?: string; end_time?: string;
  athlete_ids?: string[]; notes?: string; team_id?: string | null;
  series_id?: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  practice: "Practice", team_bonding: "Team Bonding", private_lesson: "Private Lesson",
  choreography: "Choreography", class: "Class", fundraiser: "Fundraiser", other: "Other",
};
const TYPE_COLOR: Record<string, string> = {
  practice: "#EA580C", team_bonding: "#0EA5E9", private_lesson: "#DB2777",
  choreography: "#9333EA", class: "#0891B2", fundraiser: "#16A34A", other: "#64748B",
};

export default function ScheduleTab() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [events, setEvents] = useState<Evt[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [customTypes, setCustomTypes] = useState<{ id: string; label: string; color: string }[]>([]);
  const [addTypeOpen, setAddTypeOpen] = useState(false);

  const addType = async (name: string, color?: string) => {
    try {
      const r = await api.post("/household/custom-types/event-type", { label: name, color: color || "#64748B" });
      setCustomTypes(r.data.event_types || []);
      if (r.data.event_type) setTypeFilter((p) => [...p, r.data.event_type.id]);
      setAddTypeOpen(false);
    } catch { Alert.alert("Error", "Could not add the type."); }
  };
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [athleteFilter, setAthleteFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const enterSelectMode = () => { setSelectMode(true); setSelectedIds(new Set()); };
  const toggleSelected = (id: string) => {
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const { filterSeasonId } = useSeason();
  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.get<Evt[]>("/schedule", filterSeasonId ? { params: { season_id: filterSeasonId } } : undefined), api.get<Athlete[]>("/athletes")]);
      setEvents(s.data); setAthletes(a.data);
      try { const tr = await api.get<Team[]>("/teams"); setTeams(tr.data); } catch (_) { /* ignore */ }
      try { const ht = await api.get("/household/custom-types"); setCustomTypes(ht.data.event_types || []); } catch (_) { /* ignore */ }
    } finally { setLoading(false); setRefreshing(false); }
  }, [filterSeasonId]);

  useFocusEffect(useCallback(() => {
    load();
    return () => { setSelectMode(false); setSelectedIds(new Set()); };
  }, [load]));
  useRealtimeRefetch(load);

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

  const filtered = useMemo(() => events.filter((e) =>
    passesMulti(typeFilter, e.event_type) &&
    passesMultiAny(athleteFilter, e.athlete_ids) &&
    passesMulti(teamFilter, e.team_id)
  ), [events, typeFilter, athleteFilter, teamFilter]);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => filtered.filter((e) => e.date >= today), [filtered, today]);
  const past = useMemo(() => filtered.filter((e) => e.date < today), [filtered, today]);

  const visibleIds = useMemo(() => filtered.map((e) => e.id), [filtered]);

  // Conflict detection: two events on the same date whose start/end times
  // overlap. Flags both household-wide overlaps and (with a stronger label)
  // when the SAME athlete is double-booked.
  const conflicts = useMemo(() => {
    const map: Record<string, { title: string; athlete?: string }> = {};
    const parse = (t?: string) => {
      if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null;
      const [h, m] = t.split(":").map(Number);
      return h * 60 + (m || 0);
    };
    const byDate: Record<string, Evt[]> = {};
    events.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    Object.values(byDate).forEach((list) => {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]; const b = list[j];
          const as = parse(a.start_time); const bs = parse(b.start_time);
          if (as == null || bs == null) continue;
          const ae = parse(a.end_time) ?? as; const be = parse(b.end_time) ?? bs;
          if (as < be && bs < ae) {
            const shared = (a.athlete_ids || []).find((id) => (b.athlete_ids || []).includes(id));
            const athlete = shared ? athletes.find((x) => x.id === shared)?.name : undefined;
            if (!map[a.id]) map[a.id] = { title: b.title, athlete };
            if (!map[b.id]) map[b.id] = { title: a.title, athlete };
          }
        }
      }
    });
    return map;
  }, [events, athletes]);

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
              <Ionicons name="trash" size={18} color={colors.danger} />
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.headerTitle}>Schedule</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <HomeButton />
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
        <View style={styles.filtersContainer}>
          <FilterChipRow
            label="Type"
            testIDPrefix="sched-filter-type"
            selectedIds={typeFilter}
            onToggle={(id) => setTypeFilter((p) => toggleId(p, id))}
            onClear={() => setTypeFilter([])}
            onAdd={() => setAddTypeOpen(true)}
            addLabel="Type"
            options={[
              ...Object.entries(TYPE_LABEL).map(([k, label]) => ({ id: k, label, color: TYPE_COLOR[k] })),
              ...customTypes.map((t) => ({ id: t.id, label: t.label, color: t.color })),
            ]}
          />
          {athletes.length > 0 && (
            <FilterChipRow
              label="Athlete"
              testIDPrefix="sched-filter-athlete"
              selectedIds={athleteFilter}
              onToggle={(id) => setAthleteFilter((p) => toggleId(p, id))}
              onClear={() => setAthleteFilter([])}
              options={athletes.map((a) => ({ id: a.id, label: a.name, color: a.avatar_color }))}
            />
          )}
          {teams.length > 0 && (
            <FilterChipRow
              label="Team"
              testIDPrefix="sched-filter-team"
              selectedIds={teamFilter}
              onToggle={(id) => setTeamFilter((p) => toggleId(p, id))}
              onClear={() => setTeamFilter([])}
              options={teams.map((t) => ({ id: t.id, label: t.name, color: t.color, logoImage: t.logo_image ?? null }))}
            />
          )}
          <ActiveFiltersBar
            testIDPrefix="sched-filters"
            count={typeFilter.length + athleteFilter.length + teamFilter.length}
            onClear={() => { setTypeFilter([]); setAthleteFilter([]); setTeamFilter([]); }}
          />
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
                teams={teams}
                customTypes={customTypes}
                selectMode={selectMode}
                selected={selectedIds.has(e.id)}
                conflict={conflicts[e.id]}
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
                teams={teams}
                customTypes={customTypes}
                selectMode={selectMode}
                selected={selectedIds.has(e.id)}
                conflict={conflicts[e.id]}
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
      <AddTypeModal
        visible={addTypeOpen}
        title="Add event type"
        placeholder="e.g. Tumbling"
        withColor
        onSubmit={addType}
        onClose={() => setAddTypeOpen(false)}
      />
    </SafeAreaView>
  );
}

function Row({ e, athletes, teams, customTypes, onPress, onLongPress, onDelete, selectMode, selected, conflict }: {
  e: Evt; athletes: Athlete[]; teams: Team[]; customTypes?: { id: string; label: string; color: string }[]; onPress: () => void; onLongPress?: () => void; onDelete: () => void; selectMode?: boolean; selected?: boolean; conflict?: { title: string; athlete?: string };
}) {
  const styles = useThemedStyles(makeStyles);
  const color = TYPE_COLOR[e.event_type] || (customTypes || []).find((t) => t.id === e.event_type)?.color || "#64748B";
  const team = e.team_id ? teams.find((t) => t.id === e.team_id) : undefined;
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
        {team ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            <TeamAvatar logoImage={team.logo_image} color={team.color} size={16} />
            <Text style={styles.rowTeam} numberOfLines={1}>{team.name}</Text>
          </View>
        ) : null}
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
        {conflict ? (
          <View style={styles.conflictBadge} testID={`schedule-conflict-${e.id}`}>
            <Ionicons name="warning" size={12} color="#B45309" />
            <Text style={styles.conflictText} numberOfLines={1}>
              {conflict.athlete ? `${conflict.athlete} double-booked` : `Overlaps with ${conflict.title}`}
            </Text>
          </View>
        ) : null}
      </View>
      {!selectMode && (
        <TouchableOpacity onPress={(ev) => { ev.stopPropagation?.(); onDelete(); }} hitSlop={10}>
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: c.textPrimary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: c.accent, borderRadius: 999 },
  addBtnText: { color: "white", fontWeight: "700", fontSize: 12 },
  selectBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: c.accentSubtle, borderRadius: 999, borderWidth: 1, borderColor: c.accent },
  selectBtnText: { color: c.accent, fontWeight: "700", fontSize: 12 },
  selectBar: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  selectBarText: { ...typography.bodyMedium, color: c.textPrimary, flex: 1 },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleteBtnText: { color: c.danger, fontWeight: "700" },
  checkBox: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipDot: { width: 7, height: 7, borderRadius: 3.5 },
  chipText: { ...typography.caption, color: c.textPrimary, fontWeight: "600", fontSize: 12 },
  chipTextOn: { color: "white" },
  filterWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filtersContainer: { paddingTop: spacing.xs, paddingBottom: spacing.xs },
  sectionHead: { ...typography.caption, color: c.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, marginBottom: 8 },
  typeStripe: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  rowTitle: { ...typography.bodyMedium, color: c.textPrimary },
  rowMeta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  rowTeam: { ...typography.caption, color: c.textPrimary, fontWeight: "700", fontSize: 12 },
  rowAthletes: { ...typography.caption, color: c.accent, marginTop: 2, fontWeight: "600" },
  conflictBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, alignSelf: "flex-start", backgroundColor: "#FEF3C7", borderColor: "#FCD34D", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  conflictText: { ...typography.micro, color: "#B45309", fontWeight: "800" },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  empty: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptySub: { ...typography.body, color: c.textTertiary, textAlign: "center" },
  bigAddBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: c.accent, borderRadius: 999, marginTop: spacing.md },
  bigAddBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  bigAddBtnAlt: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: c.accentSubtle, borderRadius: 999, marginTop: 4 },
  bigAddBtnAltText: { color: c.accent, fontWeight: "700", fontSize: 13 },
});
