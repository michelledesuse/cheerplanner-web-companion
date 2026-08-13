import React, { useCallback, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { Stars } from "@/src/components/Stars";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Place = {
  id: string; name: string; city?: string; category: string;
  avg_rating: number; review_count: number;
};
type Category = { id: string; label: string; is_default?: boolean; place_count?: number };

const SORTS: { key: string; label: string }[] = [
  { key: "top", label: "Top rated" },
  { key: "reviews", label: "Most reviewed" },
  { key: "new", label: "Newest" },
];

export default function ReviewsHome() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [places, setPlaces] = useState<Place[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [category, setCategory] = useState("all");
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("top");

  const [addCatOpen, setAddCatOpen] = useState(false);
  const [newCat, setNewCat] = useState("");

  const loadCats = useCallback(async () => {
    try {
      const r = await api.get("/reviews/categories");
      setCategories(r.data.categories || []);
      setIsAdmin(!!r.data.is_admin);
    } catch (_e) {}
  }, []);

  const loadPlaces = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (city.trim()) params.set("city", city.trim());
      if (q.trim()) params.set("q", q.trim());
      params.set("sort", sort);
      const r = await api.get(`/reviews/places?${params.toString()}`);
      setPlaces(r.data.places || []);
    } catch (_e) {} finally { setLoading(false); setRefreshing(false); }
  }, [category, city, q, sort]);

  useFocusEffect(useCallback(() => { loadCats(); loadPlaces(); }, [loadCats, loadPlaces]));

  const onRefresh = () => { setRefreshing(true); loadCats(); loadPlaces(); };

  const addCategory = async () => {
    const label = newCat.trim();
    if (!label) return;
    try {
      await api.post("/reviews/categories", { label });
      setNewCat(""); setAddCatOpen(false);
      loadCats();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not add category");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="reviews-back">
          <Ionicons name="chevron-back" size={26} color={styles._icon.color} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Community Reviews</Text>
        {isAdmin ? (
          <TouchableOpacity onPress={() => router.push("/reviews/flags" as any)} testID="reviews-flags-btn">
            <Ionicons name="flag" size={20} color={styles._icon.color} />
          </TouchableOpacity>
        ) : <View style={{ width: 20 }} />}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.blurb}>Discover cheer-friendly spots reviewed by families everywhere — restaurants, hotels, gyms and more.</Text>

        {/* search + city */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={styles._muted.color} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search a place"
            placeholderTextColor={styles._muted.color}
            value={q}
            onChangeText={setQ}
            onSubmitEditing={loadPlaces}
            returnKeyType="search"
            testID="reviews-search"
          />
          {q ? <TouchableOpacity onPress={() => { setQ(""); }}><Ionicons name="close-circle" size={18} color={styles._muted.color} /></TouchableOpacity> : null}
        </View>
        <View style={styles.searchWrap}>
          <Ionicons name="location-outline" size={18} color={styles._muted.color} />
          <TextInput
            style={styles.searchInput}
            placeholder="Filter by city (e.g. Dallas)"
            placeholderTextColor={styles._muted.color}
            value={city}
            onChangeText={setCity}
            onSubmitEditing={loadPlaces}
            returnKeyType="search"
            testID="reviews-city"
          />
          {city ? <TouchableOpacity onPress={() => { setCity(""); }}><Ionicons name="close-circle" size={18} color={styles._muted.color} /></TouchableOpacity> : null}
        </View>

        {/* categories */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" active={category === "all"} onPress={() => setCategory("all")} styles={styles} />
          {categories.map((c) => (
            <Chip key={c.id} label={c.label} active={category === c.label} onPress={() => setCategory(c.label)} styles={styles} />
          ))}
          <TouchableOpacity style={styles.addChip} onPress={() => setAddCatOpen(true)} testID="add-category-chip">
            <Ionicons name="add" size={16} color={styles._icon.color} />
            <Text style={styles.addChipText}>Category</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* sort */}
        <View style={styles.sortRow}>
          {SORTS.map((s) => (
            <TouchableOpacity key={s.key} onPress={() => setSort(s.key)} style={[styles.sortBtn, sort === s.key && styles.sortBtnActive]}>
              <Text style={[styles.sortText, sort === s.key && styles.sortTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={styles._icon.color} />
        ) : places.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="star-outline" size={40} color={styles._muted.color} />
            <Text style={styles.emptyTitle}>No places yet</Text>
            <Text style={styles.emptyText}>Be the first to add a review for this filter.</Text>
          </View>
        ) : (
          places.map((p) => (
            <TouchableOpacity key={p.id} style={styles.card} onPress={() => router.push(`/reviews/${p.id}` as any)} testID={`place-${p.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.placeName}>{p.name}</Text>
                <View style={styles.metaRow}>
                  {!!p.city && <Text style={styles.placeMeta}>{p.city}  •  </Text>}
                  <Text style={styles.placeCat}>{p.category}</Text>
                </View>
                <View style={styles.ratingRow}>
                  <Stars value={p.avg_rating} size={15} />
                  <Text style={styles.ratingText}>{p.avg_rating.toFixed(1)}</Text>
                  <Text style={styles.reviewCount}>({p.review_count} review{p.review_count === 1 ? "" : "s"})</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={styles._muted.color} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* add review FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push("/reviews/new" as any)} testID="add-review-fab">
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={styles.fabText}>Add review</Text>
      </TouchableOpacity>

      {/* add-category modal */}
      <Modal visible={addCatOpen} transparent animationType="fade" onRequestClose={() => setAddCatOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a category</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Nail Salons"
              placeholderTextColor={styles._muted.color}
              value={newCat}
              onChangeText={setNewCat}
              autoFocus
              testID="new-category-input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setAddCatOpen(false); setNewCat(""); }}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={addCategory} style={styles.modalSave} testID="save-category-btn"><Text style={styles.modalSaveText}>Add</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: any }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemePalette) => ({
  _icon: { color: c.textPrimary },
  _muted: { color: c.textTertiary },
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  headerTitle: { fontSize: 18, fontWeight: "700" as const, color: c.textPrimary },
  blurb: { color: c.textSecondary, fontSize: 13, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, lineHeight: 18 },
  searchWrap: { flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.card, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  searchInput: { flex: 1, marginLeft: 8, color: c.textPrimary, fontSize: 15 },
  chips: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, justifyContent: "center" as const, marginRight: 8 },
  chipActive: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { color: c.textSecondary, fontSize: 13, fontWeight: "600" as const },
  chipTextActive: { color: "#fff" },
  addChip: { flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: 1, borderStyle: "dashed" as const, borderColor: c.textTertiary },
  addChipText: { color: c.textPrimary, fontSize: 13, fontWeight: "600" as const, marginLeft: 2 },
  sortRow: { flexDirection: "row" as const, paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  sortBtnActive: { backgroundColor: c.accentSubtle },
  sortText: { color: c.textTertiary, fontSize: 13, fontWeight: "600" as const },
  sortTextActive: { color: c.accent },
  card: { flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.card, marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border },
  placeName: { fontSize: 16, fontWeight: "700" as const, color: c.textPrimary },
  metaRow: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 2, flexWrap: "wrap" as const },
  placeMeta: { color: c.textSecondary, fontSize: 13 },
  placeCat: { color: c.accent, fontSize: 13, fontWeight: "600" as const },
  ratingRow: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 6 },
  ratingText: { color: c.textPrimary, fontWeight: "700" as const, fontSize: 13, marginLeft: 6 },
  reviewCount: { color: c.textTertiary, fontSize: 12, marginLeft: 6 },
  empty: { alignItems: "center" as const, paddingVertical: 60, paddingHorizontal: 40 },
  emptyTitle: { color: c.textPrimary, fontWeight: "700" as const, fontSize: 16, marginTop: 12 },
  emptyText: { color: c.textTertiary, fontSize: 13, textAlign: "center" as const, marginTop: 4 },
  fab: { position: "absolute" as const, right: 16, bottom: 28, flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.accent, paddingHorizontal: 18, height: 52, borderRadius: 26, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  fabText: { color: "#fff", fontWeight: "700" as const, fontSize: 15, marginLeft: 6 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" as const, padding: 24 },
  modalCard: { backgroundColor: c.card, borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: "700" as const, color: c.textPrimary, marginBottom: 12 },
  modalInput: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, height: 46, color: c.textPrimary, fontSize: 15 },
  modalActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, alignItems: "center" as const, marginTop: 16, gap: 20 },
  modalCancel: { color: c.textSecondary, fontSize: 15, fontWeight: "600" as const },
  modalSave: { backgroundColor: c.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  modalSaveText: { color: "#fff", fontWeight: "700" as const, fontSize: 15 },
});
