import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useSeason } from "@/src/context/SeasonContext";

/**
 * Horizontal season filter. Lets the user switch which season the app's lists
 * are filtered to ("All seasons" or a specific one) and jump to manage them.
 * Renders nothing until seasons exist (keeps the UI clean for new users, aside
 * from a subtle "Create a season" chip).
 */
export default function SeasonBar() {
  const router = useRouter();
  const { seasons, filterSeasonId, setFilterSeasonId } = useSeason();

  if (seasons.length === 0) {
    return (
      <TouchableOpacity style={styles.emptyChip} onPress={() => router.push("/seasons" as any)} testID="seasonbar-create">
        <Ionicons name="calendar-outline" size={14} color={colors.accent} />
        <Text style={styles.emptyText}>Create a season</Text>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrap}>
      <Chip label="All seasons" active={filterSeasonId === null} onPress={() => setFilterSeasonId(null)} testID="seasonbar-all" />
      {seasons.map((s) => (
        <Chip key={s.id} label={s.name} active={filterSeasonId === s.id} dot={s.is_active} onPress={() => setFilterSeasonId(s.id)} testID={`seasonbar-${s.id}`} />
      ))}
      <TouchableOpacity style={styles.manage} onPress={() => router.push("/seasons" as any)} testID="seasonbar-manage">
        <Ionicons name="settings-outline" size={16} color={colors.textSecondary} />
      </TouchableOpacity>
    </ScrollView>
  );
}

function Chip({ label, active, dot, onPress, testID }: { label: string; active: boolean; dot?: boolean; onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipOn]} onPress={onPress} testID={testID}>
      {dot ? <View style={[styles.dot, { backgroundColor: active ? "white" : colors.accent }]} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingRight: spacing.md, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, fontWeight: "700", color: colors.textSecondary, maxWidth: 160 },
  chipTextOn: { color: "white" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  manage: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  emptyChip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.accent + "44", backgroundColor: colors.accentSubtle },
  emptyText: { ...typography.caption, fontWeight: "700", color: colors.accent },
});
