import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme, ThemePreset } from "@/src/context/ThemeContext";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { colors, radius, spacing, typography } from "@/src/theme";

// Curated gym-friendly accent swatches for the custom theme builder.
const ACCENT_SWATCHES = [
  "#E11D48", "#DC2626", "#EA580C", "#D97706", "#CA8A04", "#16A34A",
  "#059669", "#0891B2", "#2563EB", "#4F46E5", "#7C3AED", "#DB2777",
];

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

// Build a full preset from a chosen accent + light/dark background mode.
function buildCustom(accent: string, mode: "light" | "dark"): ThemePreset {
  if (mode === "dark") {
    return {
      id: "custom", name: "Custom", accent, accentSubtle: accent + "33",
      bg: "#0F172A", card: "#1E293B", textPrimary: "#F8FAFC", tabActive: accent,
    };
  }
  return {
    id: "custom", name: "Custom", accent, accentSubtle: accent + "22",
    bg: "#F8FAFC", card: "#FFFFFF", textPrimary: "#0F172A", tabActive: accent,
  };
}

export default function AppearanceScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { presets, presetId, refreshPresets, applyPreset } = useTheme();

  const [customAccent, setCustomAccent] = useState("#E11D48");
  const [customMode, setCustomMode] = useState<"light" | "dark">("light");
  const [hexText, setHexText] = useState("");

  useEffect(() => { refreshPresets(); }, [refreshPresets]);

  const customPreset = useMemo(() => buildCustom(customAccent, customMode), [customAccent, customMode]);

  const onHexSubmit = () => {
    const v = hexText.trim().startsWith("#") ? hexText.trim() : `#${hexText.trim()}`;
    if (HEX_RE.test(v)) { setCustomAccent(v.toUpperCase()); setHexText(""); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Appearance</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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

        {/* ---- Custom theme builder ---- */}
        <View style={styles.customHeaderRow}>
          <Text style={styles.sectionLabel}>BUILD YOUR OWN</Text>
          {presetId === "custom" ? (
            <View style={[styles.activePill, { backgroundColor: colors.accent }]}>
              <Text style={styles.activePillText}>ACTIVE</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.customCard}>
          {/* Live preview */}
          <View style={styles.swatch}>
            <View style={[styles.swatchBlock, { backgroundColor: customPreset.bg }]} />
            <View style={[styles.swatchBlock, { backgroundColor: customPreset.card }]} />
            <View style={[styles.swatchBlock, { backgroundColor: customPreset.accent }]} />
            <View style={[styles.swatchBlock, { backgroundColor: customPreset.tabActive }]} />
          </View>

          <View style={styles.customBody}>
            <Text style={styles.customLabel}>Accent color</Text>
            <View style={styles.swatchRow}>
              {ACCENT_SWATCHES.map((sw) => (
                <TouchableOpacity
                  key={sw}
                  testID={`custom-accent-${sw}`}
                  onPress={() => setCustomAccent(sw)}
                  style={[
                    styles.accentDot,
                    { backgroundColor: sw },
                    customAccent === sw && styles.accentDotOn,
                  ]}
                >
                  {customAccent === sw ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.hexRow}>
              <TextInput
                style={styles.hexInput}
                placeholder="#RRGGBB"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                value={hexText}
                onChangeText={setHexText}
                onSubmitEditing={onHexSubmit}
                maxLength={7}
                testID="custom-hex-input"
              />
              <TouchableOpacity style={styles.hexBtn} onPress={onHexSubmit} testID="custom-hex-apply">
                <Text style={styles.hexBtnText}>Set</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.customLabel, { marginTop: spacing.md }]}>Background</Text>
            <View style={styles.modeRow}>
              {(["light", "dark"] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  testID={`custom-mode-${m}`}
                  onPress={() => setCustomMode(m)}
                  style={[styles.modeBtn, customMode === m && { borderColor: customAccent, borderWidth: 2 }]}
                >
                  <View style={[styles.modeDot, { backgroundColor: m === "dark" ? "#0F172A" : "#F8FAFC" }]} />
                  <Text style={styles.modeText}>{m === "dark" ? "Dark" : "Light"}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.applyBtn, { backgroundColor: customAccent }]}
              onPress={() => applyPreset(customPreset)}
              testID="custom-apply"
            >
              <Ionicons name="color-palette" size={16} color="#fff" />
              <Text style={styles.applyBtnText}>Apply custom theme</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.note}>
          Theme changes apply to everyone in your household and take effect across the app right away.
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

  customHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionLabel: { ...typography.micro, color: c.textTertiary, letterSpacing: 0.6 },
  activePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  activePillText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  customCard: {
    backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden",
  },
  customBody: { padding: spacing.md },
  customLabel: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginBottom: spacing.sm },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  accentDot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  accentDotOn: { borderWidth: 2, borderColor: c.textPrimary },
  hexRow: { flexDirection: "row", gap: 8, marginTop: spacing.md },
  hexInput: {
    flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 9, color: c.textPrimary, fontSize: 14,
  },
  hexBtn: { paddingHorizontal: 16, justifyContent: "center", backgroundColor: c.accentSubtle, borderRadius: radius.md, borderWidth: 1, borderColor: c.accentBorder },
  hexBtnText: { color: c.accent, fontWeight: "700" },
  modeRow: { flexDirection: "row", gap: spacing.md },
  modeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg,
  },
  modeDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: c.border },
  modeText: { ...typography.bodyMedium, color: c.textPrimary },
  applyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: spacing.lg, paddingVertical: 13, borderRadius: radius.md,
  },
  applyBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
