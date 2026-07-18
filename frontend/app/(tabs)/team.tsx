import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import HomeButton from "@/src/components/HomeButton";
import { useRouter } from "expo-router";

type Tool = {
  key: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string; // set = live; unset = coming soon
};

const TOOLS: Tool[] = [
  { key: "roster", title: "Roster", desc: "Team members & contact info in one place.", icon: "people-outline", route: "/team/roster" },
  { key: "gifts", title: "Gifts & Meals", desc: "Track who's paid the team rep for gifts, meals & shared items.", icon: "gift-outline" },
  { key: "waivers", title: "Waivers", desc: "Collect and track signed waivers for the team.", icon: "document-text-outline" },
];

/**
 * Team Hub — a private workspace for coaches, team reps/managers & staff.
 * Phase C: Roster is live; Gifts & Meals and Waivers arrive next.
 */
export default function TeamScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle}>Team Hub</Text>
          <Text style={styles.headerSub} numberOfLines={1}>For coaches, reps & staff</Text>
        </View>
        <HomeButton />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} testID="team-screen">
        <View style={styles.introCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
          <Text style={styles.introText}>
            A private space for team staff to keep everything they need handy. Parents &amp; athletes will get read-only access to shared items in a later update.
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
});
