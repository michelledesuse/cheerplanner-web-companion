import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";

type Props = {
  /** Stored value: 24-hour HH:MM string, or empty. */
  value: string;
  onChange: (hhmm: string) => void;
  placeholder?: string;
  testID?: string;
  clearable?: boolean;
};

/**
 * Cross-platform time picker storing 24-hour HH:MM strings.
 * Displays a friendly 12-hour label (e.g. "7:30 PM") on native.
 */
export default function TimeField({
  value,
  onChange,
  placeholder = "--:--",
  testID,
  clearable = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const display = formatDisplay(value);

  if (Platform.OS === "web") {
    return (
      <View style={styles.wrap} testID={testID}>
        {React.createElement("input" as any, {
          type: "time",
          value: value || "",
          onChange: (e: any) => onChange(e.target.value || ""),
          style: webInputStyle,
          placeholder,
        })}
      </View>
    );
  }

  const handle = (event: DateTimePickerEvent, d?: Date) => {
    setOpen(false);
    if (event.type === "set" && d) {
      onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
  };

  const initial = (() => {
    if (value && /^\d{1,2}:\d{2}$/.test(value)) {
      const [h, m] = value.split(":").map(Number);
      const d = new Date();
      d.setHours(h || 0, m || 0, 0, 0);
      return d;
    }
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  })();

  return (
    <View>
      <Pressable style={styles.field} onPress={() => setOpen(true)} testID={testID}>
        <Text style={[styles.fieldText, !display && styles.fieldPlaceholder]}>
          {display || placeholder}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {clearable && !!display && (
            <Pressable onPress={() => onChange("")} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
          <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
        </View>
      </Pressable>
      {open && (
        <DateTimePicker
          value={initial}
          mode="time"
          is24Hour={false}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handle}
        />
      )}
    </View>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDisplay(v: string): string {
  if (!v || !/^\d{1,2}:\d{2}$/.test(v)) return "";
  const [hStr, m] = v.split(":");
  let h = Number(hStr);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

const styles = StyleSheet.create({
  wrap: {},
  field: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldText: { ...typography.body, color: colors.textPrimary, fontSize: 15 },
  fieldPlaceholder: { color: colors.textTertiary },
});

const webInputStyle: any = {
  backgroundColor: colors.card,
  borderRadius: radius.md,
  paddingTop: 12,
  paddingBottom: 12,
  paddingLeft: 14,
  paddingRight: 14,
  fontSize: 15,
  color: colors.textPrimary,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  outlineStyle: "none",
  border: `1px solid ${colors.border}`,
};
