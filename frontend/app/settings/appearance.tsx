import React, { useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme, ThemePreset } from "@/src/context/ThemeContext";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function AppearanceScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { presets, presetId, refreshPresets, applyPreset } = useTheme();

  useEffect(() => { refreshPresets(); }, [refreshPresets]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Appearance</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Pick a color theme for everyone in your household. Changes save instantly.
        </Text>

        {presets.length === 0 ? (
          <View style={{ alignItems: "center", marginTop: 40 }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <View style={styles.grid}>
            {presets.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                selected={p.id === presetId}
                onPress={() => applyPreset(p)}
              />
            ))}
          </View>
        )}

        <Text style={styles.note}>
          Theme changes apply to everyone in your household. Switching takes effect across the app right away — if a screen still shows old colors, swipe back and reopen it.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PresetCard({ preset, selected, onPress }: { preset: ThemePreset; selected: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.card, selected && { borderColor: preset.accent, borderWidth: 2 }]}
      testID={`theme-preset-${preset.id}`}
    >
      {/* Preview: 4-stripe color swatch so secondary brand colors (e.g. the
          red in Red, White & Blue) are always visible alongside the accent. */}
      <View style={styles.swatch}>
        <View style={[styles.swatchBlock, { backgroundColor: preset.bg }]} />
        <View style={[styles.swatchBlock, { backgroundColor: preset.card }]} />
        <View style={[styles.swatchBlock, { backgroundColor: preset.accent }]} />
        <View style={[styles.swatchBlock, { backgroundColor: preset.tabActive }]} />
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.cardName} numberOfLines={1}>{preset.name}</Text>
        {selected ? (
          <View style={[styles.checkBadge, { backgroundColor: preset.accent }]}>
            <Ionicons name="checkmark" size={14} color="#fff" />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: c.borderSoft,
  },
  headerTitle: { ...typography.h3, color: c.textPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...typography.body, color: c.textSecondary, lineHeight: 20, marginBottom: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "flex-start" },
  card: {
    width: "47%", backgroundColor: c.card,
    borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    overflow: "hidden",
  },
  swatch: { height: 70, flexDirection: "row" },
  swatchBlock: { flex: 1 },
  cardFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  cardName: { ...typography.bodyMedium, color: c.textPrimary, fontSize: 13, flex: 1 },
  checkBadge: {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center",
  },
  note: { ...typography.caption, color: c.textTertiary, marginTop: spacing.lg, lineHeight: 18 },
});
