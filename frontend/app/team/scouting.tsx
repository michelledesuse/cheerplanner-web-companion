import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Ath = { roster_id: string; name: string; first_name: string };

export default function ScoutingLanding() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"coach" | "viewer">("viewer");
  const [athletes, setAthletes] = useState<Ath[]>([]);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ role: "coach" | "viewer"; athletes: Ath[]; pending_requests: number }>("/team/scouting/overview");
      setRole(r.data.role); setAthletes(r.data.athletes || []); setPending(r.data.pending_requests || 0);
    } catch (_e) { setAthletes([]); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isCoach = role === "coach";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="scouting-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>🎀 Scouting Reports</Text>
          <Text style={styles.subtitle}>{isCoach ? "Tumbling · Stunting · Jumps" : "Your athlete's skill progress"}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {isCoach && (
            <>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push("/team/scouting-requests" as any)} testID="scouting-requests-btn">
                <View style={styles.actionIcon}><Ionicons name="notifications-outline" size={20} color={colors.accent} /></View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitle}>
                    <Text style={styles.actionTitle}>Review requests</Text>
                    {pending > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{pending}</Text></View>}
                  </View>
                  <Text style={styles.actionDesc}>{pending > 0 ? `${pending} athlete${pending === 1 ? "" : "s"} asked for a skill review` : "No pending review requests"}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push("/team/scouting-skills" as any)} testID="scouting-skills-btn">
                <View style={styles.actionIcon}><Ionicons name="construct-outline" size={20} color={colors.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Skill Library</Text>
                  <Text style={styles.actionDesc}>Add & organize the skills your team is assessed on</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.sectionHead}>{isCoach ? "ATHLETES" : "REPORTS"}</Text>
          {athletes.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="ribbon-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                {isCoach ? "No athletes on your roster yet. Add athletes in the Roster tool." : "No scouting report is available for you yet. Your coach sets these up."}
              </Text>
            </View>
          ) : (
            athletes.map((a) => (
              <TouchableOpacity
                key={a.roster_id}
                style={styles.athRow}
                onPress={() => router.push({ pathname: "/team/scouting-report", params: { roster_id: a.roster_id, name: a.name } } as any)}
                testID={`scouting-athlete-${a.roster_id}`}
              >
                <View style={styles.avatar}><Text style={styles.avatarText}>{(a.first_name || a.name || "?")[0]}</Text></View>
                <Text style={styles.athName}>{a.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))
          )}
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
  actionCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  actionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center" },
  rowTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  actionDesc: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  sectionHead: { ...typography.caption, fontWeight: "800", color: c.textTertiary, letterSpacing: 0.5, marginTop: spacing.sm, marginLeft: 4 },
  athRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center" },
  avatarText: { color: c.accent, fontWeight: "800", fontSize: 16 },
  athName: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary, flex: 1 },
  empty: { alignItems: "center", gap: 10, padding: spacing.xl },
  emptyText: { ...typography.body, color: c.textSecondary, textAlign: "center" as const, lineHeight: 20 },
});
