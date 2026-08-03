import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { typography, spacing, radius } from "@/src/theme";
import { useSeason } from "@/src/context/SeasonContext";

export type EditScope = "this" | "forward" | "all";

/**
 * Per-item season membership picker (multi-select) plus an optional
 * "Apply changes to" scope selector shown when editing an item that already
 * spans more than one season. The scope maps to the backend `edit_scope`
 * (this / forward / all) handled by apply_scoped_update.
 */
export default function SeasonPicker({
  selectedIds,
  onToggle,
  scope,
  onScopeChange,
  showScope = false,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
  scope?: EditScope;
  onScopeChange?: (s: EditScope) => void;
  showScope?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { seasons } = useSeason();
  if (!seasons.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Seasons {selectedIds.length ? `(${selectedIds.length})` : ""}</Text>
      <Text style={styles.hint}>Tap to attach this to one or more seasons. Leave empty to show in every season.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {seasons.map((s) => {
          const on = selectedIds.includes(s.id);
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => onToggle(s.id)}
              style={[styles.chip, on && styles.chipOn]}
              testID={`season-chip-${s.id}`}
            >
              {on && <Ionicons name="checkmark" size={13} color="white" style={{ marginRight: 4 }} />}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.name}{s.is_active ? " • active" : ""}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {showScope && onScopeChange && (
        <View style={styles.scopeBox}>
          <Text style={styles.scopeLabel}>This is in multiple seasons. Apply your changes to:</Text>
          <View style={styles.scopeRow}>
            {([
              { v: "this", label: "This season" },
              { v: "forward", label: "This & later" },
              { v: "all", label: "All seasons" },
            ] as { v: EditScope; label: string }[]).map((opt) => {
              const on = (scope || "all") === opt.v;
              return (
                <TouchableOpacity
                  key={opt.v}
                  onPress={() => onScopeChange(opt.v)}
                  style={[styles.scopeChip, on && styles.scopeChipOn]}
                  testID={`season-scope-${opt.v}`}
                >
                  <Text style={[styles.scopeChipText, on && styles.scopeChipTextOn]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    wrap: { marginTop: spacing.lg },
    label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginBottom: 4 },
    hint: { ...typography.micro, color: c.textTertiary, marginBottom: 8 },
    row: { gap: 8, paddingRight: spacing.md },
    chip: {
      flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8,
      borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { ...typography.caption, color: c.textPrimary, fontWeight: "700", fontSize: 12 },
    chipTextOn: { color: "white" },
    scopeBox: {
      marginTop: spacing.md, padding: 10, borderRadius: radius.md,
      backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.border,
    },
    scopeLabel: { ...typography.micro, color: c.textSecondary, fontWeight: "600", marginBottom: 8 },
    scopeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    scopeChip: {
      flexGrow: 1, alignItems: "center", paddingVertical: 8, paddingHorizontal: 6,
      borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg,
    },
    scopeChipOn: { backgroundColor: c.accent, borderColor: c.accent },
    scopeChipText: { ...typography.caption, color: c.textPrimary, fontWeight: "700", fontSize: 12 },
    scopeChipTextOn: { color: "white" },
  });
