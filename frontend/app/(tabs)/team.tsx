import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import HomeButton from "@/src/components/HomeButton";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";

type Tool = {
  key: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string; // set = live; unset = coming soon
};

const TOOLS: Tool[] = [
  { key: "roster", title: "Roster", desc: "Team members & contact info in one place.", icon: "people-outline", route: "/team/roster" },
  { key: "payments", title: "Payment Tracking", desc: "Team bonding, gifts, meals & dues — track who's paid.", icon: "cash-outline", route: "/team/payments" },
  { key: "sizes", title: "Sizes", desc: "Uniform, apparel & shoe sizes for each member.", icon: "shirt-outline", route: "/team/sizes" },
  { key: "paperwork", title: "Paperwork / Other", desc: "Waivers, forms & any other check-off items.", icon: "document-text-outline", route: "/team/paperwork" },
  { key: "signup", title: "Sign-Up Sheet", desc: "Let parents sign up to volunteer or bring items for events.", icon: "hand-left-outline", route: "/team/signups" },
  { key: "todos", title: "To-Do List", desc: "A shared checklist for your team's tasks.", icon: "checkbox-outline", route: "/team/todos" },
  { key: "export", title: "Custom Roster Export", desc: "Pick columns (sizes, paperwork, payments) into one downloadable view for a competition.", icon: "download-outline", route: "/team/export" },
];

/**
 * Team Hub — a private workspace for coaches, team reps/managers & staff.
 * Phase C: Roster is live; Gifts & Meals and Waivers arrive next.
 */
export default function TeamScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const unlocked = !!user?.team_access;

  // Access is per-login: only members who marked themselves as team personnel
  // (Settings → team access) can open the Hub, even in a shared household.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try { await refreshUser(); } finally { if (active) setLoading(false); }
      })();
      return () => { active = false; };
    }, [refreshUser])
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle}>Team Hub</Text>
          <Text style={styles.headerSub} numberOfLines={1}>For coaches, reps & staff</Text>
        </View>
        <HomeButton />
      </View>

      {loading ? (
        <View style={styles.center} testID="team-screen"><ActivityIndicator color={colors.accent} /></View>
      ) : !unlocked ? (
        <ScrollView contentContainerStyle={styles.content} testID="team-screen">
          <View style={styles.lockedCard}>
            <View style={styles.lockedIcon}>
              <Ionicons name="lock-closed-outline" size={26} color={colors.accent} />
            </View>
            <Text style={styles.lockedTitle}>Team Hub is for team personnel</Text>
            <Text style={styles.lockedText}>
              These tools are private to coaches, team reps &amp; staff. The account owner grants Team Hub access — from Settings → Team Hub Access. If you&apos;re the owner, open it to enable access for yourself or invite your staff.
            </Text>
            <TouchableOpacity style={styles.lockedBtn} onPress={() => router.push("/team-access" as any)} testID="team-add-staff">
              <Ionicons name="settings-outline" size={18} color="white" />
              <Text style={styles.lockedBtnText}>Manage access</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} testID="team-screen">
          <View style={styles.introCard}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <Text style={styles.introText}>
              A private space for you as team personnel. Access is granted by the account owner — manage who can open the Hub in Settings → Team Hub Access.
            </Text>
          </View>

          {TOOLS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={styles.toolCard}
              testID={`team-tool-${t.key}`}
              activeOpacity={t.route ? 0.7 : 1}
              disabled={!t.route}
              onPress={() => t.route && router.push(t.route as any)}
            >
              <View style={styles.toolIcon}>
                <Ionicons name={t.icon} size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.toolTitleRow}>
                  <Text style={styles.toolTitle}>{t.title}</Text>
                  {!t.route && (
                    <View style={styles.soonBadge}>
                      <Text style={styles.soonText}>COMING SOON</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.toolDesc}>{t.desc}</Text>
              </View>
              {t.route && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  headerBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  headerTitle: { ...typography.h1, color: c.textPrimary },
  headerSub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  introCard: {
    flexDirection: "row", gap: spacing.md, alignItems: "flex-start",
    backgroundColor: c.accentSubtle, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: c.accent + "33",
  },
  introText: { ...typography.caption, color: c.textPrimary, flex: 1, lineHeight: 18 },
  toolCard: {
    flexDirection: "row", gap: spacing.md, alignItems: "center",
    backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: c.border,
  },
  toolIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center" },
  toolTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  toolTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  soonBadge: { backgroundColor: c.divider, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  soonText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5, color: c.textSecondary },
  toolDesc: { ...typography.caption, color: c.textSecondary, marginTop: 3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  lockedCard: { alignItems: "center", backgroundColor: c.card, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: spacing.xl, gap: spacing.sm, marginTop: spacing.md },
  lockedIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  lockedTitle: { ...typography.h3, color: c.textPrimary, textAlign: "center" },
  lockedText: { ...typography.caption, color: c.textSecondary, textAlign: "center", lineHeight: 19 },
  lockedBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18, marginTop: spacing.md },
  lockedBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
});
