import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { isoToInput, userDateToISO } from "@/src/utils/format";

type Props = {
  /** Stored value: ISO YYYY-MM-DD or empty string. */
  value: string;
  /** Returns new ISO YYYY-MM-DD value (or empty string when cleared). */
  onChange: (iso: string) => void;
  placeholder?: string;
  testID?: string;
  /** Allow clearing back to empty. */
  clearable?: boolean;
};

/**
 * Cross-platform date picker.
 * - Web: uses native <input type="date"> (no extra deps) for the best UX.
 * - Native: opens @react-native-community/datetimepicker on tap.
 */
export default function DateField({ value, onChange, placeholder = "MM-DD-YYYY", testID, clearable = true }: Props) {
  const display = isoToInput(value);
  const [open, setOpen] = useState(false);

  if (Platform.OS === "web") {
    // Render a real HTML date input under the hood, styled to match other inputs.
    return (
      <View style={styles.wrap} testID={testID}>
        {React.createElement("input" as any, {
          type: "date",
          value: value || "",
          onChange: (e: any) => onChange(e.target.value || ""),
          style: webInputStyle,
          placeholder,
        })}
      </View>
    );
  }

  // Native path
  const handle = (event: DateTimePickerEvent, d?: Date) => {
    setOpen(false);
    if (event.type === "set" && d) {
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      onChange(iso);
    }
  };
  const initial = value ? new Date(`${value}T00:00:00`) : new Date();

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
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        </View>
      </Pressable>
      {open && (
        <DateTimePicker
          value={initial}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={handle}
        />
      )}
    </View>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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
  borderWidth: 1,
  borderColor: colors.border,
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
  borderRadiusBottomLeft: radius.md,
};
