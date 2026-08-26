import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
  TextInput, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { StarPicker } from "@/src/components/Stars";
import PhotoGallery from "@/src/components/PhotoGallery";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Category = { id: string; label: string };

export default function NewReview() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("Restaurants/Eateries");
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [anon, setAnon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const [guidelinesAccepted, setGuidelinesAccepted] = useState(true);

  const loadCats = useCallback(async () => {
    try { const r = await api.get("/reviews/categories"); setCategories(r.data.categories || []); setGuidelinesAccepted(!!r.data.guidelines_accepted); } catch (_e) {}
  }, []);
  useEffect(() => { loadCats(); }, [loadCats]);

  const GUIDELINES = "Reviews are public to every CheerPlanner user. Post honest, respectful reviews only — no hateful, harassing, sexual, or otherwise objectionable content, and no personal attacks. Objectionable content is removed and repeat offenders are blocked.";
  const promptGuidelines = (after: () => void) => {
    Alert.alert("Community Guidelines", GUIDELINES, [
      { text: "Cancel", style: "cancel" },
      { text: "I Agree", onPress: async () => { try { await api.post("/reviews/accept-guidelines"); setGuidelinesAccepted(true); after(); } catch {} } },
    ]);
  };

  const addCategoryInline = async () => {
    const label = newCat.trim();
    if (!label) return;
    try {
      const r = await api.post("/reviews/categories", { label });
      await loadCats();
      setCategory(r.data.label);
      setNewCat(""); setShowNewCat(false);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not add category"); }
  };

  const submit = async (skipGuard = false) => {
    if (!name.trim()) { Alert.alert("Missing info", "Please enter the place name."); return; }
    if (rating < 1) { Alert.alert("Add a rating", "Please tap 1–5 stars."); return; }
    if (!skipGuard && !guidelinesAccepted) { promptGuidelines(() => submit(true)); return; }
    setSaving(true);
    try {
      const r = await api.post("/reviews", {
        place_name: name.trim(), city: city.trim(), category,
        rating, body: body.trim(), display_mode: anon ? "anonymous" : "name", photos,
      });
      router.replace(`/reviews/${r.data.place_id}` as any);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not submit your review");
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="new-review-back">
          <Ionicons name="chevron-back" size={26} color={styles._icon.color} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add a review</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Place name *</Text>
          <TextInput style={styles.input} placeholder="e.g. Torchy's Tacos" placeholderTextColor={styles._muted.color} value={name} onChangeText={setName} testID="review-place-name" />

          <Text style={styles.label}>City</Text>
          <TextInput style={styles.input} placeholder="e.g. Dallas, TX" placeholderTextColor={styles._muted.color} value={city} onChangeText={setCity} testID="review-city" />

          <Text style={styles.label}>Category</Text>
          <View style={styles.catWrap}>
            {categories.map((cc) => (
              <TouchableOpacity key={cc.id} style={[styles.catChip, category === cc.label && styles.catChipActive]} onPress={() => setCategory(cc.label)}>
                <Text style={[styles.catChipText, category === cc.label && styles.catChipTextActive]}>{cc.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.catAdd} onPress={() => setShowNewCat((s) => !s)} testID="inline-add-category">
              <Ionicons name="add" size={15} color={styles._icon.color} />
              <Text style={styles.catAddText}>New</Text>
            </TouchableOpacity>
          </View>
          {showNewCat && (
            <View style={styles.newCatRow}>
              <TextInput style={[styles.input, { flex: 1, marginTop: 0 }]} placeholder="New category name" placeholderTextColor={styles._muted.color} value={newCat} onChangeText={setNewCat} testID="inline-new-cat-input" />
              <TouchableOpacity style={styles.newCatBtn} onPress={addCategoryInline}><Text style={styles.newCatBtnText}>Add</Text></TouchableOpacity>
            </View>
          )}

          <Text style={styles.label}>Your rating *</Text>
          <View style={{ marginTop: 4 }}><StarPicker value={rating} onChange={setRating} /></View>

          <Text style={styles.label}>Review</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="What made this a great (or not so great) spot for cheer families?"
            placeholderTextColor={styles._muted.color}
            value={body} onChangeText={setBody}
            multiline
            testID="review-body"
          />

          <PhotoGallery photos={photos} onChange={setPhotos} max={3} label="Photos (optional)" testIDPrefix="review-photos" />

          <TouchableOpacity style={styles.anonRow} onPress={() => setAnon((a) => !a)} testID="review-anon-toggle">
            <Ionicons name={anon ? "checkbox" : "square-outline"} size={22} color={anon ? styles._accent.color : styles._muted.color} />
            <Text style={styles.anonText}>Post anonymously (otherwise shown as your first name + last initial)</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={() => submit()} disabled={saving} testID="submit-review-btn">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Post review</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Alert.alert("Community Guidelines", GUIDELINES)} testID="guidelines-link">
            <Text style={styles.guidelinesLink}>By posting you agree to our Community Guidelines</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  _icon: { color: c.textPrimary },
  _muted: { color: c.textTertiary },
  _accent: { color: c.accent },
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  headerTitle: { fontSize: 18, fontWeight: "700" as const, color: c.textPrimary },
  label: { color: c.textSecondary, fontSize: 13, fontWeight: "700" as const, marginTop: 18, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 46, color: c.textPrimary, fontSize: 15, paddingVertical: 10 },
  textarea: { minHeight: 110, maxHeight: 220, textAlignVertical: "top" as const },
  catWrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, marginRight: 8, marginBottom: 8 },
  catChipActive: { backgroundColor: c.accent, borderColor: c.accent },
  catChipText: { color: c.textSecondary, fontSize: 13, fontWeight: "600" as const },
  catChipTextActive: { color: "#fff" },
  catAdd: { flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderStyle: "dashed" as const, borderColor: c.textTertiary, marginBottom: 8 },
  catAddText: { color: c.textPrimary, fontSize: 13, fontWeight: "600" as const, marginLeft: 2 },
  newCatRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginTop: 8 },
  newCatBtn: { backgroundColor: c.accent, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  newCatBtnText: { color: "#fff", fontWeight: "700" as const },
  anonRow: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 20, gap: 10 },
  anonText: { flex: 1, color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  submit: { backgroundColor: c.accent, height: 52, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const, marginTop: 28 },
  submitText: { color: "#fff", fontWeight: "700" as const, fontSize: 16 },
  guidelinesLink: { color: c.textTertiary, fontSize: 12, textAlign: "center" as const, marginTop: 12, textDecorationLine: "underline" as const },
});
