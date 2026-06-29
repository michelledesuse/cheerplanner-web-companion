import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ColorPicker, { Panel1, HueSlider, Preview } from "reanimated-color-picker";

import { useTheme, ThemePreset } from "@/src/context/ThemeContext";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { colors, radius, spacing, typography } from "@/src/theme";

// The custom theme builder lets users pick up to 4 colors that map onto the
// app's core palette roles. Everything else (accentSubtle / tabActive) is derived.
type RoleKey = "accent" | "bg" | "card" | "text";
const ROLES: { key: RoleKey; label: string }[] = [
  { key: "accent", label: "Accent" },
  { key: "bg", label: "Background" },
  { key: "card", label: "Surface" },
  { key: "text", label: "Text" },
];

export default function AppearanceScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { presets, presetId, palette, savedPresets, refreshPresets, applyPreset, saveCurrentTheme, deleteSavedTheme } = useTheme();

  const [roleColors, setRoleColors] = useState<Record<RoleKey, string>>({
    accent: palette.accent, bg: palette.bg, card: palette.card, text: palette.textPrimary,
  });
  const [activeRole, setActiveRole] = useState<RoleKey>("accent");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");

  useEffect(() => { refreshPresets(); }, [refreshPresets]);

  const customPreset = useMemo<ThemePreset>(() => ({
    id: "custom", name: "Custom",
    accent: roleColors.accent, accentSubtle: roleColors.accent + "22",
    bg: roleColors.bg, card: roleColors.card,
    textPrimary: roleColors.text, tabActive: roleColors.accent,
  }), [roleColors]);

  const onPick = (c: { hex: string }) => {
    const hex = (c.hex || "").slice(0, 7).toUpperCase();
    setRoleColors((prev) => ({ ...prev, [activeRole]: hex }));
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

        {savedPresets.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.xl, marginBottom: spacing.sm }]}>MY SAVED THEMES</Text>
            {savedPresets.map((p) => (
              <TouchableOpacity
                key={p.id}
                testID={`saved-${p.id}`}
                onPress={() => applyPreset(p)}
                style={[styles.savedRow, p.id === presetId && { borderColor: colors.accent, borderWidth: 2 }]}
              >
                <View style={styles.savedSwatch}>
                  {[p.bg, p.card, p.accent, p.textPrimary].map((cc, i) => (
                    <View key={i} style={[styles.savedSwatchBlock, { backgroundColor: cc }]} />
                  ))}
                </View>
                <Text style={styles.savedName} numberOfLines={1}>{p.name}</Text>
                {p.id === presetId ? <Ionicons name="checkmark-circle" size={18} color={colors.accent} /> : null}
                <TouchableOpacity onPress={() => deleteSavedTheme(p.id)} hitSlop={8} testID={`delete-saved-${p.id}`}>
                  <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </>
        ) : null}

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
          {/* Live preview of the 4 chosen colors */}
          <View style={styles.swatch}>
            <View style={[styles.swatchBlock, { backgroundColor: roleColors.bg }]} />
            <View style={[styles.swatchBlock, { backgroundColor: roleColors.card }]} />
            <View style={[styles.swatchBlock, { backgroundColor: roleColors.accent }]} />
            <View style={[styles.swatchBlock, { backgroundColor: roleColors.text }]} />
          </View>

          <View style={styles.customBody}>
            <Text style={styles.customLabel}>Choose up to 4 colors</Text>
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  testID={`role-${r.key}`}
                  onPress={() => setActiveRole(r.key)}
                  style={[styles.roleChip, activeRole === r.key && { borderColor: roleColors.accent, borderWidth: 2 }]}
                >
                  <View style={[styles.roleDot, { backgroundColor: roleColors[r.key] }]} />
                  <Text style={styles.roleLabel} numberOfLines={1}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.editingHint}>
              Editing <Text style={styles.editingRole}>{ROLES.find((r) => r.key === activeRole)?.label}</Text>
            </Text>

            <View style={styles.pickerWrap}>
              <ColorPicker
                key={activeRole}
                value={roleColors[activeRole]}
                onCompleteJS={onPick}
                style={styles.picker}
              >
                <Preview hideInitialColor style={styles.preview} />
                <Panel1 style={styles.panel} />
                <HueSlider style={styles.hue} />
              </ColorPicker>
            </View>

            <TouchableOpacity
              style={[styles.applyBtn, { backgroundColor: roleColors.accent }]}
              onPress={() => applyPreset(customPreset)}
              testID="custom-apply"
            >
              <Ionicons name="color-palette" size={16} color="#fff" />
              <Text style={styles.applyBtnText}>Apply custom theme</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => { setSaveName(""); setShowSaveModal(true); }}
              testID="custom-save"
            >
              <Ionicons name="bookmark-outline" size={16} color={colors.accent} />
              <Text style={styles.saveBtnText}>Save as preset</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.note}>
          Theme changes apply to everyone in your household and take effect across the app right away.
        </Text>

        <Modal visible={showSaveModal} transparent animationType="fade" onRequestClose={() => setShowSaveModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Name this theme</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Gym colors"
                placeholderTextColor={colors.textTertiary}
                value={saveName}
                onChangeText={setSaveName}
                autoFocus
                maxLength={40}
                testID="save-name-input"
              />
              <View style={styles.modalRow}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setShowSaveModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalSave, { backgroundColor: roleColors.accent }]}
                  testID="save-confirm"
                  onPress={() => { saveCurrentTheme(saveName.trim() || "My theme", customPreset); setShowSaveModal(false); }}
                >
                  <Text style={styles.modalSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
  roleRow: { flexDirection: "row", gap: 8 },
  roleChip: {
    flex: 1, alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 4,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg,
  },
  roleDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: c.border },
  roleLabel: { ...typography.micro, color: c.textSecondary, fontWeight: "700" },
  editingHint: { ...typography.caption, color: c.textSecondary, marginTop: spacing.md },
  editingRole: { fontWeight: "800", color: c.textPrimary },
  pickerWrap: { marginTop: spacing.sm },
  picker: { gap: 14 },
  preview: { height: 38, borderRadius: radius.md },
  panel: { height: 180, borderRadius: radius.md },
  hue: { borderRadius: 999 },
  applyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: spacing.lg, paddingVertical: 13, borderRadius: radius.md,
  },
  applyBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: spacing.sm, paddingVertical: 11, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.accentBorder, backgroundColor: c.accentSubtle,
  },
  saveBtnText: { color: c.accent, fontWeight: "700", fontSize: 14 },
  savedRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.sm, marginBottom: spacing.sm,
  },
  savedSwatch: { flexDirection: "row", width: 56, height: 30, borderRadius: 6, overflow: "hidden" },
  savedSwatchBlock: { flex: 1 },
  savedName: { ...typography.bodyMedium, color: c.textPrimary, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  modalCard: { width: "100%", maxWidth: 360, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
  modalTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.md },
  modalInput: {
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 11, color: c.textPrimary, fontSize: 15,
  },
  modalRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  modalCancelText: { ...typography.bodyMedium, color: c.textPrimary },
  modalSave: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: "center" },
  modalSaveText: { color: "#fff", fontWeight: "800" },
});
