import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, Modal, Pressable, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { api } from "@/src/api/client";

type Hub = { id: string; name: string; is_owner: boolean; is_active: boolean };

export default function TeamHubSwitcher({ onChange }: { onChange?: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ hubs: Hub[] }>("/team/hubs");
      setHubs(r.data.hubs || []);
    } catch { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = hubs.find((h) => h.is_active) || hubs[0];

  const switchTo = async (hub: Hub) => {
    if (hub.is_active) { setOpen(false); return; }
    setBusy(true);
    try {
      await api.post("/team/hubs/active", { hub_id: hub.id });
      await load();
      setOpen(false);
      onChange?.();
    } finally { setBusy(false); }
  };

  const saveName = async (hub: Hub) => {
    const name = nameDraft.trim();
    setBusy(true);
    try {
      await api.patch(`/team/hubs/${hub.id}`, { name });
      setRenamingId(null);
      await load();
      onChange?.();
    } finally { setBusy(false); }
  };

  if (!active) return null;
  const multi = hubs.length > 1;

  return (
    <>
      <TouchableOpacity style={styles.pill} onPress={() => setOpen(true)} testID="team-hub-switcher">
        <Ionicons name="people-circle-outline" size={18} color={styles._accent.color} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.pillLabel}>{multi ? "Active team" : "Your team"}</Text>
          <Text style={styles.pillName} numberOfLines={1}>{active.name}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={styles._muted.color} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => { setOpen(false); setRenamingId(null); }}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{multi ? "Switch team" : "Your team"}</Text>
            <Text style={styles.sheetSub}>{multi ? "Pick which team's hub to view." : "Rename your team hub anytime."}</Text>

            {hubs.map((h) => (
              <View key={h.id} style={styles.row}>
                {renamingId === h.id ? (
                  <View style={styles.renameRow}>
                    <TextInput
                      style={styles.input}
                      value={nameDraft}
                      onChangeText={setNameDraft}
                      placeholder="Team name"
                      placeholderTextColor={styles._muted.color}
                      autoFocus
                      testID="hub-rename-input"
                    />
                    <TouchableOpacity style={styles.saveBtn} onPress={() => saveName(h)} disabled={busy} testID="hub-rename-save">
                      <Text style={styles.saveBtnText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity style={styles.rowMain} onPress={() => switchTo(h)} disabled={busy} testID={`hub-option-${h.id}`}>
                      <Ionicons
                        name={h.is_active ? "radio-button-on" : "radio-button-off"}
                        size={20}
                        color={h.is_active ? styles._accent.color : styles._muted.color}
                      />
                      <Text style={[styles.rowName, h.is_active && styles.rowNameActive]} numberOfLines={1}>{h.name}</Text>
                    </TouchableOpacity>
                    {h.is_owner ? (
                      <TouchableOpacity onPress={() => { setRenamingId(h.id); setNameDraft(h.name); }} hitSlop={10} testID={`hub-rename-${h.id}`}>
                        <Ionicons name="pencil" size={16} color={styles._muted.color} />
                      </TouchableOpacity>
                    ) : null}
                  </>
                )}
              </View>
            ))}

            {busy ? <ActivityIndicator style={{ marginTop: spacing.sm }} color={styles._accent.color} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  _accent: { color: c.accent },
  _muted: { color: c.textTertiary },
  pill: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 14, marginBottom: spacing.md },
  pillLabel: { ...typography.micro, color: c.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  pillName: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary },
  sheetSub: { ...typography.caption, color: c.textSecondary, marginTop: 2, marginBottom: spacing.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 },
  rowName: { ...typography.body, color: c.textPrimary, flexShrink: 1 },
  rowNameActive: { fontWeight: "800" },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  input: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: c.textPrimary },
  saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 16 },
  saveBtnText: { color: "white", fontWeight: "800" },
});
