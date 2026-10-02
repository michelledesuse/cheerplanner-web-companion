import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, Modal, Image, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type Draft = {
  id: string;
  kind: "expense" | "booking" | "payment" | "unknown";
  source: string;
  summary: string;
  raw_excerpt: string;
  data: any;
  created_at: string;
};

type Athlete = { id: string; name: string };
type Competition = { id: string; name: string; event_date?: string; end_date?: string };
type OpenExpense = { id: string; athlete_id: string; category: string; amount: number; balance_due?: number; due_date?: string };

const PAY_METHODS = ["Venmo", "Zelle", "PayPal", "CashApp", "Card", "Cash", "Check", "Bank", "Other"];

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  flight: "airplane",
  hotel: "bed",
  car: "car-sport",
  expense: "wallet",
  payment: "cash",
  unknown: "help-circle",
};

const normName = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const tripDate = (data: any): string | null => {
  for (const k of ["depart_time", "check_in", "pickup_at"]) {
    const v = data?.[k];
    if (v) return String(v).slice(0, 10);
  }
  return null;
};

/** Attach a receipt to the athlete it names (full-name match, else first name). */
function matchAthleteId(data: any, athletes: Athlete[]): string {
  const hay = normName([data?.person, data?.note].filter(Boolean).join(" "));
  if (!hay) return "";
  let firstHit = "";
  for (const a of athletes) {
    const an = normName(a.name);
    if (!an) continue;
    if (hay.includes(an)) return a.id;
    const first = an.split(" ")[0];
    if (first.length >= 3 && new RegExp(`\\b${first}\\b`).test(hay)) firstHit = firstHit || a.id;
  }
  return firstHit;
}

/** Pick the competition whose dates line up with the trip (overlap or within N days). */
function matchCompetitionId(data: any, comps: Competition[], windowDays = 3): string {
  const d = tripDate(data);
  if (!d) return "";
  const bd = new Date(`${d}T00:00:00`);
  if (isNaN(bd.getTime())) return "";
  const DAY = 86400000;
  let best = "";
  let bestDiff = Infinity;
  for (const c of comps) {
    if (!c.event_date) continue;
    const s = new Date(`${String(c.event_date).slice(0, 10)}T00:00:00`);
    const e = new Date(`${String(c.end_date || c.event_date).slice(0, 10)}T00:00:00`);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) continue;
    if (bd.getTime() >= s.getTime() - windowDays * DAY && bd.getTime() <= e.getTime() + windowDays * DAY) {
      const diff = bd < s ? Math.round((s.getTime() - bd.getTime()) / DAY)
        : bd > e ? Math.round((bd.getTime() - e.getTime()) / DAY) : 0;
      if (diff < bestDiff) { best = c.id; bestDiff = diff; }
    }
  }
  return best;
}

