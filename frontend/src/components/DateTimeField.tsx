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
 *
 * The two pickers are stacked vertically so each one gets the full container
 * width — this guarantees the TimeField's AM/PM toggle always has room to
 * render on narrow phones (320–375px wide). A side-by-side layout repeatedly
 * caused the AM/PM button to be clipped off the right edge on iPhone SE and
 * Galaxy S-series devices.
 */
export default function DateTimeField({ value, onChange, testID, dateLabel = "Date", timeLabel = "Time" }: Props) {
  const { isoDate, hhmm } = splitDateTime(value);

  return (
    <View testID={testID}>
      <Text style={styles.sub}>{dateLabel}</Text>
      <DateField value={isoDate} onChange={(iso) => onChange(combineDateTime(iso, hhmm))} />
      <Text style={[styles.sub, styles.timeLabel]}>{timeLabel}</Text>
      <TimeField value={hhmm} onChange={(t) => onChange(combineDateTime(isoDate, t))} />
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { ...typography.caption, color: colors.textTertiary, marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  timeLabel: { marginTop: spacing.sm },
});
