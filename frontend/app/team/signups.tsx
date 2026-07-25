import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Sheet = {
  id: string; name: string; competition_id?: string | null;
  summary: { slot_count: number; needed_total: number; claimed_total: number; filled_slots: number };
};
type Comp = { id: string; name: string };

export default function SignupsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Sheet[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [compId, setCompId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Sheet[]>("/team/signups");
      setItems(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { api.get<Comp[]>("/competitions").then((r) => setComps(r.data)).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const compName = (id?: string | null) => comps.find((c) => c.id === id)?.name;

  const duplicate = async (id: string) => {
    try { await api.post(`/team/signups/${id}/duplicate`); await load(); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not duplicate."); }
  };

  const create = async () => {
    if (!name.trim()) { Alert.alert("Name required", "Give this sheet a name."); return; }
    setSaving(true);
    try {
      const r = await api.post<{ id: string }>("/team/signups", { name: name.trim(), competition_id: compId });
      setName(""); setCompId(null); setAddOpen(false);
      router.push({ pathname: "/team/signup-sheet", params: { id: r.data.id } });
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not create.");
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="signups-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sign-Up Sheet</Text>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.addBtn} testID="signup-add">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="signups-list"
        >
          {items.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="hand-left-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No sign-up sheets yet</Text>
              <Text style={styles.emptyText}>Create one for an event, add slots (snacks, water, chaperones&hellip;) and let families claim them.</Text>
            </View>
          ) : items.map((s) => {
            const { needed_total, claimed_total, slot_count } = s.summary;
            const pct = needed_total > 0 ? Math.min(100, Math.round((claimed_total / needed_total) * 100)) : 0;
            return (
              <TouchableOpacity key={s.id} style={styles.card} onPress={() => router.push({ pathname: "/team/signup-sheet", params: { id: s.id } })} testID={`signup-row-${s.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.cardName}>{s.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={styles.cardMeta}>{slot_count} {slot_count === 1 ? "slot" : "slots"}</Text>
                    <TouchableOpacity onPress={() => duplicate(s.id)} hitSlop={8} testID={`signup-duplicate-${s.id}`}>
                      <Ionicons name="copy-outline" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                </View>
                {!!compName(s.competition_id) && <Text style={styles.compTag}>{compName(s.competition_id)}</Text>}
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                <Text style={styles.cardMeta}>{claimed_total}/{needed_total} claimed</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>New sign-up sheet</Text>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Nationals send-off party" placeholderTextColor={colors.textTertiary} testID="signup-name-input" autoFocus />
              {comps.length > 0 && (
                <>
                  <Text style={styles.label}>Link to a competition (optional)</Text>
                  <View style={styles.compRow}>
                    <TouchableOpacity onPress={() => setCompId(null)} style={[styles.compChip, compId === null && styles.compChipOn]} testID="signup-comp-none">
                      <Text style={[styles.compChipText, compId === null && styles.compChipTextOn]}>None</Text>
                    </TouchableOpacity>
                    {comps.map((c) => (
                      <TouchableOpacity key={c.id} onPress={() => setCompId(c.id)} style={[styles.compChip, compId === c.id && styles.compChipOn]} testID={`signup-comp-${c.id}`}>
                        <Text style={[styles.compChipText, compId === c.id && styles.compChipTextOn]} numberOfLines={1}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity style={[styles.confirm, saving && { opacity: 0.6 }]} onPress={create} disabled={saving} testID="signup-create-btn">
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Create sheet</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
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
  compTag: { ...typography.micro, color: c.accent, fontWeight: "700", marginTop: 4 },
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
  compRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  compChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, maxWidth: 220 },
  compChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  compChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  compChipTextOn: { color: "white" },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
});
