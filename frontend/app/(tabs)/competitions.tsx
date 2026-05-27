import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatDateLong, daysBetween } from "@/src/utils/format";

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

  const load = useCallback(async () => {
    try {
      const res = await api.get<Competition[]>("/competitions");
      setItems(res.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const upcoming = items.filter((c) => {
    const d = daysBetween(c.event_date);
    return d === null || d >= 0;
  });
  const past = items.filter((c) => {
    const d = daysBetween(c.event_date);
    return d !== null && d < 0;
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Competitions</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/competitions/new")}
          testID="add-competition-btn"
        >
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
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
          {upcoming.map((c) => <CompCard key={c.id} comp={c} onPress={() => router.push(`/competitions/${c.id}`)} />)}

          {past.length > 0 && <Text style={[styles.sectionHead, { marginTop: spacing.xl }]}>Past</Text>}
          {past.map((c) => <CompCard key={c.id} comp={c} faded onPress={() => router.push(`/competitions/${c.id}`)} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function CompCard({ comp, onPress, faded }: { comp: Competition; onPress: () => void; faded?: boolean }) {
  const days = daysBetween(comp.event_date);
  const releaseDays = daysBetween(comp.booking_release_at);
  const isReleased = releaseDays === null || releaseDays <= 0;
  return (
    <TouchableOpacity
      style={[styles.card, faded && { opacity: 0.6 }]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={`competition-card-${comp.id}`}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.cardName} numberOfLines={1}>{comp.name}</Text>
        <View style={styles.cardMetaRow}>
          <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.cardMeta} numberOfLines={1}>{comp.location || "Location TBD"}</Text>
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
