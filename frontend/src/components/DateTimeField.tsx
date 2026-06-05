import React from "react";
import { StyleSheet, View, Text } from "react-native";

import { spacing, typography, colors } from "@/src/theme";
import DateField from "@/src/components/DateField";
import TimeField from "@/src/components/TimeField";
import { combineDateTime, splitDateTime } from "@/src/utils/format";

type Props = {
  /**
   * Stored value: `YYYY-MM-DD HH:mm` (ISO date + 24h time). Empty when unset.
   * Legacy `MM-DD-YYYY HH:mm` / `DD-MM-YYYY HH:mm` strings are accepted and parsed.
   */
  value: string;
  onChange: (combined: string) => void;
  testID?: string;
  /** Optional inline labels next to each picker; falls back to "Date" / "Time". */
  dateLabel?: string;
  timeLabel?: string;
};

/**
 * Combined date + time picker. Outputs `YYYY-MM-DD HH:mm` (or just one if only one is set).
 */
export default function DateTimeField({ value, onChange, testID, dateLabel = "Date", timeLabel = "Time" }: Props) {
  const { isoDate, hhmm } = splitDateTime(value);

  return (
    <View style={styles.row} testID={testID}>
      <View style={{ flex: 1.2 }}>
        <Text style={styles.sub}>{dateLabel}</Text>
        <DateField value={isoDate} onChange={(iso) => onChange(combineDateTime(iso, hhmm))} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sub}>{timeLabel}</Text>
        <TimeField value={hhmm} onChange={(t) => onChange(combineDateTime(isoDate, t))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  sub: { ...typography.caption, color: colors.textTertiary, marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
});
