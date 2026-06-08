import React, { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ColorPicker, { Panel1, HueSlider, Preview, Swatches } from "reanimated-color-picker";

import { colors, radius, spacing, typography } from "@/src/theme";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  testID?: string;
  /** Optional quick-pick presets shown at the bottom of the modal. */
  presets?: string[];
};

const DEFAULT_PRESETS = [
  "#E11D48", "#F97316", "#F59E0B", "#10B981", "#0EA5E9",
  "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6", "#64748B",
  "#0F172A", "#DC2626",
];

/**
 * Compact swatch button that opens a full HSV color picker in a modal.
 * The picker has a draggable saturation/brightness panel + hue slider, so the
 * user can land on any color rather than choosing from a fixed palette.
 */
export default function ColorField({ value, onChange, testID, presets = DEFAULT_PRESETS }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  // Holds the latest hex from the picker without triggering a re-render on
  // every micro-move. The library's `onChange` callback runs on the worklet
  // (UI) thread, so calling setState from there at 60 fps will crash on iOS
  // release builds. We instead stash the value in a ref and commit to React
  // state only when the user lifts their finger (`onCompleteJS`).
  const liveColor = useRef(value);

  const display = (value || draft || "#0EA5E9").toUpperCase();

  return (
    <>
      <View style={styles.row} testID={testID}>
        <Pressable
          style={[styles.swatch, { backgroundColor: display }]}
          onPress={() => { setDraft(display); liveColor.current = display; setOpen(true); }}
          testID={`${testID || "color-field"}-swatch`}
        />
        <Pressable onPress={() => { setDraft(display); liveColor.current = display; setOpen(true); }} style={styles.hexBtn}>
          <Text style={styles.hexText}>{display}</Text>
          <Ionicons name="color-palette" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Pick a color</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 0 }}>
              <ColorPicker
                value={draft}
                // `onChange` runs on the UI thread (worklet). Calling setState
                // from there crashes iOS release builds at high fps (see
                // alabsi91/reanimated-color-picker#82). Use `onCompleteJS`
                // which fires once on gesture end on the JS thread.
                onCompleteJS={(c: any) => { liveColor.current = c.hex; setDraft(c.hex); }}
                style={{ gap: spacing.md }}
              >
                <Preview hideInitialColor style={styles.preview} textStyle={{ color: "white", fontWeight: "700" }} />
                <Panel1 style={styles.panel} />
                <HueSlider style={styles.slider} />
                <Swatches
                  colors={presets}
                  style={styles.swatches}
                  swatchStyle={styles.presetSwatch}
                  onChange={(c: any) => { liveColor.current = c.hex; setDraft(c.hex); }}
                />
              </ColorPicker>
            </ScrollView>

            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={() => {
                  const finalHex = (liveColor.current || draft || display).toUpperCase();
                  onChange(finalHex);
                  setOpen(false);
                }}
                testID={`${testID || "color-field"}-confirm`}
              >
                <Text style={styles.confirmText}>Use color</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  swatch: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 3, borderColor: "white",
    // Elevation/shadow ring
    shadowColor: "#000", shadowOpacity: 0.15, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
    elevation: 3,
  },
  hexBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  hexText: { ...typography.body, color: colors.textPrimary, fontFamily: "Courier", letterSpacing: 1 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: colors.bg, borderRadius: 16, overflow: "hidden" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },

  preview: { height: 44, borderRadius: 10 },
  panel: { width: "100%", height: 200, borderRadius: 12 },
  slider: { height: 28, borderRadius: 14 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-start" },
  presetSwatch: { width: 28, height: 28, borderRadius: 14, margin: 0 },

  sheetActions: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  cancelText: { ...typography.bodyMedium, color: colors.textPrimary },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center" },
  confirmText: { ...typography.bodyMedium, color: "white" },
});
