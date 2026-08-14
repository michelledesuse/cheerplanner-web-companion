import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useSeason } from "@/src/context/SeasonContext";

/**
 * Persistent signal that the user is viewing a NON-active (historical) season,
 * so an archived view is never mistaken for live data. Tapping "Return to
 * current" snaps the filter back to the active season.
 */
export default function SeasonReadOnlyBanner() {
  const { seasons, filterSeasonId, activeSeason, setFilterSeasonId } = useSeason();
  if (!filterSeasonId) return null; // "All seasons" is fine
  const viewing = seasons.find((s) => s.id === filterSeasonId);
  if (!viewing || viewing.is_active) return null; // active season = live, no banner
  const isPast = !!viewing.end_date && viewing.end_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
  const tag = isPast ? "past season" : "inactive season";

  return (
    <View style={styles.wrap} testID="season-readonly-banner">
      <Ionicons name="time-outline" size={16} color={colors.warningText} />
      <Text style={styles.text} numberOfLines={1}>Viewing {viewing.name} ({tag})</Text>
      <TouchableOpacity onPress={() => setFilterSeasonId(activeSeason ? activeSeason.id : null)} testID="season-return-current">
        <Text style={styles.link}>Return to current</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.warningBg, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: spacing.sm,
  },
  text: { ...typography.caption, color: colors.warningText, fontWeight: "700", flex: 1 },
  link: { ...typography.caption, color: colors.accent, fontWeight: "800" },
});
