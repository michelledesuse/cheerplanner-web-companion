import React, { useCallback, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform, Image, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { Stars, StarPicker } from "@/src/components/Stars";
import PhotoGallery from "@/src/components/PhotoGallery";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Review = {
  id: string; author_name: string; rating: number; body?: string; photos?: string[];
  display_mode: string; created_at?: string; updated_at?: string; is_mine?: boolean;
};
type Place = { id: string; name: string; city?: string; category: string; avg_rating: number; review_count: number };

function fmtDate(s?: string) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; }
}

export default function PlaceDetail() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [place, setPlace] = useState<Place | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [myReview, setMyReview] = useState<Review | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // inline editor
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [anon, setAnon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  // admin merge
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeList, setMergeList] = useState<Place[]>([]);
  const [mergeQuery, setMergeQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/reviews/places/${id}`);
      setPlace(r.data.place);
      setReviews(r.data.reviews || []);
      setMyReview(r.data.my_review || null);
      setIsAdmin(!!r.data.is_admin);
    } catch (_e) {} finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openEditor = () => {
    setRating(myReview?.rating || 0);
    setBody(myReview?.body || "");
    setPhotos(myReview?.photos || []);
    setAnon(myReview?.display_mode === "anonymous");
    setEditing(true);
  };

  const saveReview = async () => {
    if (rating < 1) { Alert.alert("Add a rating", "Please tap 1–5 stars."); return; }
    setSaving(true);
    try {
      await api.post("/reviews", { place_id: id, rating, body: body.trim(), display_mode: anon ? "anonymous" : "name", photos });
      setEditing(false);
      await load();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (detail === "guidelines_not_accepted") {
        Alert.alert("Community Guidelines", "Reviews are public to every CheerPlanner user. Post honest, respectful reviews only — no hateful, harassing, sexual, or otherwise objectionable content, and no personal attacks. Objectionable content is removed and repeat offenders are blocked.", [
          { text: "Cancel", style: "cancel" },
          { text: "I Agree", onPress: async () => { try { await api.post("/reviews/accept-guidelines"); await saveReview(); } catch {} } },
        ]);
      } else {
        Alert.alert("Error", detail || "Could not save");
      }
    }
    finally { setSaving(false); }
  };

  const blockAuthor = (rev: Review) => {
    Alert.alert("Block this reviewer?", "You won't see any reviews from this person again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: async () => {
        try { await api.post(`/reviews/${rev.id}/block`, {}); await load(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not block"); }
      } },
    ]);
  };

  const deleteMine = () => {
    if (!myReview) return;
    Alert.alert("Delete your review?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/reviews/${myReview.id}`); const wasLast = reviews.length <= 1; if (wasLast) { router.back(); } else { await load(); } }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete"); }
      } },
    ]);
  };

  const flagReview = (rev: Review) => {
    Alert.alert("Report this review?", "Our team will take a look.", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: async () => {
        try { await api.post(`/reviews/${rev.id}/flag`, { reason: "reported" }); Alert.alert("Thanks", "This review was reported."); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not report"); }
      } },
    ]);
  };

  const adminDelete = (rev: Review) => {
    Alert.alert("Delete this review?", "Admin action — removes it for everyone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/reviews/${rev.id}`); await load(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete"); }
      } },
    ]);
  };

  const openMerge = async () => {
    setMergeOpen(true);
    try { const r = await api.get(`/reviews/places?sort=reviews`); setMergeList((r.data.places || []).filter((p: Place) => p.id !== id)); } catch (_e) {}
  };

  const doMerge = (target: Place) => {
    Alert.alert("Merge places?", `Move all reviews of "${place?.name}" into "${target.name}". "${place?.name}" will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Merge", style: "destructive", onPress: async () => {
        try { await api.post(`/reviews/places/${target.id}/merge`, { source_id: id }); setMergeOpen(false); router.replace(`/reviews/${target.id}` as any); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not merge"); }
      } },
    ]);
  };

  const filteredMerge = mergeList.filter((p) => !mergeQuery.trim() || p.name.toLowerCase().includes(mergeQuery.toLowerCase()));

  const photoStrip = (list?: string[]) => {
    if (!list || list.length === 0) return null;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>
        {list.map((uri, i) => (
          <TouchableOpacity key={i} onPress={() => setViewerUri(uri)} activeOpacity={0.85} testID={`review-photo-${i}`}>
            <Image source={{ uri }} style={styles.photoThumb} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  if (loading || !place) {
    return <SafeAreaView style={styles.safe}><ActivityIndicator style={{ marginTop: 60 }} color={styles._icon.color} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="place-back">
          <Ionicons name="chevron-back" size={26} color={styles._icon.color} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{place.name}</Text>
        {isAdmin ? (
          <TouchableOpacity onPress={openMerge} testID="admin-merge-btn"><Ionicons name="git-merge" size={20} color={styles._icon.color} /></TouchableOpacity>
        ) : <View style={{ width: 20 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />} keyboardShouldPersistTaps="handled">
        {/* summary */}
        <View style={styles.summary}>
          <Text style={styles.placeName}>{place.name}</Text>
          <View style={styles.metaRow}>
            {!!place.city && <Text style={styles.placeMeta}>{place.city}  •  </Text>}
            <Text style={styles.placeCat}>{place.category}</Text>
          </View>
          <View style={styles.bigRating}>
            <Text style={styles.avgNum}>{place.avg_rating.toFixed(1)}</Text>
            <View>
              <Stars value={place.avg_rating} size={18} />
              <Text style={styles.reviewCount}>{place.review_count} review{place.review_count === 1 ? "" : "s"}</Text>
            </View>
          </View>
        </View>

        {/* my review / editor */}
        {editing ? (
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>{myReview ? "Edit your review" : "Write a review"}</Text>
            <StarPicker value={rating} onChange={setRating} />
            <TextInput style={styles.textarea} placeholder="Share the details…" placeholderTextColor={styles._muted.color} value={body} onChangeText={setBody} multiline testID="detail-review-body" />
            <PhotoGallery photos={photos} onChange={setPhotos} max={3} label="Photos (optional)" testIDPrefix="detail-review-photos" />
            <TouchableOpacity style={styles.anonRow} onPress={() => setAnon((a) => !a)} testID="detail-anon-toggle">
              <Ionicons name={anon ? "checkbox" : "square-outline"} size={20} color={anon ? styles._accent.color : styles._muted.color} />
              <Text style={styles.anonText}>Post anonymously</Text>
            </TouchableOpacity>
            <View style={styles.editorActions}>
              <TouchableOpacity onPress={() => setEditing(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={saveReview} disabled={saving} testID="save-detail-review">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : myReview ? (
          <View style={styles.myCard}>
            <View style={styles.myHead}>
              <Text style={styles.myLabel}>Your review</Text>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <TouchableOpacity onPress={openEditor} testID="edit-my-review"><Text style={styles.linkAccent}>Edit</Text></TouchableOpacity>
                <TouchableOpacity onPress={deleteMine} testID="delete-my-review"><Text style={styles.linkDanger}>Delete</Text></TouchableOpacity>
              </View>
            </View>
            <Stars value={myReview.rating} size={16} />
            {!!myReview.body && <Text style={styles.reviewBody}>{myReview.body}</Text>}
            {photoStrip(myReview.photos)}
            <Text style={styles.reviewByline}>Posted as {myReview.author_name}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.writeBtn} onPress={openEditor} testID="write-review-btn">
            <Ionicons name="create-outline" size={18} color="#fff" />
            <Text style={styles.writeText}>Write a review</Text>
          </TouchableOpacity>
        )}

        {/* all reviews */}
        <Text style={styles.sectionHead}>Reviews</Text>
        {reviews.filter((r) => !r.is_mine).length === 0 && !myReview ? (
          <Text style={styles.emptyText}>No reviews yet — be the first!</Text>
        ) : (
          reviews.filter((r) => !r.is_mine).map((r) => (
            <View key={r.id} style={styles.reviewCard}>
              <View style={styles.reviewTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewAuthor}>{r.author_name}</Text>
                  <Stars value={r.rating} size={14} />
                </View>
                <Text style={styles.reviewDate}>{fmtDate(r.created_at)}</Text>
              </View>
              {!!r.body && <Text style={styles.reviewBody}>{r.body}</Text>}
              {photoStrip(r.photos)}
              <View style={styles.reviewActions}>
                <TouchableOpacity onPress={() => flagReview(r)} testID={`flag-${r.id}`}><Text style={styles.flagLink}>Report</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => blockAuthor(r)} testID={`block-${r.id}`}><Text style={styles.flagLink}>Block</Text></TouchableOpacity>
                {isAdmin && <TouchableOpacity onPress={() => adminDelete(r)} testID={`admin-del-${r.id}`}><Text style={styles.linkDanger}>Delete (admin)</Text></TouchableOpacity>}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* fullscreen photo viewer */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerUri(null)}>
          {viewerUri ? <Image source={{ uri: viewerUri }} style={styles.viewerImg} resizeMode="contain" /> : null}
          <View style={styles.viewerClose}><Ionicons name="close" size={28} color="#fff" /></View>
        </Pressable>
      </Modal>

      {/* admin merge modal */}
      <Modal visible={mergeOpen} transparent animationType="slide" onRequestClose={() => setMergeOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.mergeCard}>
            <View style={styles.mergeHead}>
              <Text style={styles.modalTitle}>Merge into…</Text>
              <TouchableOpacity onPress={() => setMergeOpen(false)}><Ionicons name="close" size={24} color={styles._icon.color} /></TouchableOpacity>
            </View>
            <Text style={styles.mergeHint}>Pick the place to keep. All reviews of "{place.name}" move there.</Text>
            <TextInput style={styles.mergeSearch} placeholder="Search places" placeholderTextColor={styles._muted.color} value={mergeQuery} onChangeText={setMergeQuery} />
            <ScrollView style={{ maxHeight: 360 }}>
              {filteredMerge.map((p) => (
                <TouchableOpacity key={p.id} style={styles.mergeRow} onPress={() => doMerge(p)} testID={`merge-target-${p.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mergeName}>{p.name}</Text>
                    <Text style={styles.placeMeta}>{p.city ? `${p.city} • ` : ""}{p.category} • {p.review_count} review{p.review_count === 1 ? "" : "s"}</Text>
                  </View>
                  <Ionicons name="git-merge" size={18} color={styles._accent.color} />
                </TouchableOpacity>
              ))}
              {filteredMerge.length === 0 && <Text style={styles.emptyText}>No other places found.</Text>}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  _icon: { color: c.textPrimary },
  _muted: { color: c.textTertiary },
  _accent: { color: c.accent },
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, gap: 10 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700" as const, color: c.textPrimary },
  summary: { padding: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  placeName: { fontSize: 22, fontWeight: "800" as const, color: c.textPrimary },
  metaRow: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 4, flexWrap: "wrap" as const },
  placeMeta: { color: c.textSecondary, fontSize: 14 },
  placeCat: { color: c.accent, fontSize: 14, fontWeight: "600" as const },
  bigRating: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 14, gap: 14 },
  avgNum: { fontSize: 40, fontWeight: "800" as const, color: c.textPrimary },
  reviewCount: { color: c.textTertiary, fontSize: 13, marginTop: 4 },
  myCard: { backgroundColor: c.accentSubtle, margin: 16, padding: 16, borderRadius: 14 },
  myHead: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, marginBottom: 8 },
  myLabel: { fontWeight: "800" as const, color: c.textPrimary, fontSize: 14 },
  linkAccent: { color: c.accent, fontWeight: "700" as const },
  linkDanger: { color: c.dangerText || "#D64545", fontWeight: "700" as const },
  writeBtn: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: c.accent, margin: 16, height: 50, borderRadius: 14, gap: 8 },
  writeText: { color: "#fff", fontWeight: "700" as const, fontSize: 15 },
  editorCard: { backgroundColor: c.card, margin: 16, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: c.border },
  editorTitle: { fontWeight: "800" as const, color: c.textPrimary, fontSize: 15, marginBottom: 12 },
  textarea: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, minHeight: 90, color: c.textPrimary, fontSize: 15, textAlignVertical: "top" as const, marginTop: 12 },
  anonRow: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 12, gap: 8 },
  anonText: { color: c.textSecondary, fontSize: 13 },
  editorActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, alignItems: "center" as const, marginTop: 16, gap: 18 },
  cancelText: { color: c.textSecondary, fontWeight: "600" as const, fontSize: 15 },
  saveBtn: { backgroundColor: c.accent, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  saveText: { color: "#fff", fontWeight: "700" as const, fontSize: 15 },
  sectionHead: { fontSize: 15, fontWeight: "800" as const, color: c.textPrimary, paddingHorizontal: 16, marginTop: 8, marginBottom: 8 },
  emptyText: { color: c.textTertiary, fontSize: 13, paddingHorizontal: 16, paddingVertical: 10 },
  reviewCard: { backgroundColor: c.card, marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  reviewTop: { flexDirection: "row" as const, alignItems: "flex-start" as const },
  reviewAuthor: { fontWeight: "700" as const, color: c.textPrimary, fontSize: 14, marginBottom: 4 },
  reviewDate: { color: c.textTertiary, fontSize: 12 },
  reviewBody: { color: c.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 8 },
  reviewByline: { color: c.textTertiary, fontSize: 12, marginTop: 8 },
  photoThumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border },
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center" as const, justifyContent: "center" as const },
  viewerImg: { width: "92%", height: "80%" },
  viewerClose: { position: "absolute" as const, top: 50, right: 24 },
  reviewActions: { flexDirection: "row" as const, gap: 20, marginTop: 12 },
  flagLink: { color: c.textTertiary, fontWeight: "600" as const, fontSize: 13 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" as const },
  mergeCard: { backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  mergeHead: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  modalTitle: { fontSize: 18, fontWeight: "800" as const, color: c.textPrimary },
  mergeHint: { color: c.textSecondary, fontSize: 13, marginTop: 4, marginBottom: 12 },
  mergeSearch: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, height: 44, color: c.textPrimary, fontSize: 15, marginBottom: 10 },
  mergeRow: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, gap: 10 },
  mergeName: { fontWeight: "700" as const, color: c.textPrimary, fontSize: 15 },
});
