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

type Item = {
  id: string;
  type: "planned" | "suggestion";
  title: string;
  description?: string;
  status?: string;
  created_by_name?: string;
  upvotes: number;
  voted: boolean;
};

const STATUS_META: Record<string, { label: string; kind: "accent" | "success" | "muted" }> = {
  in_progress: { label: "In progress", kind: "accent" },
  planned: { label: "Planned", kind: "muted" },
  completed: { label: "Shipped", kind: "success" },
};
const PLANNED_CYCLE = ["planned", "in_progress", "completed"];

export default function RoadmapScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [planned, setPlanned] = useState<Item[]>([]);
  const [suggestions, setSuggestions] = useState<Item[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // suggestion composer
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // admin add-planned modal
  const [addOpen, setAddOpen] = useState(false);
  const [pTitle, setPTitle] = useState("");
  const [pDetail, setPDetail] = useState("");
  const [savingPlanned, setSavingPlanned] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ planned: Item[]; suggestions: Item[]; is_admin: boolean }>("/roadmap");
      setPlanned(r.data?.planned || []);
      setSuggestions(r.data?.suggestions || []);
      setIsAdmin(!!r.data?.is_admin);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const applyVote = (id: string, voted: boolean, upvotes: number) => {
    const upd = (arr: Item[]) => arr.map((it) => (it.id === id ? { ...it, voted, upvotes } : it));
    setPlanned((p) => upd(p));
    setSuggestions((s) => upd(s));
  };

  const vote = async (item: Item) => {
    // optimistic
    const optimisticVoted = !item.voted;
    const optimisticCount = Math.max(0, item.upvotes + (optimisticVoted ? 1 : -1));
    applyVote(item.id, optimisticVoted, optimisticCount);
    try {
      const r = await api.post<{ voted: boolean; upvotes: number }>(`/roadmap/${item.id}/vote`);
      applyVote(item.id, r.data.voted, r.data.upvotes);
      // re-sort suggestions by votes
      setSuggestions((s) => [...s].sort((a, b) => b.upvotes - a.upvotes));
    } catch {
      applyVote(item.id, item.voted, item.upvotes); // revert
    }
  };

  const submitSuggestion = async () => {
    const t = title.trim();
    if (!t) { Alert.alert("Add a title", "Give your idea a short title."); return; }
    setSubmitting(true);
    try {
      await api.post("/roadmap/suggestions", { title: t, description: detail.trim() });
      setTitle(""); setDetail("");
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't submit", e?.response?.data?.detail || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const addPlanned = async () => {
    const t = pTitle.trim();
    if (!t) { Alert.alert("Title required"); return; }
    setSavingPlanned(true);
    try {
      await api.post("/roadmap/planned", { title: t, description: pDetail.trim(), status: "planned" });
      setPTitle(""); setPDetail(""); setAddOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't add", e?.response?.data?.detail || "Please try again.");
    } finally {
      setSavingPlanned(false);
    }
  };

  const cycleStatus = async (item: Item) => {
    const idx = PLANNED_CYCLE.indexOf(item.status || "planned");
    const next = PLANNED_CYCLE[(idx + 1) % PLANNED_CYCLE.length];
    setPlanned((p) => p.map((it) => (it.id === item.id ? { ...it, status: next } : it)));
    try { await api.patch(`/roadmap/${item.id}`, { status: next }); } catch { load(); }
  };

  const removeItem = (item: Item) => {
    const doDelete = async () => {
      try { await api.delete(`/roadmap/${item.id}`); await load(); }
      catch (e: any) { Alert.alert("Couldn't delete", e?.response?.data?.detail || ""); }
    };
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert("Delete item?", item.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const renderCard = (item: Item) => {
    const st = item.type === "planned" ? STATUS_META[item.status || "planned"] : null;
    return (
      <View key={item.id} style={styles.card} testID={`roadmap-item-${item.id}`}>
        <View style={{ flex: 1 }}>
          <View style={styles.cardTopRow}>
            {st ? (
              <View style={[styles.badge, badgeStyle(st.kind)]}>
                <Text style={[styles.badgeText, badgeTextStyle(st.kind)]}>{st.label}</Text>
              </View>
            ) : (
              <Text style={styles.author}>{item.created_by_name || "Community"}</Text>
            )}
          </View>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}

          {isAdmin ? (
            <View style={styles.adminRow}>
              {item.type === "planned" ? (
                <TouchableOpacity onPress={() => cycleStatus(item)} style={styles.adminChip} testID={`roadmap-status-${item.id}`}>
                  <Ionicons name="swap-horizontal" size={13} color={colors.textSecondary} />
                  <Text style={styles.adminChipText}>Status</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => removeItem(item)} style={styles.adminChip} testID={`roadmap-delete-${item.id}`}>
                <Ionicons name="trash-outline" size={13} color={colors.danger} />
                <Text style={[styles.adminChipText, { color: colors.danger }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => vote(item)}
          style={[styles.voteBtn, item.voted && styles.voteBtnOn]}
          activeOpacity={0.7}
          testID={`roadmap-vote-${item.id}`}
        >
          <Ionicons name={item.voted ? "caret-up" : "caret-up-outline"} size={18} color={item.voted ? "white" : colors.accent} />
          <Text style={[styles.voteCount, item.voted && { color: "white" }]}>{item.upvotes}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="roadmap-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Feature Roadmap</Text>
        {isAdmin ? (
          <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.iconBtn} testID="roadmap-add-planned" hitSlop={8}>
            <Ionicons name="add" size={24} color={colors.accent} />
          </TouchableOpacity>
        ) : <View style={{ width: 38 }} />}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          <Text style={styles.intro}>Help shape CheerPlanner. Upvote what you want next, or share a new idea.</Text>

          {/* Suggestion composer */}
          <View style={styles.composer}>
            <Text style={styles.composerLabel}>💡 Suggest a feature</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Your idea (short title)"
              placeholderTextColor={colors.textTertiary}
              maxLength={120}
              testID="roadmap-suggestion-title"
            />
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={detail}
              onChangeText={setDetail}
              placeholder="Add a few details (optional)"
              placeholderTextColor={colors.textTertiary}
              multiline
              testID="roadmap-suggestion-detail"
            />
            <TouchableOpacity
              style={[styles.submitBtn, (submitting || !title.trim()) && { opacity: 0.5 }]}
              onPress={submitSuggestion}
              disabled={submitting || !title.trim()}
              testID="roadmap-suggestion-submit"
            >
              {submitting ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Submit idea</Text>}
            </TouchableOpacity>
          </View>

          {/* Planned features */}
          <Text style={styles.sectionHead}>PLANNED FEATURES</Text>
          {planned.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No planned items yet — check back soon.</Text>
            </View>
          ) : planned.map(renderCard)}

          {/* Community suggestions */}
          <Text style={styles.sectionHead}>COMMUNITY SUGGESTIONS</Text>
          {suggestions.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>Be the first to suggest a feature above.</Text>
            </View>
          ) : suggestions.map(renderCard)}
        </ScrollView>
      )}

      {/* Admin: add planned modal */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Add planned feature</Text>
            <TextInput
              style={styles.input}
              value={pTitle}
              onChangeText={setPTitle}
              placeholder="Feature title"
              placeholderTextColor={colors.textTertiary}
              maxLength={120}
              testID="roadmap-planned-title"
            />
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={pDetail}
              onChangeText={setPDetail}
              placeholder="Description (optional)"
              placeholderTextColor={colors.textTertiary}
              multiline
              testID="roadmap-planned-detail"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setAddOpen(false)} disabled={savingPlanned}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={addPlanned} disabled={savingPlanned} testID="roadmap-planned-save">
                {savingPlanned ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Add</Text>}
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

  intro: { ...typography.body, color: c.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  composer: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.lg },
  composerLabel: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.textPrimary },
  inputMulti: { minHeight: 64, textAlignVertical: "top" },
  submitBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  submitText: { color: "white", fontWeight: "800", fontSize: 15 },

  sectionHead: { ...typography.micro, color: c.textTertiary, marginTop: spacing.md, marginBottom: spacing.sm },
  emptyRow: { paddingVertical: spacing.md },
  emptyText: { ...typography.caption, color: c.textTertiary },

  card: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  cardTopRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  author: { ...typography.caption, color: c.textTertiary, fontWeight: "700" },
  cardTitle: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  cardDesc: { ...typography.caption, color: c.textSecondary, marginTop: 3, lineHeight: 17 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "800" },

  adminRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  adminChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  adminChipText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },

  voteBtn: { alignItems: "center", justifyContent: "center", minWidth: 52, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.md, borderWidth: 1, borderColor: c.accent, backgroundColor: c.bg },
  voteBtnOn: { backgroundColor: c.accent },
  voteCount: { ...typography.bodyMedium, color: c.accent, fontWeight: "800", marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalSheet: { width: "100%", maxWidth: 420, backgroundColor: c.bg, borderRadius: 16, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  modalCancelText: { ...typography.bodyMedium, color: c.textPrimary },
});

function badgeStyle(kind: "accent" | "success" | "muted") {
  if (kind === "success") return { backgroundColor: colors.successBg };
  if (kind === "accent") return { backgroundColor: colors.accentSoft || "#DBEAFE" };
  return { backgroundColor: colors.borderSoft };
}
function badgeTextStyle(kind: "accent" | "success" | "muted") {
  if (kind === "success") return { color: colors.successText };
  if (kind === "accent") return { color: colors.accent };
  return { color: colors.textSecondary };
}
