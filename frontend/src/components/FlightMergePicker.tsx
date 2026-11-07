import React from "react";
import { Modal, Pressable, View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

export type FlightChoice = { id: string; label: string; match: boolean };

/** Ask where an imported flight goes: fill in one of the trip's flight cards, or add a new card. */
export default function FlightMergePicker({ flights, onChoose }: { flights: FlightChoice[] | null; onChoose: (choice: string | "new" | "cancel") => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={!!flights} transparent animationType="slide" onRequestClose={() => onChoose("cancel")}>
      <Pressable style={styles.backdrop} onPress={() => onChoose("cancel")}>
        <Pressable style={styles.sheet} onPress={() => {}} testID="flight-merge-picker">
          <Text style={styles.title}>This trip already has a flight</Text>
          <Text style={styles.sub}>Fill in a flight card with this airfare and flight info (updates total paid and due), or add it as a new card.</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {(flights || []).map((f) => (
              <TouchableOpacity key={f.id} style={styles.option} onPress={() => onChoose(f.id)} testID={`flight-merge-${f.id}`}>
                <Ionicons name="airplane" size={16} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optLabel}>Fill in: {f.label}</Text>
                  {f.match && <Text style={styles.match}>Best match</Text>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={[styles.option, styles.newOpt]} onPress={() => onChoose("new")} testID="flight-merge-new">
            <Ionicons name="add-circle-outline" size={16} color={colors.textPrimary} />
            <Text style={[styles.optLabel, { flex: 1 }]}>Add as a new flight card</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancel} onPress={() => onChoose("cancel")} testID="flight-merge-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = () => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" as const },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  title: { ...typography.h3, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md },
  option: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 8 },
  newOpt: { marginTop: 4 },
  optLabel: { ...typography.bodyMedium, fontWeight: "700" as const, color: colors.textPrimary },
  match: { ...typography.micro, color: colors.successText, fontWeight: "800" as const, marginTop: 2 },
  cancel: { alignItems: "center" as const, paddingVertical: 12, minHeight: 44 },
  cancelText: { color: colors.textSecondary, fontWeight: "700" as const },
});
