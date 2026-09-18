import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, Modal, Image, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type Draft = {
  id: string;
  kind: "expense" | "booking" | "unknown";
  source: string;
  summary: string;
  raw_excerpt: string;
  data: any;
  created_at: string;
};

type Athlete = { id: string; name: string };
type Competition = { id: string; name: string };

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  flight: "airplane",
  hotel: "bed",
  car: "car-sport",
  expense: "wallet",
  unknown: "help-circle",
};

export default function InboxScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [pasteText, setPasteText] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [address, setAddress] = useState<string | null>(null);

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  // review modal state
  const [review, setReview] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [athleteId, setAthleteId] = useState<string>("");
  const [competitionId, setCompetitionId] = useState<string>("");

  // bulk "add all" state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkAthleteId, setBulkAthleteId] = useState<string>("");
  const [bulkCompId, setBulkCompId] = useState<string>("");

  const loadDrafts = useCallback(async () => {
    try {
      const { data } = await api.get("/inbox/drafts");
      setDrafts(data || []);
    } catch (_e) {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
    api.get("/inbox/address").then(({ data }) => {
      if (data?.configured && data?.address) setAddress(data.address);
    }).catch(() => {});
    api.get("/athletes").then(({ data }) => setAthletes(data || [])).catch(() => {});
    api.get("/competitions").then(({ data }) => setCompetitions(data || [])).catch(() => {});
    api.get("/expenses/categories").then(({ data }) => setCategories(data?.categories || [])).catch(() => {});
  }, [loadDrafts]);

  const pickScreenshot = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert(
            "Photo access needed",
            "Enable photo access in Settings to add a screenshot.",
            [{ text: "OK" }]
          );
        }
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });
      if (!res.canceled && res.assets[0]?.base64) {
        const a = res.assets[0];
        setImageData(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
      }
    } catch (_e) {
      Alert.alert("Error", "Could not load image.");
    }
  };

  const parse = async () => {
    if (!pasteText.trim() && !imageData) {
      Alert.alert("Nothing to read", "Paste some text or add a screenshot first.");
      return;
    }
    setParsing(true);
    try {
      const { data } = await api.post("/inbox/parse", {
        text: pasteText.trim() || undefined,
        image_base64: imageData || undefined,
        source: imageData ? "screenshot" : "paste",
      });
      setPasteText("");
      setImageData(null);
      setDrafts((prev) => [data, ...prev]);
      if (data.kind === "unknown") {
        Alert.alert("Hmm", "I couldn't tell if that's travel or an expense. You can still open it and set it manually.");
      }
    } catch (e: any) {
      Alert.alert("Couldn't read that", e?.response?.data?.detail || "Please try again.");
    } finally {
      setParsing(false);
    }
  };

  const openReview = (d: Draft) => {
    setReview(d);
    const data = d.data || {};
    if (d.kind === "booking") {
      setForm({
        type: data.type || "flight",
        provider: data.provider || "",
        confirmation: data.confirmation || "",
        cost: data.cost != null ? String(data.cost) : "",
      });
      setCompetitionId("");
    } else {
      setForm({
        category: data.category || "Misc",
        amount: data.amount != null ? String(data.amount) : "",
        incurred_on: data.incurred_on || new Date().toISOString().slice(0, 10),
        due_date: data.due_date || "",
        note: [data.vendor, data.note].filter(Boolean).join(" — "),
      });
      setAthleteId("");
    }
  };

  const closeReview = () => {
    setReview(null);
    setForm({});
    setAthleteId("");
    setCompetitionId("");
  };

  const confirm = async () => {
    if (!review) return;
    const kind = review.kind === "booking" ? "booking" : "expense";

    if (kind === "expense") {
      if (!athleteId) { Alert.alert("Pick an athlete", "Choose who this expense is for."); return; }
      if (!form.amount || isNaN(Number(form.amount))) { Alert.alert("Amount needed", "Enter a valid amount."); return; }
    } else {
      if (!competitionId) { Alert.alert("Pick a competition", "Choose which competition this trip is for."); return; }
    }

    setSaving(true);
    try {
      const body: any = { kind };
      if (kind === "expense") {
        body.expense = {
          athlete_id: athleteId,
          category: form.category || "Misc",
          amount: Number(form.amount),
          incurred_on: form.incurred_on,
          due_date: form.due_date || undefined,
          note: form.note || undefined,
        };
      } else {
        body.booking = {
          ...(review.data || {}),
          competition_id: competitionId,
          type: form.type,
          provider: form.provider || undefined,
          confirmation: form.confirmation || undefined,
          cost: form.cost ? Number(form.cost) : undefined,
        };
        delete body.booking.vendor;
      }
      await api.post(`/inbox/drafts/${review.id}/confirm`, body);
      setDrafts((prev) => prev.filter((x) => x.id !== review.id));
      closeReview();
      Alert.alert("Added", kind === "expense" ? "Expense saved." : "Travel booking saved.");
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.response?.data?.detail || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmAll = async () => {
    setBulkSaving(true);
    try {
      const { data } = await api.post("/inbox/drafts/confirm-all", {
        athlete_id: bulkAthleteId || undefined,
        competition_id: bulkCompId || undefined,
      });
      setBulkOpen(false);
      setBulkAthleteId("");
      setBulkCompId("");
      await loadDrafts();
      const msg = `Added ${data.created} item${data.created === 1 ? "" : "s"}.` +
        (data.skipped?.length ? ` ${data.skipped.length} left for review.` : "");
      Alert.alert("Done", msg);
    } catch (e: any) {
      Alert.alert("Couldn't add", e?.response?.data?.detail || "Please try again.");
    } finally {
      setBulkSaving(false);
    }
  };

  const dismiss = (d: Draft) => {
    Alert.alert("Dismiss this?", d.summary || "Remove from inbox", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Dismiss",
        style: "destructive",
        onPress: async () => {
          setDrafts((prev) => prev.filter((x) => x.id !== d.id));
          try { await api.delete(`/inbox/drafts/${d.id}`); } catch (_e) {}
        },
      },
    ]);
  };

  const iconFor = (d: Draft): keyof typeof Ionicons.glyphMap => {
    if (d.kind === "booking") return KIND_ICON[d.data?.type] || "airplane";
    if (d.kind === "expense") return "wallet";
    return "help-circle";
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="inbox-back">
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Smart Inbox</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadDrafts(); }} tintColor={colors.accent} />
          }
        >
          <Text style={styles.lede}>
            Paste a flight/hotel confirmation or a receipt (or drop a screenshot) and I&apos;ll
            draft it as travel or an expense for you to confirm.
          </Text>

          {/* Composer */}
          <View style={styles.card}>
            <TextInput
              style={styles.input}
              placeholder="Paste booking or receipt text here…"
              placeholderTextColor={colors.textTertiary}
              value={pasteText}
              onChangeText={setPasteText}
              multiline
              testID="inbox-paste"
            />
            {imageData && (
              <View style={styles.thumbRow}>
                <Image source={{ uri: imageData }} style={styles.thumb} />
                <TouchableOpacity onPress={() => setImageData(null)} style={styles.thumbX}>
                  <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.composerActions}>
              <TouchableOpacity onPress={pickScreenshot} style={styles.ghostBtn} testID="inbox-screenshot">
                <Ionicons name="image-outline" size={18} color={colors.accent} />
                <Text style={styles.ghostBtnText}>{imageData ? "Change screenshot" : "Add screenshot"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={parse}
                style={[styles.primaryBtn, parsing && { opacity: 0.6 }]}
                disabled={parsing}
                testID="inbox-read"
              >
                {parsing ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="sparkles" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Read it</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {address && (
            <View style={styles.emailCard}>
              <Ionicons name="mail-outline" size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.emailLabel}>Forward emails to</Text>
                <Text style={styles.emailAddr} selectable>{address}</Text>
              </View>
            </View>
          )}

          {/* Drafts */}
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Waiting for review</Text>
            {drafts.length > 1 && (
              <TouchableOpacity onPress={() => setBulkOpen(true)} style={styles.addAllBtn} testID="inbox-add-all">
                <Ionicons name="checkmark-done" size={16} color={colors.accent} />
                <Text style={styles.addAllText}>Add all</Text>
              </TouchableOpacity>
            )}
          </View>
          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
          ) : drafts.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.emptyText}>Nothing waiting. Paste something above to get started.</Text>
            </View>
          ) : (
            drafts.map((d) => (
              <View key={d.id} style={styles.draft} testID={`draft-${d.id}`}>
                <View style={styles.draftIcon}>
                  <Ionicons name={iconFor(d)} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.badgeRow}>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {d.kind === "booking" ? (d.data?.type || "travel") : d.kind === "expense" ? "expense" : "unknown"}
                      </Text>
                    </View>
                    {d.source === "email" && <Ionicons name="mail" size={12} color={colors.textTertiary} />}
                    {d.source === "screenshot" && <Ionicons name="image" size={12} color={colors.textTertiary} />}
                  </View>
                  <Text style={styles.draftSummary} numberOfLines={2}>{d.summary || "Untitled"}</Text>
                  <View style={styles.draftActions}>
                    <TouchableOpacity onPress={() => openReview(d)} style={styles.reviewBtn} testID={`review-${d.id}`}>
                      <Text style={styles.reviewBtnText}>Review &amp; add</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => dismiss(d)} style={styles.dismissBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Review modal */}
      <Modal visible={!!review} animationType="slide" transparent onRequestClose={closeReview}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {review?.kind === "booking" ? "Add travel booking" : "Add expense"}
              </Text>
              <TouchableOpacity onPress={closeReview}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {review?.kind === "booking" ? (
                <>
                  <Text style={styles.label}>Competition</Text>
                  <View style={styles.chipWrap}>
                    {competitions.length === 0 && <Text style={styles.hint}>No competitions yet — add one first.</Text>}
                    {competitions.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, competitionId === c.id && styles.chipActive]}
                        onPress={() => setCompetitionId(c.id)}
                      >
                        <Text style={[styles.chipText, competitionId === c.id && styles.chipTextActive]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>Type</Text>
                  <View style={styles.chipWrap}>
                    {["flight", "hotel", "car"].map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.chip, form.type === t && styles.chipActive]}
                        onPress={() => setForm((f: any) => ({ ...f, type: t }))}
                      >
                        <Text style={[styles.chipText, form.type === t && styles.chipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Field label="Provider" value={form.provider} onChange={(v) => setForm((f: any) => ({ ...f, provider: v }))} styles={styles} />
                  <Field label="Confirmation #" value={form.confirmation} onChange={(v) => setForm((f: any) => ({ ...f, confirmation: v }))} styles={styles} />
                  <Field label="Cost" value={form.cost} onChange={(v) => setForm((f: any) => ({ ...f, cost: v }))} keyboardType="decimal-pad" styles={styles} />

                  {!!review?.data && (
                    <View style={styles.detailBox}>
                      <Text style={styles.detailTitle}>Also captured</Text>
                      {review.data.flight_number ? <Text style={styles.detailText}>Flight {review.data.flight_number}: {review.data.depart_airport} → {review.data.arrive_airport}</Text> : null}
                      {review.data.depart_time ? <Text style={styles.detailText}>Departs {review.data.depart_time}</Text> : null}
                      {review.data.check_in ? <Text style={styles.detailText}>Check-in {review.data.check_in} · Check-out {review.data.check_out || "?"}</Text> : null}
                      {review.data.pickup_at ? <Text style={styles.detailText}>Pickup {review.data.pickup_at} @ {review.data.pickup_location || "?"}</Text> : null}
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.label}>Athlete</Text>
                  <View style={styles.chipWrap}>
                    {athletes.length === 0 && <Text style={styles.hint}>No athletes yet — add one first.</Text>}
                    {athletes.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, athleteId === a.id && styles.chipActive]}
                        onPress={() => setAthleteId(a.id)}
                      >
                        <Text style={[styles.chipText, athleteId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>Category</Text>
                  <View style={styles.chipWrap}>
                    {categories.map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.chip, form.category === c && styles.chipActive]}
                        onPress={() => setForm((f: any) => ({ ...f, category: c }))}
                      >
                        <Text style={[styles.chipText, form.category === c && styles.chipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Field label="Amount" value={form.amount} onChange={(v) => setForm((f: any) => ({ ...f, amount: v }))} keyboardType="decimal-pad" styles={styles} />
                  <Field label="Date (YYYY-MM-DD)" value={form.incurred_on} onChange={(v) => setForm((f: any) => ({ ...f, incurred_on: v }))} styles={styles} />
                  <Field label="Due date (optional)" value={form.due_date} onChange={(v) => setForm((f: any) => ({ ...f, due_date: v }))} styles={styles} />
                  <Field label="Note" value={form.note} onChange={(v) => setForm((f: any) => ({ ...f, note: v }))} styles={styles} />
                </>
              )}

              <TouchableOpacity onPress={confirm} style={[styles.primaryBtn, styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} testID="inbox-confirm">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add all modal */}
      <Modal visible={bulkOpen} animationType="slide" transparent onRequestClose={() => setBulkOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add all ({drafts.length})</Text>
              <TouchableOpacity onPress={() => setBulkOpen(false)}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.lede}>
                Pick who the expenses are for and which competition the travel belongs to, and I&apos;ll add them all at once. Anything I can&apos;t place is left here for you.
              </Text>

              {drafts.some((d) => d.kind === "expense") && (
                <>
                  <Text style={styles.label}>Athlete (for expenses)</Text>
                  <View style={styles.chipWrap}>
                    {athletes.length === 0 && <Text style={styles.hint}>No athletes yet.</Text>}
                    {athletes.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, bulkAthleteId === a.id && styles.chipActive]}
                        onPress={() => setBulkAthleteId(a.id)}
                      >
                        <Text style={[styles.chipText, bulkAthleteId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {drafts.some((d) => d.kind === "booking") && (
                <>
                  <Text style={styles.label}>Competition (for travel)</Text>
                  <View style={styles.chipWrap}>
                    {competitions.length === 0 && <Text style={styles.hint}>No competitions yet.</Text>}
                    {competitions.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, bulkCompId === c.id && styles.chipActive]}
                        onPress={() => setBulkCompId(c.id)}
                      >
                        <Text style={[styles.chipText, bulkCompId === c.id && styles.chipTextActive]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <TouchableOpacity onPress={confirmAll} style={[styles.primaryBtn, styles.saveBtn, bulkSaving && { opacity: 0.6 }]} disabled={bulkSaving} testID="inbox-add-all-confirm">
                {bulkSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add {drafts.length} item{drafts.length === 1 ? "" : "s"}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, keyboardType, styles }: {
  label: string; value: string; onChange: (v: string) => void; keyboardType?: any; styles: any;
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholderTextColor={colors.textTertiary}
      />
    </>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  iconBtn: { width: 36, height: 36, alignItems: "center" as const, justifyContent: "center" as const },
  lede: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  input: { ...typography.body, color: colors.textPrimary, minHeight: 90, textAlignVertical: "top" as const },
  thumbRow: { flexDirection: "row" as const, marginTop: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  thumbX: { marginLeft: -12, marginTop: -6 },
  composerActions: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginTop: spacing.md },
  ghostBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  ghostBtnText: { ...typography.bodyMedium, color: colors.accent },
  primaryBtn: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, backgroundColor: colors.accent, paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: radius.md, minWidth: 110 },
  primaryBtnText: { ...typography.bodyMedium, color: "#fff", fontWeight: "700" as const },
  emailCard: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md },
  emailLabel: { ...typography.caption, color: colors.textTertiary },
  emailAddr: { ...typography.bodyMedium, color: colors.textPrimary },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginTop: spacing.xl, marginBottom: spacing.sm },
  addAllBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSubtle },
  addAllText: { ...typography.caption, color: colors.accent, fontWeight: "700" as const },
  empty: { alignItems: "center" as const, paddingVertical: spacing.xl, gap: 8 },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: "center" as const, paddingHorizontal: spacing.xl },
  draft: { flexDirection: "row" as const, gap: 12, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  draftIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSubtle, alignItems: "center" as const, justifyContent: "center" as const },
  badgeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: 4 },
  badge: { backgroundColor: colors.accentSubtle, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { ...typography.caption, color: colors.accent, fontWeight: "700" as const, textTransform: "capitalize" as const },
  draftSummary: { ...typography.bodyMedium, color: colors.textPrimary, marginBottom: spacing.sm },
  draftActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
  reviewBtn: { backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md },
  reviewBtnText: { ...typography.caption, color: "#fff", fontWeight: "700" as const },
  dismissBtn: { padding: 6 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" as const },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "90%" as const },
  sheetHeader: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" as const, marginTop: spacing.md, marginBottom: 6 },
  hint: { ...typography.caption, color: colors.textTertiary },
  chipWrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textSecondary, textTransform: "capitalize" as const },
  chipTextActive: { color: "#fff", fontWeight: "700" as const },
  fieldInput: { ...typography.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.card },
  detailBox: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md, gap: 4 },
  detailTitle: { ...typography.caption, color: colors.textTertiary, fontWeight: "700" as const, marginBottom: 2 },
  detailText: { ...typography.caption, color: colors.textSecondary },
  saveBtn: { marginTop: spacing.xl },
});
