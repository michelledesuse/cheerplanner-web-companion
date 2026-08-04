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
  created_at?: string;
  upvotes: number;
  voted: boolean;
  comment_count?: number;
};
type Comment = { id: string; author_name?: string; body: string; created_at?: string; is_mine?: boolean };
type ShipNote = { id: string; item_title: string };

const STATUS_META: Record<string, { label: string; kind: "accent" | "success" | "muted" }> = {
  in_progress: { label: "In Development", kind: "accent" },
  planned: { label: "Planned", kind: "muted" },
  completed: { label: "Shipped", kind: "success" },
};
const PLANNED_CYCLE = ["planned", "in_progress", "completed"];
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In Development" },
  { key: "planned", label: "Planned" },
  { key: "completed", label: "Shipped" },
];

export default function RoadmapScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [planned, setPlanned] = useState<Item[]>([]);
  const [suggestions, setSuggestions] = useState<Item[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ship notifications
  const [shipNotes, setShipNotes] = useState<ShipNote[]>([]);

  // sort + filter
  const [sortBy, setSortBy] = useState<"votes" | "new">("votes");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // suggestion composer
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // admin add-planned modal
  const [addOpen, setAddOpen] = useState(false);
  const [pTitle, setPTitle] = useState("");
  const [pDetail, setPDetail] = useState("");
  const [savingPlanned, setSavingPlanned] = useState(false);

  // comments modal
  const [commentsFor, setCommentsFor] = useState<Item | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // merge modal (admin)
  const [mergeSource, setMergeSource] = useState<Item | null>(null);
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, n] = await Promise.all([
        api.get<{ planned: Item[]; suggestions: Item[]; is_admin: boolean }>("/roadmap"),
        api.get<ShipNote[]>("/roadmap/notifications").catch(() => ({ data: [] as ShipNote[] })),
      ]);
      setPlanned(r.data?.planned || []);
      setSuggestions(r.data?.suggestions || []);
      setIsAdmin(!!r.data?.is_admin);
      setShipNotes(n.data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const dismissShipNotes = async () => {
    setShipNotes([]);
    try { await api.post("/roadmap/notifications/seen"); } catch {}
  };

  const applyVote = (id: string, voted: boolean, upvotes: number) => {
    const upd = (arr: Item[]) => arr.map((it) => (it.id === id ? { ...it, voted, upvotes } : it));
    setPlanned((p) => upd(p));
    setSuggestions((s) => upd(s));
  };

  const vote = async (item: Item) => {
    const optimisticVoted = !item.voted;
    const optimisticCount = Math.max(0, item.upvotes + (optimisticVoted ? 1 : -1));
    applyVote(item.id, optimisticVoted, optimisticCount);
    try {
      const r = await api.post<{ voted: boolean; upvotes: number }>(`/roadmap/${item.id}/vote`);
      applyVote(item.id, r.data.voted, r.data.upvotes);
    } catch {
      applyVote(item.id, item.voted, item.upvotes);
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

  // ----- comments -----
  const openComments = async (item: Item) => {
    setCommentsFor(item);
    setComments([]);
    setCommentBody("");
    setLoadingComments(true);
    try {
      const r = await api.get<Comment[]>(`/roadmap/${item.id}/comments`);
      setComments(r.data || []);
    } finally {
      setLoadingComments(false);
    }
  };

  const postComment = async () => {
    if (!commentsFor) return;
    const body = commentBody.trim();
    if (!body) return;
    setPostingComment(true);
    try {
      const r = await api.post<Comment>(`/roadmap/${commentsFor.id}/comments`, { body });
      setComments((c) => [...c, r.data]);
      setCommentBody("");
      // bump the card's comment count
      const bump = (arr: Item[]) => arr.map((it) => (it.id === commentsFor.id ? { ...it, comment_count: (it.comment_count || 0) + 1 } : it));
      setPlanned((p) => bump(p));
      setSuggestions((s) => bump(s));
    } catch (e: any) {
      Alert.alert("Couldn't post", e?.response?.data?.detail || "");
    } finally {
      setPostingComment(false);
    }
  };

  const deleteComment = async (c: Comment) => {
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await api.delete(`/roadmap/comments/${c.id}`);
      if (commentsFor) {
        const dec = (arr: Item[]) => arr.map((it) => (it.id === commentsFor.id ? { ...it, comment_count: Math.max(0, (it.comment_count || 1) - 1) } : it));
        setPlanned((p) => dec(p));
        setSuggestions((s) => dec(s));
      }
    } catch { openComments(commentsFor as Item); }
  };

  // ----- merge (admin) -----
  const confirmMerge = async (target: Item) => {
    if (!mergeSource) return;
    setMerging(true);
    try {
      await api.post(`/roadmap/${target.id}/merge`, { source_id: mergeSource.id });
      setMergeSource(null);
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't merge", e?.response?.data?.detail || "");
    } finally {
      setMerging(false);
    }
  };

  const visiblePlanned = planned.filter((p) => statusFilter === "all" || p.status === statusFilter);
  const visibleSuggestions = [...suggestions].sort((a, b) =>
    sortBy === "votes" ? b.upvotes - a.upvotes : (b.created_at || "").localeCompare(a.created_at || "")
  );

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

          <View style={styles.metaRow}>
            <TouchableOpacity onPress={() => openComments(item)} style={styles.metaChip} testID={`roadmap-comments-${item.id}`}>
              <Ionicons name="chatbubble-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.metaChipText}>{item.comment_count || 0}</Text>
            </TouchableOpacity>

            {isAdmin && item.type === "planned" ? (
              <TouchableOpacity onPress={() => cycleStatus(item)} style={styles.metaChip} testID={`roadmap-status-${item.id}`}>
                <Ionicons name="swap-horizontal" size={13} color={colors.textSecondary} />
                <Text style={styles.metaChipText}>Status</Text>
              </TouchableOpacity>
            ) : null}
            {isAdmin && item.type === "suggestion" ? (
              <TouchableOpacity onPress={() => setMergeSource(item)} style={styles.metaChip} testID={`roadmap-merge-${item.id}`}>
                <Ionicons name="git-merge-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.metaChipText}>Merge</Text>
              </TouchableOpacity>
            ) : null}
            {isAdmin ? (
              <TouchableOpacity onPress={() => removeItem(item)} style={styles.metaChip} testID={`roadmap-delete-${item.id}`}>
                <Ionicons name="trash-outline" size={13} color={colors.danger} />
                <Text style={[styles.metaChipText, { color: colors.danger }]}>Delete</Text>
              </TouchableOpacity>
            ) : null}
          </View>
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
          {/* Ship notifications banner */}
          {shipNotes.length > 0 ? (
            <View style={styles.shipBanner} testID="roadmap-ship-banner">
              <Ionicons name="rocket" size={20} color={colors.successText} />
              <View style={{ flex: 1 }}>
                <Text style={styles.shipTitle}>It shipped! 🎉</Text>
                <Text style={styles.shipBody}>
                  {shipNotes[0].item_title}
                  {shipNotes.length > 1 ? ` and ${shipNotes.length - 1} more` : ""} you upvoted {shipNotes.length > 1 ? "are" : "is"} now live.
                </Text>
              </View>
              <TouchableOpacity onPress={dismissShipNotes} hitSlop={8} testID="roadmap-ship-dismiss">
                <Ionicons name="close" size={18} color={colors.successText} />
              </TouchableOpacity>
            </View>
          ) : null}

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

          {/* Planned features + status filter */}
          <Text style={styles.sectionHead}>PLANNED FEATURES</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {STATUS_FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key}
                onPress={() => setStatusFilter(f.key)}
                style={[styles.filterChip, statusFilter === f.key && styles.filterChipOn]}
                testID={`roadmap-filter-${f.key}`}
              >
                <Text style={[styles.filterChipText, statusFilter === f.key && styles.filterChipTextOn]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {visiblePlanned.length === 0 ? (
            <View style={styles.emptyRow}><Text style={styles.emptyText}>Nothing here yet.</Text></View>
          ) : visiblePlanned.map(renderCard)}

          {/* Community suggestions + sort */}
          <View style={styles.suggHeadRow}>
            <Text style={styles.sectionHead}>COMMUNITY SUGGESTIONS</Text>
            <View style={styles.sortToggle}>
              <TouchableOpacity onPress={() => setSortBy("votes")} style={[styles.sortBtn, sortBy === "votes" && styles.sortBtnOn]} testID="roadmap-sort-votes">
                <Text style={[styles.sortText, sortBy === "votes" && styles.sortTextOn]}>Most voted</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSortBy("new")} style={[styles.sortBtn, sortBy === "new" && styles.sortBtnOn]} testID="roadmap-sort-new">
                <Text style={[styles.sortText, sortBy === "new" && styles.sortTextOn]}>Newest</Text>
              </TouchableOpacity>
            </View>
          </View>
          {visibleSuggestions.length === 0 ? (
            <View style={styles.emptyRow}><Text style={styles.emptyText}>Be the first to suggest a feature above.</Text></View>
          ) : visibleSuggestions.map(renderCard)}
        </ScrollView>
      )}

      {/* Admin: add planned modal */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Add planned feature</Text>
            <TextInput style={styles.input} value={pTitle} onChangeText={setPTitle} placeholder="Feature title" placeholderTextColor={colors.textTertiary} maxLength={120} testID="roadmap-planned-title" />
            <TextInput style={[styles.input, styles.inputMulti]} value={pDetail} onChangeText={setPDetail} placeholder="Description (optional)" placeholderTextColor={colors.textTertiary} multiline testID="roadmap-planned-detail" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setAddOpen(false)} disabled={savingPlanned}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={addPlanned} disabled={savingPlanned} testID="roadmap-planned-save">
                {savingPlanned ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Add</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Comments modal */}
      <Modal visible={!!commentsFor} transparent animationType="slide" onRequestClose={() => setCommentsFor(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetOverlay}>
          <View style={styles.commentSheet}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentHeaderTitle} numberOfLines={1}>{commentsFor?.title}</Text>
              <TouchableOpacity onPress={() => setCommentsFor(null)} hitSlop={8} testID="roadmap-comments-close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
              {loadingComments ? (
                <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
              ) : comments.length === 0 ? (
                <Text style={styles.emptyText}>No comments yet. Start the conversation.</Text>
              ) : comments.map((c) => (
                <View key={c.id} style={styles.commentRow} testID={`roadmap-comment-${c.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commentAuthor}>{c.author_name || "Someone"}</Text>
                    <Text style={styles.commentBody}>{c.body}</Text>
                  </View>
                  {c.is_mine || isAdmin ? (
                    <TouchableOpacity onPress={() => deleteComment(c)} hitSlop={8} testID={`roadmap-comment-del-${c.id}`}>
                      <Ionicons name="trash-outline" size={15} color={colors.textTertiary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </ScrollView>
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                value={commentBody}
                onChangeText={setCommentBody}
                placeholder="Add a comment…"
                placeholderTextColor={colors.textTertiary}
                testID="roadmap-comment-input"
              />
              <TouchableOpacity style={styles.commentSend} onPress={postComment} disabled={postingComment || !commentBody.trim()} testID="roadmap-comment-send">
                {postingComment ? <ActivityIndicator color="white" /> : <Ionicons name="send" size={16} color="white" />}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Merge picker (admin) */}
      <Modal visible={!!mergeSource} transparent animationType="fade" onRequestClose={() => setMergeSource(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Merge into…</Text>
            <Text style={styles.mergeHint} numberOfLines={2}>
              Move votes &amp; comments from “{mergeSource?.title}” into another suggestion, then delete it.
            </Text>
            <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: spacing.sm }}>
              {suggestions.filter((s) => s.id !== mergeSource?.id).map((s) => (
                <TouchableOpacity key={s.id} style={styles.mergeTarget} onPress={() => confirmMerge(s)} disabled={merging} testID={`roadmap-merge-target-${s.id}`}>
                  <Text style={styles.mergeTargetTitle} numberOfLines={1}>{s.title}</Text>
                  <Text style={styles.mergeTargetVotes}>{s.upvotes} ▲</Text>
                </TouchableOpacity>
              ))}
              {suggestions.filter((s) => s.id !== mergeSource?.id).length === 0 ? (
                <Text style={styles.emptyText}>No other suggestions to merge into.</Text>
              ) : null}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setMergeSource(null)} disabled={merging}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
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

  shipBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.successBg, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  shipTitle: { ...typography.bodyMedium, color: c.successText, fontWeight: "800" },
  shipBody: { ...typography.caption, color: c.successText, marginTop: 2, lineHeight: 16 },

  intro: { ...typography.body, color: c.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  composer: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.lg },
  composerLabel: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.textPrimary },
  inputMulti: { minHeight: 64, textAlignVertical: "top" },
  submitBtn: { flex: 1, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  submitText: { color: "white", fontWeight: "800", fontSize: 15 },

  sectionHead: { ...typography.micro, color: c.textTertiary, marginTop: spacing.md, marginBottom: spacing.sm },
  emptyRow: { paddingVertical: spacing.md },
  emptyText: { ...typography.caption, color: c.textTertiary },

  filterRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  filterChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  filterChipText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  filterChipTextOn: { color: "white" },

  suggHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sortToggle: { flexDirection: "row", backgroundColor: c.card, borderRadius: 999, borderWidth: 1, borderColor: c.border, overflow: "hidden", marginTop: spacing.md },
  sortBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  sortBtnOn: { backgroundColor: c.accent },
  sortText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  sortTextOn: { color: "white" },

  card: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  cardTopRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  author: { ...typography.caption, color: c.textTertiary, fontWeight: "700" },
  cardTitle: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  cardDesc: { ...typography.caption, color: c.textSecondary, marginTop: 3, lineHeight: 17 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "800" },

  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  metaChipText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },

  voteBtn: { alignItems: "center", justifyContent: "center", minWidth: 52, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.md, borderWidth: 1, borderColor: c.accent, backgroundColor: c.bg },
  voteBtnOn: { backgroundColor: c.accent },
  voteCount: { ...typography.bodyMedium, color: c.accent, fontWeight: "800", marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalSheet: { width: "100%", maxWidth: 420, backgroundColor: c.bg, borderRadius: 16, padding: spacing.lg, gap: spacing.sm, maxHeight: "82%" },
  modalTitle: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  modalCancel: { paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center", marginTop: 4 },
  modalCancelText: { ...typography.bodyMedium, color: c.textPrimary },

  mergeHint: { ...typography.caption, color: c.textSecondary, lineHeight: 16, marginBottom: 4 },
  mergeTarget: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  mergeTargetTitle: { ...typography.bodyMedium, color: c.textPrimary, flex: 1, marginRight: 8 },
  mergeTargetVotes: { ...typography.caption, color: c.accent, fontWeight: "800" },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  commentSheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", flexShrink: 1 },
  commentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  commentHeaderTitle: { ...typography.h3, color: c.textPrimary, flex: 1, marginRight: 8 },
  commentRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  commentAuthor: { ...typography.caption, color: c.textTertiary, fontWeight: "800", marginBottom: 2 },
  commentBody: { ...typography.body, color: c.textPrimary, lineHeight: 19 },
  commentInputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  commentInput: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: c.textPrimary },
  commentSend: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
});

function badgeStyle(kind: "accent" | "success" | "muted") {
  if (kind === "success") return { backgroundColor: colors.successBg };
  if (kind === "accent") return { backgroundColor: (colors as any).accentSoft || "#DBEAFE" };
  return { backgroundColor: colors.borderSoft };
}
function badgeTextStyle(kind: "accent" | "success" | "muted") {
  if (kind === "success") return { color: colors.successText };
  if (kind === "accent") return { color: colors.accent };
  return { color: colors.textSecondary };
}
