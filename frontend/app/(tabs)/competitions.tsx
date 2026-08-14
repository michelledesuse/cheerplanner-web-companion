import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";

import { api } from "@/src/api/client";
import { useSeason } from "@/src/context/SeasonContext";
import SeasonBar from "@/src/components/SeasonBar";
import SeasonReadOnlyBanner from "@/src/components/SeasonReadOnlyBanner";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatDateLong, daysBetween } from "@/src/utils/format";
import MapLink from "@/src/components/MapLink";
import FilterChipRow from "@/src/components/FilterChipRow";
import ActiveFiltersBar from "@/src/components/ActiveFiltersBar";
import { toggleId } from "@/src/utils/filters";
import HomeButton from "@/src/components/HomeButton";

type Competition = {
  id: string;
  name: string;
  location?: string | null;
  event_date: string;
  housing_required: boolean;
  booking_link?: string | null;
  booking_release_at?: string | null;
  team_ids?: string[];
};
type Athlete = { id: string; name: string; avatar_color?: string; competition_ids?: string[] };
type Team = { id: string; name: string; color?: string; logo_image?: string | null };

export default function CompetitionsScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [items, setItems] = useState<Competition[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [athleteFilter, setAthleteFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Multi-select
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
      const res = await api.get<Competition[]>("/competitions", filterSeasonId ? { params: { season_id: filterSeasonId } } : undefined);
      setItems(res.data);
      try {
        const [a, t] = await Promise.all([api.get<Athlete[]>("/athletes"), api.get<Team[]>("/teams")]);
        setAthletes(a.data); setTeams(t.data);
      } catch (_) { /* filters optional */ }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterSeasonId]);

  useFocusEffect(useCallback(() => {
    load();
    return () => { setSelectMode(false); setSelectedIds(new Set()); };
  }, [load]));
  useRealtimeRefetch(load);

  const matches = useCallback((c: Competition) => {
    if (teamFilter.length > 0 && !(c.team_ids || []).some((t) => teamFilter.includes(t))) return false;
    if (athleteFilter.length > 0) {
      const ok = athletes.some((a) => athleteFilter.includes(a.id) && (a.competition_ids || []).includes(c.id));
      if (!ok) return false;
    }
    return true;
  }, [teamFilter, athleteFilter, athletes]);

  const upcoming = useMemo(() => items.filter((c) => {
    const d = daysBetween(c.event_date);
    return (d === null || d >= 0) && matches(c);
  }), [items, matches]);
  const past = useMemo(() => items.filter((c) => {
    const d = daysBetween(c.event_date);
    return d !== null && d < 0 && matches(c);
  }), [items, matches]);

  const visibleIds = useMemo(() => items.map((c) => c.id), [items]);
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
    Alert.alert(
      `Delete ${ids.length} competition${ids.length === 1 ? "" : "s"}?`,
      "Bookings and travel attached to these will also be removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.post("/bulk-delete", { resource: "competitions", ids });
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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        {selectMode ? (
          <View style={styles.selectBar}>
            <TouchableOpacity onPress={exitSelectMode} testID="comp-select-cancel" hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.selectBarText}>{selectedIds.size} selected</Text>
            <TouchableOpacity onPress={toggleSelectAll} hitSlop={6} testID="comp-select-all">
              <Text style={{ color: colors.accent, fontWeight: "700" }}>{allSelected ? "Clear" : "Select all"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={bulkDelete}
              disabled={selectedIds.size === 0}
              style={[styles.deleteBtn, { opacity: selectedIds.size === 0 ? 0.4 : 1 }]}
              testID="comp-bulk-delete"
            >
              <Ionicons name="trash" size={18} color={colors.danger} />
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerStack}>
            <Text style={styles.title}>Competitions</Text>
            <View style={styles.headerActions}>
              <HomeButton />
              {items.length > 0 && (
                <TouchableOpacity onPress={enterSelectMode} style={styles.selectBtn} testID="comp-enter-select">
                  <Ionicons name="checkmark-done" size={16} color={colors.accent} />
                  <Text style={styles.selectBtnText}>Select</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => router.push("/competitions/new")}
                testID="add-competition-btn"
              >
                <Ionicons name="add" size={20} color="white" />
                <Text style={styles.addBtnText}>Competition</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {!selectMode && (
        <View style={{ paddingLeft: spacing.lg, paddingVertical: 6 }}>
          <SeasonBar />
            <SeasonReadOnlyBanner />
        </View>
      )}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      ) : items.length === 0 ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={styles.emptyCard}>
            <Image
              source={{ uri: "https://images.pexels.com/photos/10183989/pexels-photo-10183989.jpeg" }}
              style={styles.emptyImage}
            />
            <Text style={styles.emptyTitle}>No competitions yet</Text>
            <Text style={styles.emptyText}>Add your season's competitions to track dates, housing & travel.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/competitions/new")} testID="add-first-competition-btn">
              <Text style={styles.primaryBtnText}>Add competition</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="competitions-list"
        >
          {!selectMode && (
            <View style={{ marginBottom: spacing.sm, marginHorizontal: -spacing.lg }}>
              {athletes.length > 0 && (
                <FilterChipRow
                  label="Athlete"
                  testIDPrefix="comp-filter-athlete"
                  selectedIds={athleteFilter}
                  onToggle={(id) => setAthleteFilter((p) => toggleId(p, id))}
                  onClear={() => setAthleteFilter([])}
                  options={athletes.map((a) => ({ id: a.id, label: a.name, color: a.avatar_color }))}
                />
              )}
              {teams.length > 0 && (
                <FilterChipRow
                  label="Team"
                  testIDPrefix="comp-filter-team"
                  selectedIds={teamFilter}
                  onToggle={(id) => setTeamFilter((p) => toggleId(p, id))}
                  onClear={() => setTeamFilter([])}
                  options={teams.map((t) => ({ id: t.id, label: t.name, color: t.color, logoImage: t.logo_image ?? null }))}
                />
              )}
              <ActiveFiltersBar
                testIDPrefix="comp-filters"
                count={athleteFilter.length + teamFilter.length}
                onClear={() => { setAthleteFilter([]); setTeamFilter([]); }}
              />
            </View>
          )}
          {upcoming.length > 0 && <Text style={styles.sectionHead}>Upcoming</Text>}
          {upcoming.map((c) => (
            <CompCard
              key={c.id}
              comp={c}
              selectMode={selectMode}
              selected={selectedIds.has(c.id)}
              onPress={() => {
                if (selectMode) { toggleSelected(c.id); return; }
                router.push(`/competitions/${c.id}`);
              }}
              onLongPress={() => { setSelectMode(true); toggleSelected(c.id); }}
            />
          ))}

          {past.length > 0 && <Text style={[styles.sectionHead, { marginTop: spacing.xl }]}>Past</Text>}
          {past.map((c) => (
            <CompCard
              key={c.id}
              comp={c}
              faded
              selectMode={selectMode}
              selected={selectedIds.has(c.id)}
              onPress={() => {
                if (selectMode) { toggleSelected(c.id); return; }
                router.push(`/competitions/${c.id}`);
              }}
              onLongPress={() => { setSelectMode(true); toggleSelected(c.id); }}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function CompCard({ comp, onPress, onLongPress, faded, selectMode, selected }: {
  comp: Competition; onPress: () => void; onLongPress?: () => void; faded?: boolean; selectMode?: boolean; selected?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const days = daysBetween(comp.event_date);
  const releaseDays = daysBetween(comp.booking_release_at);
  const isReleased = releaseDays === null || releaseDays <= 0;
  return (
    <TouchableOpacity
      style={[styles.card, faded && { opacity: 0.6 }, selected && { borderColor: colors.accent, backgroundColor: colors.accentSubtle }]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.85}
      testID={`competition-card-${comp.id}`}
    >
      {selectMode && (
        <View style={[styles.checkBox, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
          {selected && <Ionicons name="checkmark" size={14} color="white" />}
        </View>
      )}
      <View style={styles.cardLeft}>
        <Text style={styles.cardName} numberOfLines={1}>{comp.name}</Text>
        <View style={styles.cardMetaRow}>
          <MapLink
            address={comp.location}
            placeholder="Location TBD"
            color={colors.textSecondary}
            numberOfLines={1}
            testID={`comp-card-map-${comp.id}`}
          />
        </View>
        <View style={styles.cardMetaRow}>
          <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.cardMeta}>{formatDateLong(comp.event_date)}</Text>
        </View>
        <View style={styles.badgeRow}>
          {comp.housing_required && (
            <View style={[styles.badge, { backgroundColor: colors.accentSubtle }]}>
              <Text style={[styles.badgeText, { color: colors.accent }]}>Housing required</Text>
            </View>
          )}
          {comp.booking_release_at && !isReleased && releaseDays !== null && (
            <View style={[styles.badge, { backgroundColor: colors.warningBg }]}>
              <Text style={[styles.badgeText, { color: colors.warningText }]}>Booking opens in {releaseDays}d</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.dayPill}>
        <Text style={styles.dayPillNum}>{days !== null && days >= 0 ? days : "—"}</Text>
        <Text style={styles.dayPillLabel}>days</Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { padding: spacing.lg },
  headerStack: { gap: spacing.md },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { ...typography.display, color: c.textPrimary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: c.accent, borderRadius: 999 },
  addBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  selectBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.accentSubtle, borderRadius: 999, borderWidth: 1, borderColor: c.accent },
  selectBtnText: { color: c.accent, fontWeight: "700", fontSize: 13 },
  selectBar: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  selectBarText: { ...typography.bodyMedium, color: c.textPrimary, flex: 1 },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleteBtnText: { color: c.danger, fontWeight: "700" },
  checkBox: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center", marginRight: spacing.md },
  emptyCard: { backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: c.border },
  emptyImage: { width: "100%", height: 160, borderRadius: radius.lg, marginBottom: spacing.lg },
  emptyTitle: { ...typography.h2, color: c.textPrimary, marginBottom: 6 },
  emptyText: { ...typography.body, color: c.textSecondary, textAlign: "center", marginBottom: spacing.lg },
  primaryBtn: { backgroundColor: c.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  primaryBtnText: { color: "white", fontWeight: "700" },
  sectionHead: { ...typography.micro, color: c.textTertiary, marginBottom: spacing.md, marginTop: spacing.xs },
  card: { flexDirection: "row", backgroundColor: c.card, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.md, alignItems: "center" },
  cardLeft: { flex: 1, gap: 4 },
  cardName: { ...typography.h3, color: c.textPrimary },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardMeta: { ...typography.caption, color: c.textSecondary, flex: 1 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  dayPill: { alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.accentSubtle, marginLeft: spacing.md },
  dayPillNum: { ...typography.h2, color: c.textPrimary },
  dayPillLabel: { ...typography.micro, color: c.textSecondary, marginTop: -2 },
});
