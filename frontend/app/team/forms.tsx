import React, { useCallback, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import SeasonBar from "@/src/components/SeasonBar";
import { useSeason } from "@/src/context/SeasonContext";

type Form = {
  id: string; name: string; description?: string; locked?: boolean;
  questions?: any[]; summary?: { response_count: number; member_total: number };
};

export default function FormsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { filterSeasonId } = useSeason();

  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Form[]>("/team/forms", { params: filterSeasonId ? { season_id: filterSeasonId } : {} });
      setForms(r.data || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, [filterSeasonId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    const t = name.trim();
    if (!t) { Alert.alert("Name required", "Give your form a name."); return; }
    setSaving(true);
    try {
      const r = await api.post<Form>("/team/forms", { name: t, description: desc.trim(), questions: [] });
      setCreateOpen(false); setName(""); setDesc("");
      router.push(`/team/form-detail?id=${r.data.id}` as any);
    } catch (e: any) {
      Alert.alert("Couldn't create", e?.response?.data?.detail || "Please try again.");
    } finally { setSaving(false); }
  };

  const duplicate = async (f: Form) => {
    const doIt = async () => {
      try {
        const r = await api.post<Form>(`/team/forms/${f.id}/duplicate`, {});
        router.push(`/team/form-detail?id=${r.data.id}` as any);
      } catch (e: any) {
        Alert.alert("Couldn't duplicate", e?.response?.data?.detail || "Please try again.");
      }
    };
    if (Platform.OS === "web") { doIt(); return; }
    Alert.alert("Duplicate form?", `Make a copy of "${f.name}" with all its questions (no responses).`, [
      { text: "Cancel", style: "cancel" },
      { text: "Duplicate", onPress: doIt },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="forms-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Team Forms</Text>
        <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.iconBtn} testID="forms-add" hitSlop={8}>
          <Ionicons name="add" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.seasonWrap}><SeasonBar /></View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          {forms.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="clipboard-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyText}>No forms yet.</Text>
              <Text style={styles.emptyHint}>Create meal orders, T-shirt sizes, waivers and more. Parents fill via a shareable link.</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setCreateOpen(true)} testID="forms-empty-add">
                <Ionicons name="add" size={18} color="white" />
                <Text style={styles.emptyBtnText}>New form</Text>
              </TouchableOpacity>
            </View>
          ) : forms.map((f) => {
            const s = f.summary || { response_count: 0, member_total: 0 };
            return (
              <TouchableOpacity key={f.id} style={styles.card} onPress={() => router.push(`/team/form-detail?id=${f.id}` as any)} testID={`form-${f.id}`}>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardName}>{f.name}</Text>
                    {f.locked ? (
                      <View style={styles.lockPill}><Ionicons name="lock-closed" size={11} color={colors.warningText} /><Text style={styles.lockPillText}>Locked</Text></View>
                    ) : null}
                  </View>
                  {f.description ? <Text style={styles.cardDesc} numberOfLines={1}>{f.description}</Text> : null}
                  <Text style={styles.cardMeta}>{s.response_count}/{s.member_total} responded · {(f.questions || []).length} question{(f.questions || []).length === 1 ? "" : "s"}</Text>
                </View>
                <TouchableOpacity onPress={() => duplicate(f)} style={styles.dupBtn} hitSlop={8} testID={`form-duplicate-${f.id}`}>
                  <Ionicons name="copy-outline" size={18} color={colors.accent} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>New form</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Form name (e.g. Banquet Meal)" placeholderTextColor={colors.textTertiary} testID="forms-name" />
            <TextInput style={[styles.input, styles.inputMulti]} value={desc} onChangeText={setDesc} placeholder="Description (optional)" placeholderTextColor={colors.textTertiary} multiline testID="forms-desc" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreateOpen(false)} disabled={saving}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={create} disabled={saving} testID="forms-create">
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary },
  seasonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  empty: { alignItems: "center", paddingTop: 70, gap: 8 },
  emptyText: { ...typography.body, color: c.textSecondary, fontWeight: "700" },
  emptyHint: { ...typography.caption, color: c.textTertiary, textAlign: "center", paddingHorizontal: 30, lineHeight: 17 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 18, marginTop: spacing.md },
  emptyBtnText: { color: "white", fontWeight: "800", fontSize: 14 },

  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  cardDesc: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  cardMeta: { ...typography.caption, color: c.textTertiary, marginTop: 4 },
  dupBtn: { width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.bg, borderWidth: 1, borderColor: c.border },
  lockPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: c.warningBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  lockPillText: { fontSize: 10, fontWeight: "800", color: c.warningText },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalSheet: { width: "100%", maxWidth: 440, backgroundColor: c.bg, borderRadius: 16, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.textPrimary },
  inputMulti: { minHeight: 64, maxHeight: 140, textAlignVertical: "top" },
  submitBtn: { flex: 1, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  submitText: { color: "white", fontWeight: "800", fontSize: 15 },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  modalCancelText: { ...typography.bodyMedium, color: c.textPrimary },
});
