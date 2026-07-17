import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

// Allowed lead-time offsets (minutes before the target moment).
export const SMS_OFFSETS: { value: number; label: string }[] = [
  { value: 60, label: "1 hr" },
  { value: 30, label: "30 min" },
  { value: 15, label: "15 min" },
  { value: 1, label: "1 min" },
];

type Props = {
  value: number[];
  onChange: (next: number[]) => void;
  title?: string;
  note?: string;
  testIDPrefix?: string;
};

/**
 * Multi-select chips for precise SMS lead-time reminders (S1).
 * Users pick any combination of 1 hr / 30 / 15 / 1 min before the trigger.
 */
export default function SmsReminderPicker({
  value,
  onChange,
  title = "Text me before this",
  note,
  testIDPrefix = "sms-offsets",
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const selected = new Set(value || []);

  const toggle = (v: number) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next).sort((a, b) => b - a));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.accent} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.row}>
        {SMS_OFFSETS.map((o) => {
          const on = selected.has(o.value);
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => toggle(o.value)}
              style={[styles.chip, on && styles.chipOn]}
              testID={`${testIDPrefix}-${o.value}`}
            >
              {on && <Ionicons name="checkmark" size={13} color="white" />}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label} before</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.note}>
        {note || "SMS-only. Turn on SMS reminders and add your number in Settings \u2192 Notifications."}
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => ({
  wrap: { marginTop: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  title: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
  },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  chipTextOn: { color: "white" },
  note: { ...typography.micro, color: c.textTertiary, marginTop: spacing.sm },
});