/** Pick the open expense a payment should auto-apply to (same athlete, closest balance). */
function matchExpenseId(athleteId: string, amount: number, expenses: OpenExpense[]): string {
  if (!athleteId || !(amount > 0)) return "";
  const cands = expenses.filter((e) => e.athlete_id === athleteId && (e.balance_due ?? 0) > 0.009);
  if (cands.length === 0) return "";
  const exactBal = cands.find((e) => Math.abs((e.balance_due ?? 0) - amount) < 0.01);
  if (exactBal) return exactBal.id;
  const exactAmt = cands.find((e) => Math.abs((e.amount ?? 0) - amount) < 0.01);
  if (exactAmt) return exactAmt.id;
  cands.sort((a, b) => Math.abs((a.balance_due ?? 0) - amount) - Math.abs((b.balance_due ?? 0) - amount));
  return cands[0].id;
}

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
  const [copied, setCopied] = useState(false);

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [openExpenses, setOpenExpenses] = useState<OpenExpense[]>([]);

  // review modal state
  const [review, setReview] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [athleteId, setAthleteId] = useState<string>("");
  const [competitionId, setCompetitionId] = useState<string>("");
  const [expenseId, setExpenseId] = useState<string>("");
  const [autoAthlete, setAutoAthlete] = useState(false);
  const [autoComp, setAutoComp] = useState(false);
  const [autoExpense, setAutoExpense] = useState(false);

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
    api.get("/expenses").then(({ data }) => setOpenExpenses((data || []).filter((e: OpenExpense) => (e.balance_due ?? 0) > 0.009))).catch(() => {});
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

  const copyAddress = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
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
      const items: Draft[] = Array.isArray(data) ? data : [data];
      setDrafts((prev) => [...items, ...prev]);
      const unknowns = items.filter((i) => i.kind === "unknown").length;
      if (items.length === 0) {
        Alert.alert("Hmm", "I couldn't find a booking or expense in that. Try pasting more of the confirmation.");
      } else if (unknowns === items.length) {
        Alert.alert("Hmm", "I couldn't tell if that's travel or an expense. You can still open it and set it manually.");
      } else if (items.length > 1) {
        Alert.alert("Found a few", `I split that into ${items.length} items — review and add them below.`);
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
      const matchedComp = matchCompetitionId(data, competitions);
      setCompetitionId(matchedComp);
      setAutoComp(!!matchedComp);
      setAthleteId("");
      setAutoAthlete(false);
      setExpenseId("");
      setAutoExpense(false);
    } else if (d.kind === "payment") {
      const amt = data.amount != null ? Number(data.amount) : 0;
      setForm({
        amount: data.amount != null ? String(data.amount) : "",
        method: PAY_METHODS.includes(data.method) ? data.method : (data.method ? "Other" : ""),
        paid_on: data.paid_on || new Date().toISOString().slice(0, 10),
        note: [data.payee, data.note].filter(Boolean).join(" — "),
      });
      const matchedAthlete = matchAthleteId(data, athletes);
      setAthleteId(matchedAthlete);
      setAutoAthlete(!!matchedAthlete);
      const matchedExp = matchedAthlete ? matchExpenseId(matchedAthlete, amt, openExpenses) : "";
      setExpenseId(matchedExp);
      setAutoExpense(!!matchedExp);
      setCompetitionId("");
      setAutoComp(false);
    } else {
      setForm({
        category: data.category || "Misc",
        amount: data.amount != null ? String(data.amount) : "",
        incurred_on: data.incurred_on || new Date().toISOString().slice(0, 10),
        due_date: data.due_date || "",
        note: [data.vendor, data.note].filter(Boolean).join(" — "),
      });
      const matchedAthlete = matchAthleteId(data, athletes);
      setAthleteId(matchedAthlete);
      setAutoAthlete(!!matchedAthlete);
      setCompetitionId("");
      setAutoComp(false);
      setExpenseId("");
      setAutoExpense(false);
    }
  };

  const closeReview = () => {
    setReview(null);
    setForm({});
    setAthleteId("");
    setCompetitionId("");
    setExpenseId("");
    setAutoAthlete(false);
    setAutoComp(false);
    setAutoExpense(false);
  };

  const confirm = async () => {
    if (!review) return;
    const kind = review.kind === "booking" ? "booking" : review.kind === "payment" ? "payment" : "expense";

    if (kind === "expense") {
      if (!athleteId) { Alert.alert("Pick an athlete", "Choose who this expense is for."); return; }
      if (!form.amount || isNaN(Number(form.amount))) { Alert.alert("Amount needed", "Enter a valid amount."); return; }
    } else if (kind === "payment") {
      if (!athleteId) { Alert.alert("Pick an athlete", "Choose who this payment is for."); return; }
      if (!form.amount || isNaN(Number(form.amount))) { Alert.alert("Amount needed", "Enter a valid amount."); return; }
    } else {
      if (!competitionId) { Alert.alert("Pick a competition", "Choose which competition this trip is for."); return; }
    }

    setSaving(true);
    try {
      if (kind === "booking") {
        // Duplicate guard — warn if this looks like a booking already on the comp.
        try {
          const { data: dc } = await api.get(`/inbox/drafts/${review.id}/dup-check`, {
            params: { competition_id: competitionId },
          });
          if (dc?.duplicate) {
            const proceed = await new Promise<boolean>((resolve) => {
              Alert.alert(
                "Looks like a duplicate",
                "A similar booking is already on this competition. Add it anyway?",
                [
                  { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                  { text: "Add anyway", style: "destructive", onPress: () => resolve(true) },
                ],
              );
            });
            if (!proceed) { setSaving(false); return; }
          }
        } catch { /* non-blocking — proceed if the check fails */ }
      }

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
      } else if (kind === "payment") {
        body.payment = {
          athlete_id: athleteId,
          amount: Number(form.amount),
          paid_on: form.paid_on || new Date().toISOString().slice(0, 10),
          method: form.method || undefined,
          note: form.note || undefined,
          applied_expense_ids: expenseId ? [expenseId] : [],
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
      const didApply = kind === "payment" && !!expenseId;
      closeReview();
      Alert.alert("Added", kind === "expense" ? "Expense saved." : kind === "payment" ? (didApply ? "Payment saved and applied to the matched expense." : "Payment saved.") : "Travel booking saved.");
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
      const parts = [`Added ${data.created} item${data.created === 1 ? "" : "s"}.`];
      if (data.duplicates?.length) parts.push(`${data.duplicates.length} skipped as duplicate${data.duplicates.length === 1 ? "" : "s"}.`);
      if (data.skipped?.length) parts.push(`${data.skipped.length} left for review.`);
      Alert.alert("Done", parts.join(" "));
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
    if (d.kind === "payment") return "cash";
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
            Paste a flight/hotel confirmation, a receipt, or a payment confirmation (or drop a
            screenshot) and I&apos;ll draft it as travel, an expense, or a payment for you to confirm.
            A payment can auto-mark its matching expense paid.
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
              <View style={styles.emailTopRow}>
                <Ionicons name="mail-outline" size={18} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.emailLabel}>Forward emails to</Text>
                  <Text style={styles.emailAddr} selectable>{address}</Text>
                </View>
                <TouchableOpacity onPress={copyAddress} style={styles.copyBtn} testID="inbox-copy-address">
                  <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color={colors.accent} />
                  <Text style={styles.copyBtnText}>{copied ? "Copied" : "Copy"}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.emailHint}>
                Forward any flight, hotel, or receipt email here and it&apos;ll land below as a draft to confirm.
              </Text>
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
                        {d.kind === "booking" ? (d.data?.type || "travel") : d.kind === "expense" ? "expense" : d.kind === "payment" ? "payment" : "unknown"}
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
                {review?.kind === "booking" ? "Add travel booking" : review?.kind === "payment" ? "Add payment" : "Add expense"}
              </Text>
              <TouchableOpacity onPress={closeReview}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {review?.kind === "booking" ? (
                <>
                  <Text style={styles.label}>Competition</Text>
                  {autoComp && <Text style={styles.autoHint}>✨ Auto-matched by the trip dates — tap another to change.</Text>}
                  <View style={styles.chipWrap}>
                    {competitions.length === 0 && <Text style={styles.hint}>No competitions yet — add one first.</Text>}
                    {competitions.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, competitionId === c.id && styles.chipActive]}
                        onPress={() => { setCompetitionId(c.id); setAutoComp(false); }}
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
                      <Text style={styles.detailTitle}>Also captured (saved with this booking)</Text>
                      {review.data.flight_number ? <Text style={styles.detailText}>Flight {review.data.flight_number}: {review.data.depart_airport || "?"} → {review.data.arrive_airport || "?"}</Text> : null}
                      {review.data.depart_time ? <Text style={styles.detailText}>Departs {review.data.depart_time}{review.data.arrive_time ? ` · Arrives ${review.data.arrive_time}` : ""}</Text> : null}
                      {review.data.return_flight_number ? <Text style={styles.detailText}>Return {review.data.return_flight_number}: {review.data.return_depart_airport || "?"} → {review.data.return_arrive_airport || "?"}</Text> : null}
                      {review.data.return_depart_time ? <Text style={styles.detailText}>Returns {review.data.return_depart_time}{review.data.return_arrive_time ? ` · Arrives ${review.data.return_arrive_time}` : ""}</Text> : null}
                      {review.data.address ? <Text style={styles.detailText}>Address: {review.data.address}</Text> : null}
                      {review.data.check_in ? <Text style={styles.detailText}>Check-in {review.data.check_in}{review.data.check_in_time ? ` ${review.data.check_in_time}` : ""} · Check-out {review.data.check_out || "?"}{review.data.check_out_time ? ` ${review.data.check_out_time}` : ""}</Text> : null}
                      {review.data.cancel_by ? <Text style={styles.detailText}>Free cancel by {review.data.cancel_by}</Text> : null}
                      {review.data.pickup_at ? <Text style={styles.detailText}>Pickup {review.data.pickup_at} @ {review.data.pickup_location || "?"}</Text> : null}
                      {review.data.dropoff_at ? <Text style={styles.detailText}>Drop-off {review.data.dropoff_at} @ {review.data.dropoff_location || "?"}</Text> : null}
                      {review.data.outbound_cost != null ? <Text style={styles.detailText}>Outbound cost ${review.data.outbound_cost}{review.data.return_cost != null ? ` · Return $${review.data.return_cost}` : ""}</Text> : null}
                      {review.data.amount_paid ? <Text style={styles.detailText}>Paid ${review.data.amount_paid}{review.data.balance_due_date ? ` · Balance due ${review.data.balance_due_date}` : ""}</Text> : null}
                      {review.data.notes ? <Text style={styles.detailText}>Notes: {review.data.notes}</Text> : null}
                    </View>
                  )}
                </>
              ) : review?.kind === "payment" ? (
                <>
                  <Text style={styles.label}>Athlete</Text>
                  {autoAthlete && <Text style={styles.autoHint}>✨ Auto-matched from the payment — tap another to change.</Text>}
                  <View style={styles.chipWrap}>
                    {athletes.length === 0 && <Text style={styles.hint}>No athletes yet — add one first.</Text>}
                    {athletes.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, athleteId === a.id && styles.chipActive]}
                        onPress={() => {
                          setAthleteId(a.id); setAutoAthlete(false);
                          const m = matchExpenseId(a.id, Number(form.amount) || 0, openExpenses);
                          setExpenseId(m); setAutoExpense(!!m);
                        }}
                      >
                        <Text style={[styles.chipText, athleteId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Field label="Amount" value={form.amount} onChange={(v) => setForm((f: any) => ({ ...f, amount: v }))} keyboardType="decimal-pad" styles={styles} />

                  <Text style={styles.label}>Method</Text>
                  <View style={styles.chipWrap}>
                    {PAY_METHODS.map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.chip, form.method === m && styles.chipActive]}
                        onPress={() => setForm((f: any) => ({ ...f, method: m }))}
                      >
                        <Text style={[styles.chipText, form.method === m && styles.chipTextActive]}>{m}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Field label="Paid on (YYYY-MM-DD)" value={form.paid_on} onChange={(v) => setForm((f: any) => ({ ...f, paid_on: v }))} styles={styles} />
                  <Field label="Note" value={form.note} onChange={(v) => setForm((f: any) => ({ ...f, note: v }))} styles={styles} />

                  <Text style={styles.label}>Apply to an expense (marks it paid)</Text>
                  {autoExpense && <Text style={styles.autoHint}>✨ Auto-matched to an open expense by amount — tap to change, or “None” to just log the payment.</Text>}
                  <View style={styles.chipWrap}>
                    <TouchableOpacity
                      style={[styles.chip, !expenseId && styles.chipActive]}
                      onPress={() => { setExpenseId(""); setAutoExpense(false); }}
                    >
                      <Text style={[styles.chipText, !expenseId && styles.chipTextActive]}>None</Text>
                    </TouchableOpacity>
                    {openExpenses.filter((e) => !athleteId || e.athlete_id === athleteId).length === 0 && (
                      <Text style={styles.hint}>No open expenses for this athlete.</Text>
                    )}
                    {openExpenses.filter((e) => !athleteId || e.athlete_id === athleteId).map((e) => (
                      <TouchableOpacity
                        key={e.id}
                        style={[styles.chip, expenseId === e.id && styles.chipActive]}
                        onPress={() => { setExpenseId(e.id); setAutoExpense(false); }}
                      >
                        <Text style={[styles.chipText, expenseId === e.id && styles.chipTextActive]}>
                          {e.category} · ${Number(e.balance_due ?? e.amount).toFixed(0)} due
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Athlete</Text>
                  {autoAthlete && <Text style={styles.autoHint}>✨ Auto-matched from the receipt — tap another to change.</Text>}
                  <View style={styles.chipWrap}>
                    {athletes.length === 0 && <Text style={styles.hint}>No athletes yet — add one first.</Text>}
                    {athletes.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, athleteId === a.id && styles.chipActive]}
                        onPress={() => { setAthleteId(a.id); setAutoAthlete(false); }}
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
                I&apos;ll auto-match receipts to the athlete they name and trips to the competition whose dates line up. Pick fallbacks below for anything I can&apos;t place, and I&apos;ll skip any trip already on its competition.
              </Text>

              {drafts.some((d) => d.kind === "expense") && (
                <>
                  <Text style={styles.label}>Athlete (fallback for expenses)</Text>
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
                  <Text style={styles.label}>Competition (fallback for travel)</Text>
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
  emailCard: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md, gap: spacing.sm },
  emailTopRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  emailLabel: { ...typography.caption, color: colors.textTertiary },
  emailAddr: { ...typography.bodyMedium, color: colors.textPrimary },
  emailHint: { ...typography.caption, color: colors.textSecondary },
  copyBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSubtle },
  copyBtnText: { ...typography.caption, color: colors.accent, fontWeight: "700" as const },
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
  autoHint: { ...typography.caption, color: colors.accent, marginBottom: 6 },
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
