import React, { useState } from "react";
import { Modal, Pressable, View, Text, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Props = {
  visible: boolean;
  /** Currently selected date, ISO YYYY-MM-DD. */
  currentISO: string;
  /** Called with the new ISO date whenever the user picks a month or year. */
  onJump: (iso: string) => void;
  onClose: () => void;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, mIdx: number) => new Date(y, mIdx + 1, 0).getDate();

/**
 * A compact "Jump to" dropdown for the Calendar. Instead of scrolling month by
 * month, the user taps a Month and/or Year dropdown and the calendar jumps
 * there instantly (no "Done" tap). Rendered as a small popover under the header
 * with a translucent backdrop, so the calendar is visible & updates live.
 */
export default function DateJumpDropdown({ visible, currentISO, onJump, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [openWhich, setOpenWhich] = useState<"month" | "year" | null>(null);

  const now = new Date();
  const parsed = (currentISO || "").split("-").map(Number);
  const y = parsed[0] || now.getFullYear();
  const mIdx = (parsed[1] || now.getMonth() + 1) - 1;
  const d = parsed[2] || 1;

  const baseYear = now.getFullYear();
  const years: number[] = [];
  for (let yr = baseYear - 5; yr <= baseYear + 6; yr++) years.push(yr);
  if (!years.includes(y)) years.push(y);
  years.sort((a, b) => a - b);

  const pick = (kind: "month" | "year", value: number) => {
    const ny = kind === "year" ? value : y;
    const nm = kind === "month" ? value : mIdx;
    const nd = Math.min(d, daysInMonth(ny, nm));
    onJump(`${ny}-${pad(nm + 1)}-${pad(nd)}`);
    setOpenWhich(null);
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.panel} onPress={(e) => e.stopPropagation?.()} testID="cal-jump-panel">
          <View style={styles.header}>
            <Text style={styles.title}>Jump to</Text>
            <Pressable onPress={onClose} hitSlop={10} testID="cal-jump-close">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.fieldsRow}>
            <Pressable
              style={[styles.field, openWhich === "month" && styles.fieldOn]}
              onPress={() => setOpenWhich((w) => (w === "month" ? null : "month"))}
              testID="cal-jump-month"
            >
              <Text style={styles.fieldText}>{MONTHS[mIdx]}</Text>
              <Ionicons name={openWhich === "month" ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              style={[styles.field, styles.fieldYear, openWhich === "year" && styles.fieldOn]}
              onPress={() => setOpenWhich((w) => (w === "year" ? null : "year"))}
              testID="cal-jump-year"
            >
              <Text style={styles.fieldText}>{y}</Text>
              <Ionicons name={openWhich === "year" ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
            </Pressable>
          </View>

          {openWhich === "month" && (
            <ScrollView style={styles.list} nestedScrollEnabled>
              {MONTHS.map((name, i) => (
                <Pressable
                  key={name}
                  style={[styles.option, i === mIdx && styles.optionOn]}
                  onPress={() => pick("month", i)}
                  testID={`cal-jump-month-${i}`}
                >
                  <Text style={[styles.optionText, i === mIdx && styles.optionTextOn]}>{name}</Text>
                  {i === mIdx && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                </Pressable>
              ))}
            </ScrollView>
          )}

          {openWhich === "year" && (
            <ScrollView style={styles.list} nestedScrollEnabled>
              {years.map((yr) => (
                <Pressable
                  key={yr}
                  style={[styles.option, yr === y && styles.optionOn]}
                  onPress={() => pick("year", yr)}
                  testID={`cal-jump-year-${yr}`}
                >
                  <Text style={[styles.optionText, yr === y && styles.optionTextOn]}>{yr}</Text>
                  {yr === y && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemePalette) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.15)", paddingTop: 96, paddingHorizontal: spacing.lg },
  panel: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, ...( { boxShadow: "0 8px 24px rgba(0,0,0,0.18)" } as any) },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  fieldsRow: { flexDirection: "row", gap: spacing.sm },
  field: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  fieldYear: { flex: 1 },
  fieldOn: { borderColor: c.accent },
  fieldText: { ...typography.body, color: c.textPrimary, fontWeight: "600" },
  list: { maxHeight: 220, marginTop: spacing.sm, borderWidth: 1, borderColor: c.border, borderRadius: radius.md },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  optionOn: { backgroundColor: c.accentSubtle },
  optionText: { ...typography.body, color: c.textPrimary },
  optionTextOn: { color: c.accent, fontWeight: "700" },
});
