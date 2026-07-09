import React, { useEffect, useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, Pressable, ActivityIndicator } from "react-native";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

/** Preset swatches offered when creating a custom event type. */
export const TYPE_COLOR_SWATCHES = [
  "#EA580C", "#0EA5E9", "#DB2777", "#9333EA", "#0891B2",
  "#16A34A", "#F59E0B", "#DC2626", "#4169E1", "#64748B",
];

type Props = {
  visible: boolean;
  title: string;
  placeholder?: string;
  /** When true, shows a color-swatch picker and returns the chosen color. */
  withColor?: boolean;
  onSubmit: (name: string, color?: string) => Promise<void> | void;
  onClose: () => void;
};

/**
 * A small modal for creating a custom type inline from a picker. Used by both
 * the expense-category picker (name only) and the schedule event-type picker
 * (name + color).
 */
export default function AddTypeModal({ visible, title, placeholder, withColor, onSubmit, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TYPE_COLOR_SWATCHES[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) { setName(""); setColor(TYPE_COLOR_SWATCHES[0]); setSaving(false); }
  }, [visible]);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(name.trim(), withColor ? color : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation?.()} testID="add-type-modal">
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={placeholder || "Name"}
            placeholderTextColor={colors.textTertiary}
            autoFocus
            testID="add-type-name"
          />
          {withColor && (
            <>
              <Text style={styles.label}>Color</Text>
              <View style={styles.swatchRow}>
                {TYPE_COLOR_SWATCHES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setColor(c)}
                    style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]}
                    testID={`add-type-color-${c}`}
                  />
                ))}
              </View>
            </>
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} testID="add-type-cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (!name.trim() || saving) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={!name.trim() || saving}
              testID="add-type-save"
            >
              {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveText}>Add</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemePalette) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 420, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  label: { ...typography.micro, color: c.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.textPrimary },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: c.textPrimary },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  cancelText: { ...typography.bodyMedium, color: c.textPrimary },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.accent, alignItems: "center" },
  saveText: { color: "white", fontWeight: "700" },
});
