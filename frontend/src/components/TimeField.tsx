import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, TextInput } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";

type Props = {
  /** Stored value: 24-hour HH:MM string (e.g. "14:30"), or empty. */
  value: string;
  onChange: (hhmm: string) => void;
  placeholder?: string;
  testID?: string;
  clearable?: boolean;
};

/**
 * Cross-platform time picker. ALWAYS displays as 12-hour with AM/PM.
 *
 * - Storage format remains 24-hour `HH:MM` (e.g. "14:30") so existing data stays compatible.
 * - iOS/Android: opens the native time picker with `is24Hour={false}`.
 * - Web: renders an inline hour + minute + AM/PM picker (does NOT use
 *   `<input type="time">` because that follows the browser locale and can
 *   appear as 24-hour on some systems).
 */
export default function TimeField({
  value,
  onChange,
  placeholder = "--:-- --",
  testID,
  clearable = true,
}: Props) {
  const [open, setOpen] = useState(false);

  // ----- Web: custom 12-hour picker -----
  if (Platform.OS === "web") {
    return <TwelveHourWebPicker value={value} onChange={onChange} testID={testID} clearable={clearable} placeholder={placeholder} />;
  }

  // ----- Native: existing native time picker -----
  const display = formatDisplay(value);
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

/**
 * Web-only 12-hour picker: hour (1-12) + minute (00-59) + AM/PM toggle.
 */
function TwelveHourWebPicker({
  value, onChange, testID, clearable, placeholder,
}: {
  value: string; onChange: (v: string) => void; testID?: string; clearable: boolean; placeholder: string;
}) {
  // Parse the stored 24-hour value into 12-hour components.
  const parsed = useMemo(() => parse12(value), [value]);
  const [hour, setHour] = useState<string>(parsed.hour);
  const [minute, setMinute] = useState<string>(parsed.minute);
  const [period, setPeriod] = useState<"AM" | "PM">(parsed.period);

  // Keep local state in sync when the stored value changes externally.
  React.useEffect(() => {
    const p = parse12(value);
    setHour(p.hour); setMinute(p.minute); setPeriod(p.period);
  }, [value]);

  const commit = (h: string, m: string, per: "AM" | "PM") => {
    // Both fields must be filled to commit a value.
    const hh = Number(h);
    const mm = Number(m);
    if (!h || !m || Number.isNaN(hh) || Number.isNaN(mm) || hh < 1 || hh > 12 || mm < 0 || mm > 59) {
      // partial input — don't commit yet
      return;
    }
    let h24 = hh % 12;
    if (per === "PM") h24 += 12;
    onChange(`${pad(h24)}:${pad(mm)}`);
  };

  const onHourBlur = () => {
    let h = hour.replace(/\D/g, "");
    if (h === "") return;
    let n = Math.min(12, Math.max(1, Number(h)));
    h = String(n);
    setHour(h);
    commit(h, minute || "00", period);
  };
  const onMinuteBlur = () => {
    let m = minute.replace(/\D/g, "");
    if (m === "") return;
    let n = Math.min(59, Math.max(0, Number(m)));
    m = pad(n);
    setMinute(m);
    commit(hour || "12", m, period);
  };
  const togglePeriod = () => {
    const next = period === "AM" ? "PM" : "AM";
    setPeriod(next);
    if (hour && minute) commit(hour, minute, next);
  };
  const clear = () => {
    setHour(""); setMinute(""); setPeriod("AM");
    onChange("");
  };

  return (
    <View style={styles.webRow} testID={testID}>
      <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
      <TextInput
        value={hour}
        onChangeText={(t) => setHour(t.replace(/\D/g, "").slice(0, 2))}
        onBlur={onHourBlur}
        keyboardType="number-pad"
        maxLength={2}
        placeholder="--"
        placeholderTextColor={colors.textTertiary}
        style={styles.webNum}
        testID={testID ? `${testID}-hour` : undefined}
      />
      <Text style={styles.webColon}>:</Text>
      <TextInput
        value={minute}
        onChangeText={(t) => setMinute(t.replace(/\D/g, "").slice(0, 2))}
        onBlur={onMinuteBlur}
        keyboardType="number-pad"
        maxLength={2}
        placeholder="--"
        placeholderTextColor={colors.textTertiary}
        style={styles.webNum}
        testID={testID ? `${testID}-minute` : undefined}
      />
      <Pressable
        onPress={togglePeriod}
        style={styles.periodBtn}
        testID={testID ? `${testID}-period` : undefined}
      >
        <Text style={styles.periodText}>{period}</Text>
      </Pressable>
      {clearable && !!value && (
        <Pressable onPress={clear} hitSlop={10}>
          <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
        </Pressable>
      )}
      {!value && <Text style={styles.webPlaceholder}>{placeholder}</Text>}
    </View>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parse12(v: string): { hour: string; minute: string; period: "AM" | "PM" } {
  if (!v || !/^\d{1,2}:\d{2}$/.test(v)) {
    return { hour: "", minute: "", period: "AM" };
  }
  const [hStr, m] = v.split(":");
  let h = Number(hStr);
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { hour: String(h), minute: pad(Number(m)), period };
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
  webRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 46,
  },
  webNum: {
    fontSize: 15,
    color: colors.textPrimary,
    minWidth: 28,
    width: 32,
    textAlign: "center",
    paddingVertical: 2,
  },
  webColon: { color: colors.textSecondary, fontSize: 16, fontWeight: "700" },
  periodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.accentSubtle,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  periodText: { color: colors.accent, fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },
  webPlaceholder: { color: colors.textTertiary, fontSize: 14, marginLeft: 6 },
});
