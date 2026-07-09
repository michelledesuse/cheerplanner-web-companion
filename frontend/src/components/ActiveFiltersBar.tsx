import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type Props = {
  count: number;
  onClear: () => void;
  testIDPrefix?: string;
};

/**
 * A compact summary strip shown when one or more stacked filters are active.
 * Displays "<N> filter(s) applied" and a "Clear all" pill that resets them in
 * one tap. Renders nothing when no filters are applied.
 */
export default function ActiveFiltersBar({ count, onClear, testIDPrefix = "filters" }: Props) {
  const styles = useThemedStyles(makeStyles);
  if (count <= 0) return null;

  return (
    <View style={styles.wrap} testID={`${testIDPrefix}-active-bar`}>
      <View style={styles.left}>
        <Ionicons name="funnel" size={13} color={colors.accent} />
        <Text style={styles.count}>{count} filter{count === 1 ? "" : "s"} applied</Text>
      </View>
      <TouchableOpacity onPress={onClear} style={styles.clearBtn} testID={`${testIDPrefix}-clear-all`} hitSlop={8}>
        <Ionicons name="close-circle" size={14} color={colors.accent} />
        <Text style={styles.clearText}>Clear all</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = () => ({
  wrap: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: colors.accentSubtle, borderRadius: 999,
    borderWidth: 1, borderColor: colors.accent,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { ...typography.caption, color: colors.accent, fontWeight: "700" },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  clearText: { ...typography.caption, color: colors.accent, fontWeight: "800" },
});
