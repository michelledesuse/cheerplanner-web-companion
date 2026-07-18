import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import type { GridMember, GridRow } from "@/src/utils/rosterGroups";

const HEADER_H = 46;
const SECTION_H = 34;
const ROW_H = 56;

type Column = { id: string; label: string };

type Props = {
  rows: GridRow[];
  columns: Column[];
  renderCell: (member: GridMember, column: Column) => React.ReactNode;
  onNamePress?: (member: GridMember) => void;
  onColumnPress?: (column: Column) => void;
  nameWidth?: number;
  cellWidth?: number;
  refreshControl?: React.ReactElement;
  testID?: string;
};

/**
 * Spreadsheet grid with a FROZEN first column (member name stays put while the
 * data columns scroll horizontally). Renders Personnel / Athletes section
 * headers. Both the frozen column and the scrolling area share one vertical
 * ScrollView and identical per-row heights so they stay aligned.
 */
export default function TrackerGrid({ rows, columns, renderCell, onNamePress, onColumnPress, nameWidth = 140, cellWidth = 96, refreshControl, testID }: Props) {
  const styles = useThemedStyles(makeStyles);
  const dataWidth = Math.max(cellWidth, cellWidth * columns.length);

  return (
    <ScrollView style={{ flex: 1 }} refreshControl={refreshControl} testID={testID}>
      <View style={{ flexDirection: "row" }}>
        {/* Frozen name column */}
        <View style={styles.frozen}>
          <View style={[styles.headCell, { width: nameWidth, height: HEADER_H }]}>
            <Text style={styles.headText}>Member</Text>
          </View>
          {rows.map((r) =>
            r.kind === "section" ? (
              <View key={r.key} style={[styles.sectionCell, { width: nameWidth, height: SECTION_H }]}>
                <Text style={styles.sectionText}>{r.title}</Text>
              </View>
            ) : (
              <TouchableOpacity
                key={r.key}
                style={[styles.nameCell, { width: nameWidth, height: ROW_H }, r.alt && styles.rowAlt]}
                onPress={() => onNamePress?.(r.member)}
                disabled={!onNamePress}
                testID={`grid-name-${r.member.id}`}
              >
                <Text style={styles.nameText} numberOfLines={2}>{r.member.name}</Text>
                {!!onNamePress && <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />}
              </TouchableOpacity>
            )
          )}
        </View>

        {/* Scrollable data columns */}
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={{ flexDirection: "row" }}>
              {columns.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.headCell, { width: cellWidth, height: HEADER_H }]}
                  onPress={() => onColumnPress?.(c)}
                  disabled={!onColumnPress}
                  testID={`grid-col-${c.id}`}
                >
                  <Text style={styles.headText} numberOfLines={2}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {rows.map((r) =>
              r.kind === "section" ? (
                <View key={r.key} style={[styles.sectionCell, { width: dataWidth, height: SECTION_H }]} />
              ) : (
                <View key={r.key} style={[{ flexDirection: "row", height: ROW_H }, r.alt && styles.rowAlt]}>
                  {columns.map((c) => (
                    <View key={c.id} style={[styles.dataCell, { width: cellWidth, height: ROW_H }]}>
                      {renderCell(r.member, c)}
                    </View>
                  ))}
                </View>
              )
            )}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  frozen: { borderRightWidth: 2, borderRightColor: c.border },
  headCell: { paddingVertical: 8, paddingHorizontal: 8, borderRightWidth: 1, borderBottomWidth: 1, borderColor: c.border, backgroundColor: c.card, justifyContent: "center" },
  headText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  sectionCell: { backgroundColor: c.accentSubtle, justifyContent: "center", paddingHorizontal: 10, borderBottomWidth: 1, borderColor: c.border },
  sectionText: { ...typography.micro, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: c.accent },
  nameCell: { paddingHorizontal: 10, borderRightWidth: 1, borderBottomWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  nameText: { ...typography.caption, fontWeight: "700", color: c.textPrimary, flex: 1 },
  dataCell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  rowAlt: { backgroundColor: c.card },
});
