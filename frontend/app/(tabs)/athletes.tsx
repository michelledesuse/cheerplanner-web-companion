import React, { useCallback, useState } from "react";
import {
  View,
  Text,
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
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatCurrency } from "@/src/utils/format";
import TeamAvatar from "@/src/components/TeamAvatar";

type Team = { id: string; name: string; color?: string | null; logo_image?: string | null };
type Athlete = {
  id: string;
  name: string;
  role?: "athlete" | "coach";
  team?: string | null;
  gym?: string | null;
  team_ids?: string[] | null;
  avatar_color?: string | null;
  avatar_image?: string | null;
};

export default function AthletesScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [totals, setTotals] = useState<Record<string, { spent: number; paid: number; open: number }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.get<Athlete[]>("/athletes");
      setAthletes(list.data);
      try { const tr = await api.get<Team[]>("/teams"); setTeams(tr.data); } catch (_) { /* ignore */ }
      const [exp, pay] = await Promise.all([api.get("/expenses"), api.get("/payments")]);
      const t: Record<string, { spent: number; paid: number; open: number }> = {};
      for (const a of list.data) t[a.id] = { spent: 0, paid: 0, open: 0 };
      for (const e of exp.data) {
        if (!t[e.athlete_id]) continue;
        t[e.athlete_id].spent += Number(e.amount) || 0;
        // balance_due already accounts for applied payments; falls back to amount-paid_amount
        const bd = Number(e.balance_due ?? Math.max(0, Number(e.amount) - Number(e.paid_amount || 0)));
        t[e.athlete_id].open += bd;
      }
      for (const p of pay.data) if (t[p.athlete_id]) t[p.athlete_id].paid += Number(p.amount) || 0;
      setTotals(t);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Athletes</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/athletes/new")}
          testID="add-athlete-btn"
        >
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      ) : athletes.length === 0 ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={styles.emptyCard}>
            <Image
              source={{ uri: "https://images.pexels.com/photos/7322809/pexels-photo-7322809.jpeg" }}
              style={styles.emptyImage}
            />
            <Text style={styles.emptyTitle}>Add your first athlete</Text>
            <Text style={styles.emptyText}>Track expenses, payments and fundraisers per kid.</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/athletes/new")}
              testID="add-first-athlete"
            >
              <Text style={styles.primaryBtnText}>Add athlete</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />
          }
          testID="athletes-list"
        >
          {athletes.map((a) => {
            const t = totals[a.id] || { spent: 0, paid: 0, open: 0 };
            const open = Math.max(0, t.open);
            const athleteTeam =
              (a.team_ids || []).map((id) => teams.find((tm) => tm.id === id)).find(Boolean) ||
              (a.team ? teams.find((tm) => tm.name.toLowerCase() === String(a.team).toLowerCase()) : undefined);
            return (
              <TouchableOpacity
                key={a.id}
                style={styles.card}
                onPress={() => router.push(`/athletes/${a.id}`)}
                activeOpacity={0.85}
                testID={`athlete-card-${a.id}`}
              >
                <View style={[styles.avatar, { backgroundColor: a.avatar_color || colors.accent }]}>
                  {a.avatar_image ? (
                    <Image source={{ uri: a.avatar_image }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>{a.name[0]?.toUpperCase() || "?"}</Text>
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.name}>{a.name}</Text>
                    {a.role === "coach" && (
                      <View style={styles.coachBadge}>
                        <Ionicons name="megaphone-outline" size={10} color={colors.accent} />
                        <Text style={styles.coachBadgeText}>COACH</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                    {athleteTeam ? <TeamAvatar logoImage={athleteTeam.logo_image} color={athleteTeam.color} size={16} /> : null}
                    <Text style={styles.meta}>{athleteTeam?.name || a.team || a.gym || (a.role === "coach" ? "Coach" : "Cheer athlete")}</Text>
                  </View>
                  <View style={styles.statsRow}>
                    <Text style={styles.stat}>Spent <Text style={styles.statValue}>{formatCurrency(t.spent)}</Text></Text>
                    <Text style={styles.stat}>Paid <Text style={[styles.statValue, { color: colors.successText }]}>{formatCurrency(t.paid)}</Text></Text>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.balanceLabel}>Open</Text>
                  <Text style={[styles.balanceValue, { color: open > 0 ? colors.textPrimary : colors.successText }]}>
                    {formatCurrency(open)}
                  </Text>
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  title: { ...typography.display, color: c.textPrimary },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  emptyCard: { backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: c.border },
  emptyImage: { width: "100%", height: 160, borderRadius: radius.lg, marginBottom: spacing.lg },
  emptyTitle: { ...typography.h2, color: c.textPrimary, marginBottom: 6 },
  emptyText: { ...typography.body, color: c.textSecondary, textAlign: "center", marginBottom: spacing.lg },
  primaryBtn: { backgroundColor: c.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  primaryBtnText: { color: "white", fontWeight: "700" },
  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: c.card,
    padding: spacing.lg, borderRadius: radius.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: c.border,
  },
  avatar: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: "white", fontSize: 20, fontWeight: "800" },
  avatarImage: { width: 52, height: 52, borderRadius: 18 },
  name: { ...typography.h3, color: c.textPrimary },
  meta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: spacing.md, marginTop: 6 },
  stat: { ...typography.caption, color: c.textSecondary },
  statValue: { color: c.textPrimary, fontWeight: "700" },
  balanceLabel: { ...typography.micro, color: c.textTertiary },
  balanceValue: { fontSize: 18, fontWeight: "800", marginTop: 2 },
  coachBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: c.accentSubtle, borderRadius: 6 },
  coachBadgeText: { color: c.accent, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
});
