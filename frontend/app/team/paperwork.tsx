import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Sheet = {
  id: string; name: string;
  summary: { item_count: number; member_total: number; done_cells: number; total_cells: number; pct: number };
};

export default function PaperworkScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Sheet[]>("/team/paperwork");
      setItems(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!name.trim()) { Alert.alert("Name required", "Give this sheet a name."); return; }
    setSaving(true);
    try {
      const r = await api.post<{ id: string }>("/team/paperwork", { name: name.trim() });
      setName(""); setAddOpen(false);
      router.push({ pathname: "/team/paperwork-sheet", params: { id: r.data.id } });
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not create.");
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="paperwork-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Paperwork / Other</Text>
        <TouchableOpacity onPress={() => router.push("/import/team_paperwork" as any)} style={styles.iconBtn} testID="paperwork-import" hitSlop={8}>
          <Ionicons name="cloud-upload-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.addBtn} testID="paperwork-add">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="paperwork-list"
        >
          {items.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="document-text-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No paperwork sheets yet</Text>
              <Text style={styles.emptyText}>Create one for waivers, forms or any check-off items &mdash; then track who&apos;s turned things in.</Text>
            </View>
          ) : items.map((s) => {
            const { item_count, pct, member_total } = s.summary;
            return (
              <TouchableOpacity key={s.id} style={styles.card} onPress={() => router.push({ pathname: "/team/paperwork-sheet", params: { id: s.id } })} testID={`paperwork-row-${s.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.cardName}>{s.name}</Text>
                  <Text style={styles.cardMeta}>{item_count} {item_count === 1 ? "item" : "items"}</Text>
                </View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                <Text style={styles.cardMeta}>{pct}% complete · {member_total} {member_total === 1 ? "person" : "people"}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>New paperwork sheet</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Nationals forms" placeholderTextColor={colors.textTertiary} testID="paperwork-name-input" autoFocus />
            <TouchableOpacity style={[styles.confirm, saving && { opacity: 0.6 }]} onPress={create} disabled={saving} testID="paperwork-create-btn">
              {saving ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Create sheet</Text>}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  card: { backgroundColor: c.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.md },
  cardName: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, flex: 1 },
  cardMeta: { ...typography.caption, color: c.textSecondary, marginTop: 6 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: c.divider, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: c.accent },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
});
