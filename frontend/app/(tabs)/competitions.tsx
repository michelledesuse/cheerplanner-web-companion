import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
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

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatDateLong, daysBetween } from "@/src/utils/format";
import MapLink from "@/src/components/MapLink";

type Competition = {
  id: string;
  name: string;
  location?: string | null;
  event_date: string;
  housing_required: boolean;
  booking_link?: string | null;
  booking_release_at?: string | null;
};

export default function CompetitionsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Competition[]>([]);
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

  const load = useCallback(async () => {
    try {
      const res = await api.get<Competition[]>("/competitions");
      setItems(res.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    return () => { setSelectMode(false); setSelectedIds(new Set()); };
  }, [load]));

  const upcoming = useMemo(() => items.filter((c) => {
    const d = daysBetween(c.event_date);
    return d === null || d >= 0;
  }), [items]);
  const past = useMemo(() => items.filter((c) => {
    const d = daysBetween(c.event_date);
    return d !== null && d < 0;
  }), [items]);

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
              <Ionicons name="trash" size={18} color="#DC2626" />
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Competitions</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  title: { ...typography.display, color: colors.textPrimary },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  selectBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accentSubtle, borderRadius: 999, borderWidth: 1, borderColor: colors.accent },
  selectBtnText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  selectBar: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  selectBarText: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1 },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleteBtnText: { color: "#DC2626", fontWeight: "700" },
  checkBox: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginRight: spacing.md },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  emptyImage: { width: "100%", height: 160, borderRadius: radius.lg, marginBottom: spacing.lg },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: 6 },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", marginBottom: spacing.lg },
  primaryBtn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  primaryBtnText: { color: "white", fontWeight: "700" },
  sectionHead: { ...typography.micro, color: colors.textTertiary, marginBottom: spacing.md, marginTop: spacing.xs },
  card: { flexDirection: "row", backgroundColor: colors.card, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, alignItems: "center" },
  cardLeft: { flex: 1, gap: 4 },
  cardName: { ...typography.h3, color: colors.textPrimary },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardMeta: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  dayPill: { alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.accentSubtle, marginLeft: spacing.md },
  dayPillNum: { ...typography.h2, color: colors.accent },
  dayPillLabel: { ...typography.micro, color: colors.accent, marginTop: -2 },
});
