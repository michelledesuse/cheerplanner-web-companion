import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import TeamAvatar from "@/src/components/TeamAvatar";

export type FilterOption = {
  id: string;
  label: string;
  color?: string;
  logoImage?: string | null;
};

type Props = {
  label: string;
  options: FilterOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  testIDPrefix: string;
  allLabel?: string;
};

/**
 * A single horizontally-scrolling filter dimension: an "All" chip followed by
 * one chip per option. MULTI-select within the row — tap several chips to
 * combine them (OR within the row). The "All" chip clears the row. Combine
 * multiple rows (athlete + team + type) for AND filtering across dimensions.
 * Hidden entirely when there are no options to choose from.
 */
export default function FilterChipRow({
  label, options, selectedIds, onToggle, onClear, testIDPrefix, allLabel = "All",
}: Props) {
  const styles = useThemedStyles(makeStyles);
  if (options.length === 0) return null;
  const allOn = selectedIds.length === 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <TouchableOpacity
          onPress={onClear}
          style={[styles.chip, allOn && styles.chipOn]}
          testID={`${testIDPrefix}-all`}
        >
          <Text style={[styles.chipText, allOn && styles.chipTextOn]}>{allLabel}</Text>
        </TouchableOpacity>
        {options.map((o) => {
          const on = selectedIds.includes(o.id);
          return (
            <TouchableOpacity
              key={o.id}
              onPress={() => onToggle(o.id)}
              style={[styles.chip, on && styles.chipOn, o.color && !on ? { borderColor: o.color } : null]}
              testID={`${testIDPrefix}-${o.id}`}
            >
              {o.logoImage !== undefined ? (
                <TeamAvatar logoImage={o.logoImage} color={o.color || colors.accent} size={16} />
              ) : o.color ? (
                <View style={[styles.dot, { backgroundColor: o.color }]} />
              ) : null}
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{o.label}</Text>
              {on && <Ionicons name="checkmark" size={13} color="white" style={{ marginLeft: 2 }} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = () => ({
  wrap: { marginBottom: spacing.sm },
  label: { ...typography.micro, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, paddingHorizontal: spacing.lg },
  row: { gap: 6, paddingHorizontal: spacing.lg },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600", fontSize: 12, maxWidth: 130 },
  chipTextOn: { color: "white" },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
