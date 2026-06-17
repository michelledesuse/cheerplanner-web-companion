import React, { useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { isoToInput } from "@/src/utils/format";

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
 * Cross-platform date field. ALWAYS displays as MM-DD-YYYY.
 *
 * - Storage stays ISO YYYY-MM-DD for sortability.
 * - Web: opens the browser's native HTML5 date picker (a real calendar) on
 *   tap. The visible label is always rendered in MM-DD-YYYY regardless of
 *   the browser's locale.
 * - Native: opens @react-native-community/datetimepicker (inline on iOS).
 */
export default function DateField({ value, onChange, placeholder = "MM-DD-YYYY", testID, clearable = true }: Props) {
  const display = isoToInput(value); // MM-DD-YYYY
  const [open, setOpen] = useState(false);
  const webInputRef = useRef<any>(null);

  if (Platform.OS === "web") {
    const openPicker = () => {
      const inp = webInputRef.current;
      if (!inp) return;
      // Modern browsers (Chrome 99+, Safari 16.4+, Firefox 101+) support
      // showPicker(); fall back to click() for older browsers.
      if (typeof inp.showPicker === "function") {
        try { inp.showPicker(); return; } catch (_) { /* fall through */ }
      }
      inp.click();
    };

    return (
      <Pressable
        style={styles.field}
        onPress={openPicker}
        testID={testID}
        accessibilityLabel="Pick date"
      >
        <Text style={[styles.fieldText, !display && styles.fieldPlaceholder]}>
          {display || placeholder}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {clearable && !!value && (
            <Pressable onPress={() => onChange("")} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        </View>
        {/* Hidden native HTML5 date input — provides the calendar UI but is
            visually invisible so the MM-DD-YYYY label above is always shown. */}
        {React.createElement("input" as any, {
          ref: webInputRef,
          type: "date",
          value: value || "",
          onChange: (e: any) => onChange(e.target.value || ""),
          style: hiddenWebInputStyle,
          "aria-hidden": true,
          tabIndex: -1,
        })}
      </Pressable>
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
    position: Platform.OS === "web" ? ("relative" as any) : undefined,
  },
  fieldText: { ...typography.body, color: colors.textPrimary, fontSize: 15 },
  fieldPlaceholder: { color: colors.textTertiary },
});

// Visually-hidden but still focusable/clickable enough to support showPicker().
const hiddenWebInputStyle: any = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  opacity: 0,
  pointerEvents: "none",
  border: 0,
  padding: 0,
  margin: 0,
  background: "transparent",
};
