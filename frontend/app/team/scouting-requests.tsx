import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { catLabel } from "@/src/utils/scouting";

type Req = { id: string; roster_id: string; athlete_name: string; skill_name: string; category: string; requested_by_name: string; note?: string; created_at: string };

export default function ScoutingRequests() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ requests: Req[] }>("/team/scouting/review-requests");
      setReqs(r.data.requests || []);
    } catch (_e) { setReqs([]); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const dismiss = async (id: string) => {
    setReqs((prev) => prev.filter((r) => r.id !== id));
    try { await api.post(`/team/scouting/review-requests/${id}/dismiss`, {}); } catch (_e) { load(); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="scouting-requests-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Review requests</Text>
          <Text style={styles.subtitle}>Athletes & parents asking for a skill review</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : reqs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-done-circle-outline" size={30} color={colors.textTertiary} />
          <Text style={styles.emptyText}>You're all caught up — no pending review requests.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {reqs.map((r) => (
            <View key={r.id} style={styles.card} testID={`review-req-${r.id}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.athlete}>{r.athlete_name}</Text>
                <Text style={styles.skill}>{catLabel(r.category)} · {r.skill_name}</Text>
                <Text style={styles.by}>Requested by {r.requested_by_name}</Text>
                {!!r.note && <Text style={styles.note}>“{r.note}”</Text>}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.reviewBtn} onPress={() => router.push({ pathname: "/team/scouting-report", params: { roster_id: r.roster_id, name: r.athlete_name } } as any)} testID={`review-open-${r.id}`}>
                    <Ionicons name="create-outline" size={16} color="#fff" />
                    <Text style={styles.reviewText}>Review &amp; update</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dismissBtn} onPress={() => dismiss(r.id)} testID={`review-dismiss-${r.id}`}>
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { ...typography.h3, color: c.textPrimary },
  subtitle: { ...typography.caption, color: c.textSecondary },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  card: { flexDirection: "row", backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  athlete: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  skill: { ...typography.body, color: c.accent, fontWeight: "700", marginTop: 2 },
  by: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  note: { ...typography.caption, color: c.textPrimary, fontStyle: "italic", marginTop: 6 },
  actions: { flexDirection: "row", gap: 10, marginTop: spacing.sm },
  reviewBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 14 },
  reviewText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  dismissBtn: { justifyContent: "center", paddingHorizontal: 12 },
  dismissText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  empty: { alignItems: "center", gap: 10, padding: spacing.xl },
  emptyText: { ...typography.body, color: c.textSecondary, textAlign: "center" as const },
});
