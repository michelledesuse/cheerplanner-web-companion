import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Session = {
  id: string; title: string; date?: string | null;
  summary: { present: number; absent: number; excused: number; member_total: number; unmarked: number };
};

const fmtDate = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export default function AttendanceScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Session[]>("/team/attendance");
      setItems(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRealtimeRefetch(load);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="attendance-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Attendance</Text>
        <TouchableOpacity onPress={() => router.push("/team/attendance-new" as any)} style={styles.addBtn} testID="attendance-add">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="attendance-list"
        >
          {items.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="checkbox-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No attendance yet</Text>
              <Text style={styles.emptyText}>Create a session for a practice or event, then check off who&apos;s here.</Text>
            </View>
          ) : items.map((s) => {
            const { present, absent, excused, member_total } = s.summary;
            const pct = member_total > 0 ? Math.round((present / member_total) * 100) : 0;
            return (
              <TouchableOpacity key={s.id} style={styles.card} onPress={() => router.push({ pathname: "/team/attendance-session", params: { id: s.id } })} testID={`attendance-row-${s.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.cardName}>{s.title}</Text>
                  {!!fmtDate(s.date) && <Text style={styles.dateTag}>{fmtDate(s.date)}</Text>}
                </View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                <View style={styles.pillRow}>
                  <Text style={[styles.statPill, styles.presentPill]}>{present} present</Text>
                  {absent > 0 && <Text style={[styles.statPill, styles.absentPill]}>{absent} absent</Text>}
                  {excused > 0 && <Text style={[styles.statPill, styles.excusedPill]}>{excused} excused</Text>}
                  <Text style={styles.cardMeta}>of {member_total}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  card: { backgroundColor: c.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.md },
  cardName: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, flex: 1 },
  dateTag: { ...typography.caption, color: c.accent, fontWeight: "700" },
  cardMeta: { ...typography.caption, color: c.textSecondary },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: c.divider, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: c.success || c.accent },
  pillRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  statPill: { ...typography.micro, fontWeight: "800", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  presentPill: { backgroundColor: (c.success || c.accent) + "22", color: c.success || c.accent },
  absentPill: { backgroundColor: c.danger + "22", color: c.danger },
  excusedPill: { backgroundColor: c.warningText + "22", color: c.warningText },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
});
