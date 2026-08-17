import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl,
  TextInput, Alert, Modal, Switch, KeyboardAvoidingView, Platform, Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import ManageAccessButton from "@/src/components/ManageAccessButton";
import DateField from "@/src/components/DateField";
import TimeField from "@/src/components/TimeField";
import PhotoGallery from "@/src/components/PhotoGallery";
import LinksEditor, { cleanLinks, type ExternalLink } from "@/src/components/LinksEditor";
import { exportAoa } from "@/src/utils/exportFile";

type QType = "text" | "paragraph" | "choice" | "multi" | "yesno" | "number";
type Question = { id?: string; label: string; type: QType; options: string[]; required: boolean };
type Member = { id: string; name: string; answered: boolean; answers: Record<string, any>; submitted_at?: string };
type Tally = { question_id: string; label: string; type: QType; counts?: { value: string; count: number }[]; answers?: string[]; sum?: number; avg?: number; answered: number };
type Detail = {
  id: string; name: string; description?: string; locked?: boolean; close_at?: string | null;
  questions: Question[]; tally: Tally[]; members: Member[];
  photos?: string[]; links?: ExternalLink[];
  summary: { response_count: number; member_total: number };
};

const TYPE_LABELS: Record<QType, string> = { text: "Short text", paragraph: "Paragraph", choice: "Multiple choice", multi: "Multi-select", yesno: "Yes / No", number: "Number" };
const TYPES: QType[] = ["choice", "multi", "yesno", "number", "text", "paragraph"];
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export default function FormDetailScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"tally" | "responses">("tally");

  // deadline
  const [closeDate, setCloseDate] = useState("");
  const [closeTime, setCloseTime] = useState("");
  useEffect(() => {
    const ca = data?.close_at;
    if (ca) { const [d, t] = String(ca).split("T"); setCloseDate(d || ""); setCloseTime((t || "").slice(0, 5)); }
    else { setCloseDate(""); setCloseTime(""); }
  }, [data?.close_at]);

  // photos & links
  const [photos, setPhotos] = useState<string[]>([]);
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [savingAttach, setSavingAttach] = useState(false);
  useEffect(() => {
    setPhotos(data?.photos || []);
    setLinks(data?.links || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  // question editor modal
  const [qOpen, setQOpen] = useState(false);
  const [editingQ, setEditingQ] = useState<Question | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const openDetails = () => { setNameDraft(data?.name || ""); setDescDraft(data?.description || ""); setDetailsOpen(true); };
  const saveDetails = async () => {
    const nm = nameDraft.trim();
    if (!nm) { Alert.alert("Name required", "Please enter a form name."); return; }
    await patch({ name: nm, description: descDraft.trim() });
    setDetailsOpen(false);
  };
  const [qIndex, setQIndex] = useState<number>(-1);

  // response modal
  const [respMember, setRespMember] = useState<Member | null>(null);
  const [respAnswers, setRespAnswers] = useState<Record<string, any>>({});
  const [savingResp, setSavingResp] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get<Detail>(`/team/forms/${id}`);
      setData(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patch = async (body: any) => {
    try {
      const r = await api.patch<Detail>(`/team/forms/${id}`, body);
      setData(r.data);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.response?.data?.detail || "Please try again.");
      load();
    }
  };

  const toggleLock = (v: boolean) => { setData((d) => (d ? { ...d, locked: v } : d)); patch({ locked: v }); };

  // ---- question CRUD (send whole array) ----
  const openNewQ = () => { setEditingQ({ label: "", type: "choice", options: ["", ""], required: false }); setQIndex(-1); setQOpen(true); };
  const openEditQ = (q: Question, i: number) => { setEditingQ({ ...q, options: [...(q.options || [])] }); setQIndex(i); setQOpen(true); };

  const saveQ = () => {
    if (!editingQ || !data) return;
    const label = editingQ.label.trim();
    if (!label) { Alert.alert("Question text required"); return; }
    let opts = (editingQ.options || []).map((o) => o.trim()).filter(Boolean);
    if ((editingQ.type === "choice" || editingQ.type === "multi") && opts.length < 2) {
      Alert.alert("Add options", "Add at least two answer options."); return;
    }
    if (editingQ.type !== "choice" && editingQ.type !== "multi") opts = [];
    const q: Question = { ...editingQ, label, options: opts };
    const questions = [...data.questions];
    if (qIndex >= 0) questions[qIndex] = { ...questions[qIndex], ...q };
    else questions.push(q);
    setQOpen(false); setEditingQ(null);
    patch({ questions });
  };

  const deleteQ = (i: number) => {
    if (!data) return;
    const doIt = () => patch({ questions: data.questions.filter((_, idx) => idx !== i) });
    if (Platform.OS === "web") { doIt(); return; }
    Alert.alert("Delete question?", "", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doIt }]);
  };

  // ---- responses ----
  const openResp = (m: Member) => {
    if (data?.locked) { Alert.alert("Form locked", "Unlock the form to edit responses."); return; }
    setRespMember(m); setRespAnswers({ ...(m.answers || {}) });
  };
  const setAns = (qid: string, val: any) => setRespAnswers((p) => ({ ...p, [qid]: val }));
  const toggleMulti = (qid: string, opt: string) => setRespAnswers((p) => {
    const cur: string[] = Array.isArray(p[qid]) ? p[qid] : [];
    return { ...p, [qid]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
  });
  const saveResp = async () => {
    if (!respMember) return;
    setSavingResp(true);
    try {
      const r = await api.put<Detail>(`/team/forms/${id}/response`, { member_id: respMember.id, answers: respAnswers });
      setData(r.data); setRespMember(null);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.response?.data?.detail || "Please try again.");
    } finally { setSavingResp(false); }
  };
  const clearResp = async () => {
    if (!respMember) return;
    try { const r = await api.delete<Detail>(`/team/forms/${id}/response/${respMember.id}`); setData(r.data); setRespMember(null); }
    catch (e: any) { Alert.alert("Couldn't clear", e?.response?.data?.detail || ""); }
  };

  // ---- share / remind / delete ----
  const shareLink = async () => {
    try {
      const r = await api.post<{ token: string; url?: string }>("/team/share", { kind: "form", ref_id: id });
      const url = r.data.url || `${BASE}/api/public/s/${r.data.token}`;
      await Share.share({ message: `Please fill out "${data?.name}" for our team (no app needed):\n${url}` });
    } catch (e: any) { Alert.alert("Couldn't create link", e?.response?.data?.detail || ""); }
  };
  const remind = async () => {
    const pending = data?.members.filter((m) => !m.answered).length ?? 0;
    if (pending === 0) { Alert.alert("All caught up", "Everyone has already responded."); return; }
    try {
      const r = await api.post<{ sent: number; no_phone: string[] }>(`/team/forms/${id}/remind`, { base_url: BASE });
      Alert.alert("Reminders sent", `Texted ${r.data.sent} parent${r.data.sent === 1 ? "" : "s"} who haven't responded yet.${(r.data.no_phone || []).length ? `\n\nNo phone on file: ${r.data.no_phone.join(", ")}` : ""}`);
    } catch (e: any) { Alert.alert("Couldn't send", e?.response?.data?.detail || ""); }
  };

  const saveDeadline = () => {
    if (!closeDate) { patch({ close_at: "" }); return; }
    const close_at = `${closeDate}T${closeTime || "23:59"}:00`;
    patch({ close_at });
  };
  const clearDeadline = () => { setCloseDate(""); setCloseTime(""); patch({ close_at: "" }); };

  const saveAttachments = async () => {
    setSavingAttach(true);
    try {
      const r = await api.patch<Detail>(`/team/forms/${id}`, { photos, links: cleanLinks(links) });
      setData(r.data);
      Alert.alert("Saved", "Photos & links updated. They'll show on the form and in the shared link.");
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.response?.data?.detail || "Please try again.");
    } finally { setSavingAttach(false); }
  };

  const exportResponses = async () => {
    if (!data) return;
    const fmt = (v: any) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));
    const header = ["Member", ...data.questions.map((q) => q.label), "Responded"];
    const rows = data.members.map((m) => [
      m.name,
      ...data.questions.map((q) => fmt(m.answers?.[q.id as string])),
      m.answered ? "Yes" : "No",
    ]);
    const safe = (data.name || "form").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    try { await exportAoa(`${safe}_responses`, [header, ...rows]); }
    catch (e: any) { Alert.alert("Couldn't export", e?.message || "Please try again."); }
  };
  const del = () => {
    const doIt = async () => { await api.delete(`/team/forms/${id}`); router.back(); };
    if (Platform.OS === "web") { doIt(); return; }
    Alert.alert("Delete form?", "This removes the form and all responses.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doIt }]);
  };

  const answerSummary = (m: Member): string => {
    if (!data) return "";
    const parts: string[] = [];
    for (const q of data.questions) {
      const v = m.answers?.[q.id as string];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
      parts.push(Array.isArray(v) ? v.join(", ") : String(v));
    }
    return parts.join(" · ");
  };

  if (loading || !data) {
    return <SafeAreaView style={styles.safe} edges={["top"]}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  const pendingCount = data.members.filter((m) => !m.answered).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="form-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{data.name}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <TouchableOpacity onPress={openDetails} style={styles.iconBtn} testID="form-edit-details" hitSlop={8}>
            <Ionicons name="create-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
          <ManageAccessButton resource="form" resourceId={data.id} />
          <TouchableOpacity onPress={del} style={styles.iconBtn} testID="form-delete" hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Edit form</Text>
            <Text style={styles.fieldLabel}>Form name</Text>
            <TextInput style={styles.input} value={nameDraft} onChangeText={setNameDraft} placeholder="e.g. Banquet Meal Order" placeholderTextColor={colors.textTertiary} testID="form-name-input" />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput style={[styles.input, styles.inputMulti]} value={descDraft} onChangeText={setDescDraft} placeholder="Optional details for your team" placeholderTextColor={colors.textTertiary} multiline testID="form-desc-input" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setDetailsOpen(false)} testID="form-details-cancel"><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={saveDetails} testID="form-details-save"><Text style={styles.submitText}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {data.description ? <Text style={styles.desc}>{data.description}</Text> : null}

        {/* Photos & links */}
        <View style={styles.attachCard}>
          <Text style={styles.attachTitle}>📎 Photos &amp; links</Text>
          <Text style={styles.attachHint}>Add reference photos (menus, size charts, flyers) and links. Photos show as images on the form and in the shared link.</Text>
          <PhotoGallery photos={photos} onChange={setPhotos} testIDPrefix="form-photo" />
          <LinksEditor value={links} onChange={setLinks} testIDPrefix="form-link" />
          <TouchableOpacity style={[styles.attachSave, savingAttach && { opacity: 0.6 }]} onPress={saveAttachments} disabled={savingAttach} testID="form-attach-save">
            {savingAttach ? <ActivityIndicator color="white" /> : <Text style={styles.attachSaveText}>Save photos &amp; links</Text>}
          </TouchableOpacity>
        </View>

        {/* Lock + actions */}
        <View style={styles.lockRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lockLabel}>Lock form</Text>
            <Text style={styles.lockHint}>{data.locked ? "Submissions & edits are closed." : "Stop new submissions & edits when your order is final."}</Text>
          </View>
          <Switch value={!!data.locked} onValueChange={toggleLock} trackColor={{ true: colors.accent, false: colors.border }} testID="form-lock-toggle" />
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={shareLink} testID="form-share"><Ionicons name="share-outline" size={16} color={colors.accent} /><Text style={styles.actionText}>Share link</Text></TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={remind} testID="form-remind"><Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} /><Text style={styles.actionText}>Remind{pendingCount ? ` (${pendingCount})` : ""}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={exportResponses} testID="form-export"><Ionicons name="download-outline" size={16} color={colors.accent} /><Text style={styles.actionText}>Download</Text></TouchableOpacity>
        </View>

        {/* Deadline & auto-lock */}
        <View style={styles.deadlineCard}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.deadlineTitle}>⏰ Deadline &amp; auto-lock</Text>
            {data.close_at ? <TouchableOpacity onPress={clearDeadline} testID="form-deadline-clear"><Text style={styles.clearLink}>Clear</Text></TouchableOpacity> : null}
          </View>
          <Text style={styles.deadlineHint}>{data.close_at ? "The form locks automatically at this time. Parents see a countdown." : "Optional — set a date/time to automatically stop submissions."}</Text>
          <View style={styles.deadlineRow}>
            <View style={{ flex: 1.3 }}><DateField value={closeDate} onChange={setCloseDate} testID="form-deadline-date" /></View>
            <View style={{ flex: 1 }}><TimeField value={closeTime} onChange={setCloseTime} testID="form-deadline-time" /></View>
          </View>
          <TouchableOpacity style={styles.deadlineSave} onPress={saveDeadline} testID="form-deadline-save"><Text style={styles.deadlineSaveText}>{closeDate ? "Save deadline" : "No deadline"}</Text></TouchableOpacity>
        </View>

        {/* Questions */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionHead}>QUESTIONS</Text>
          <TouchableOpacity onPress={openNewQ} testID="form-add-question"><Text style={styles.addLink}>+ Add question</Text></TouchableOpacity>
        </View>
        {data.questions.length === 0 ? (
          <Text style={styles.emptyText}>No questions yet. Add one to get started.</Text>
        ) : data.questions.map((q, i) => (
          <View key={q.id || i} style={styles.qRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.qLabel}>{q.label}{q.required ? " *" : ""}</Text>
              <Text style={styles.qMeta}>{TYPE_LABELS[q.type]}{q.options?.length ? ` · ${q.options.join(", ")}` : ""}</Text>
            </View>
            <TouchableOpacity onPress={() => openEditQ(q, i)} hitSlop={8} testID={`form-edit-q-${i}`}><Ionicons name="create-outline" size={18} color={colors.textSecondary} /></TouchableOpacity>
            <TouchableOpacity onPress={() => deleteQ(i)} hitSlop={8} testID={`form-del-q-${i}`}><Ionicons name="close" size={18} color={colors.textTertiary} /></TouchableOpacity>
          </View>
        ))}

        {/* Tally / Responses tabs */}
        {data.questions.length > 0 ? (
          <>
            <View style={styles.tabs}>
              <TouchableOpacity onPress={() => setTab("tally")} style={[styles.tab, tab === "tally" && styles.tabOn]} testID="form-tab-tally"><Text style={[styles.tabText, tab === "tally" && styles.tabTextOn]}>Tally</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setTab("responses")} style={[styles.tab, tab === "responses" && styles.tabOn]} testID="form-tab-responses"><Text style={[styles.tabText, tab === "responses" && styles.tabTextOn]}>Responses ({data.summary.response_count}/{data.summary.member_total})</Text></TouchableOpacity>
            </View>

            {tab === "tally" ? (
              <View style={{ gap: spacing.sm }}>
                {data.tally.map((t) => (
                  <View key={t.question_id} style={styles.tallyCard}>
                    <Text style={styles.tallyQ}>{t.label}</Text>
                    {t.type === "number" ? (
                      <Text style={styles.tallyLine}>{t.answered} answered · total {t.sum} · avg {t.avg}</Text>
                    ) : t.type === "text" || t.type === "paragraph" ? (
                      (t.answers && t.answers.length) ? t.answers.map((a, i) => <Text key={i} style={styles.tallyText}>• {a}</Text>) : <Text style={styles.tallyMuted}>No answers yet</Text>
                    ) : (
                      (t.counts && t.counts.length) ? t.counts.map((c) => (
                        <View key={c.value} style={styles.tallyLineRow}>
                          <Text style={styles.tallyCount}>{c.count}</Text>
                          <Text style={styles.tallyVal}>{c.value}</Text>
                        </View>
                      )) : <Text style={styles.tallyMuted}>No answers yet</Text>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {data.members.map((m) => (
                  <TouchableOpacity key={m.id} style={styles.respRow} onPress={() => openResp(m)} testID={`form-resp-${m.id}`}>
                    <View style={[styles.respDot, m.answered && styles.respDotOn]}>
                      {m.answered ? <Ionicons name="checkmark" size={13} color="white" /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.respName}>{m.name}</Text>
                      {m.answered ? <Text style={styles.respAns} numberOfLines={1}>{answerSummary(m) || "Responded"}</Text> : <Text style={styles.respPending}>No response yet</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>

      {/* Question editor modal */}
      <Modal visible={qOpen} transparent animationType="fade" onRequestClose={() => setQOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{qIndex >= 0 ? "Edit question" : "Add question"}</Text>
              <TextInput style={styles.input} value={editingQ?.label ?? ""} onChangeText={(t) => setEditingQ((q) => (q ? { ...q, label: t } : q))} placeholder="Question text" placeholderTextColor={colors.textTertiary} testID="form-q-label" />
              <Text style={styles.fieldLabel}>Answer type</Text>
              <View style={styles.typeWrap}>
                {TYPES.map((tp) => (
                  <TouchableOpacity key={tp} onPress={() => setEditingQ((q) => (q ? { ...q, type: tp, options: (tp === "choice" || tp === "multi") && (!q.options || q.options.length < 2) ? ["", ""] : q.options } : q))} style={[styles.typeChip, editingQ?.type === tp && styles.typeChipOn]} testID={`form-q-type-${tp}`}>
                    <Text style={[styles.typeChipText, editingQ?.type === tp && styles.typeChipTextOn]}>{TYPE_LABELS[tp]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {(editingQ?.type === "choice" || editingQ?.type === "multi") ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={styles.fieldLabel}>Options</Text>
                  {(editingQ?.options || []).map((o, i) => (
                    <View key={i} style={styles.optRow}>
                      <TextInput style={[styles.input, { flex: 1 }]} value={o} onChangeText={(t) => setEditingQ((q) => { if (!q) return q; const opts = [...q.options]; opts[i] = t; return { ...q, options: opts }; })} placeholder={`Option ${i + 1}`} placeholderTextColor={colors.textTertiary} testID={`form-q-opt-${i}`} />
                      <TouchableOpacity onPress={() => setEditingQ((q) => (q ? { ...q, options: q.options.filter((_, idx) => idx !== i) } : q))} hitSlop={8}><Ionicons name="close" size={18} color={colors.textTertiary} /></TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => setEditingQ((q) => (q ? { ...q, options: [...q.options, ""] } : q))} testID="form-q-add-opt"><Text style={styles.addLink}>+ Add option</Text></TouchableOpacity>
                </View>
              ) : null}
              <View style={styles.reqRow}>
                <Text style={styles.fieldLabel}>Required</Text>
                <Switch value={!!editingQ?.required} onValueChange={(v) => setEditingQ((q) => (q ? { ...q, required: v } : q))} trackColor={{ true: colors.accent, false: colors.border }} testID="form-q-required" />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setQOpen(false)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.submitBtn} onPress={saveQ} testID="form-q-save"><Text style={styles.submitText}>Save</Text></TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Response modal (coach fills on behalf) */}
      <Modal visible={!!respMember} transparent animationType="slide" onRequestClose={() => setRespMember(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetOverlay}>
          <View style={styles.respSheet}>
            <View style={styles.respHeader}>
              <Text style={styles.respHeaderTitle} numberOfLines={1}>{respMember?.name}</Text>
              <TouchableOpacity onPress={() => setRespMember(null)} hitSlop={8} testID="form-resp-close"><Ionicons name="close" size={22} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
              {data.questions.map((q) => {
                const qid = q.id as string;
                const v = respAnswers[qid];
                return (
                  <View key={qid}>
                    <Text style={styles.fieldLabel}>{q.label}{q.required ? " *" : ""}</Text>
                    {q.type === "paragraph" ? (
                      <TextInput style={[styles.input, styles.inputMulti]} value={v || ""} onChangeText={(t) => setAns(qid, t)} multiline placeholder="Answer" placeholderTextColor={colors.textTertiary} testID={`form-ans-${qid}`} />
                    ) : q.type === "number" ? (
                      <TextInput style={styles.input} value={v != null ? String(v) : ""} onChangeText={(t) => setAns(qid, t)} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textTertiary} testID={`form-ans-${qid}`} />
                    ) : q.type === "text" ? (
                      <TextInput style={styles.input} value={v || ""} onChangeText={(t) => setAns(qid, t)} placeholder="Answer" placeholderTextColor={colors.textTertiary} testID={`form-ans-${qid}`} />
                    ) : q.type === "yesno" ? (
                      <View style={styles.chipWrap}>
                        {["Yes", "No"].map((o) => (
                          <TouchableOpacity key={o} onPress={() => setAns(qid, o)} style={[styles.optChip, v === o && styles.optChipOn]} testID={`form-ans-${qid}-${o}`}>
                            <Text style={[styles.optChipText, v === o && styles.optChipTextOn]}>{o}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : q.type === "choice" ? (
                      <View style={styles.chipWrap}>
                        {q.options.map((o) => (
                          <TouchableOpacity key={o} onPress={() => setAns(qid, o)} style={[styles.optChip, v === o && styles.optChipOn]} testID={`form-ans-${qid}-${o}`}>
                            <Text style={[styles.optChipText, v === o && styles.optChipTextOn]}>{o}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : (
                      <View style={styles.chipWrap}>
                        {q.options.map((o) => {
                          const on = Array.isArray(v) && v.includes(o);
                          return (
                            <TouchableOpacity key={o} onPress={() => toggleMulti(qid, o)} style={[styles.optChip, on && styles.optChipOn]} testID={`form-ans-${qid}-${o}`}>
                              {on ? <Ionicons name="checkmark" size={13} color="white" /> : null}
                              <Text style={[styles.optChipText, on && styles.optChipTextOn]}>{o}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.respActions}>
              {respMember?.answered ? <TouchableOpacity style={styles.clearBtn} onPress={clearResp} testID="form-resp-clear"><Text style={styles.clearText}>Clear</Text></TouchableOpacity> : null}
              <TouchableOpacity style={styles.submitBtn} onPress={saveResp} disabled={savingResp} testID="form-resp-save">
                {savingResp ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Save response</Text>}
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
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border, gap: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h3, color: c.textPrimary, flex: 1, textAlign: "center" },
  desc: { ...typography.body, color: c.textSecondary, marginBottom: spacing.md, lineHeight: 20 },

  attachCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  attachTitle: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  attachHint: { ...typography.caption, color: c.textSecondary, marginTop: 2, marginBottom: spacing.sm, lineHeight: 16 },
  attachSave: { marginTop: spacing.sm, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 11, alignItems: "center" },
  attachSaveText: { color: "white", fontWeight: "800", fontSize: 14 },

  lockRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md },
  lockLabel: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  lockHint: { ...typography.caption, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: c.accent, backgroundColor: c.bg },
  actionText: { ...typography.caption, color: c.accent, fontWeight: "800" },

  deadlineCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  deadlineTitle: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800" },
  deadlineHint: { ...typography.caption, color: c.textSecondary, marginTop: 2, marginBottom: spacing.sm, lineHeight: 16 },
  deadlineRow: { flexDirection: "row", gap: spacing.sm },
  deadlineSave: { marginTop: spacing.sm, backgroundColor: c.bg, borderWidth: 1, borderColor: c.accent, borderRadius: radius.md, paddingVertical: 10, alignItems: "center" },
  deadlineSaveText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  clearLink: { ...typography.caption, color: c.danger, fontWeight: "800", marginTop: 6 },

  sectionHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionHead: { ...typography.micro, color: c.textTertiary },
  addLink: { ...typography.caption, color: c.accent, fontWeight: "800", marginTop: 6 },
  emptyText: { ...typography.caption, color: c.textTertiary, paddingVertical: spacing.sm },

  qRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  qLabel: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  qMeta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },

  tabs: { flexDirection: "row", backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: 3, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: "center" },
  tabOn: { backgroundColor: c.accent },
  tabText: { ...typography.caption, color: c.textSecondary, fontWeight: "800" },
  tabTextOn: { color: "white" },

  tallyCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md },
  tallyQ: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800", marginBottom: 6 },
  tallyLineRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  tallyCount: { ...typography.body, color: c.accent, fontWeight: "800", minWidth: 26 },
  tallyVal: { ...typography.body, color: c.textPrimary },
  tallyLine: { ...typography.body, color: c.textPrimary },
  tallyText: { ...typography.body, color: c.textPrimary, marginBottom: 3, lineHeight: 19 },
  tallyMuted: { ...typography.caption, color: c.textTertiary },

  respRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md },
  respDot: { width: 24, height: 24, borderRadius: 999, borderWidth: 1.5, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  respDotOn: { backgroundColor: c.success, borderColor: c.success },
  respName: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  respAns: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  respPending: { ...typography.caption, color: c.textTertiary, marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalSheet: { width: "100%", maxWidth: 460, backgroundColor: c.bg, borderRadius: 16, padding: spacing.lg, maxHeight: "86%" },
  modalTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.textPrimary, marginBottom: spacing.sm },
  inputMulti: { minHeight: 72, textAlignVertical: "top" },
  fieldLabel: { ...typography.caption, color: c.textSecondary, fontWeight: "800", marginBottom: 6, marginTop: 4 },
  typeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  typeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  typeChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  typeChipText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  typeChipTextOn: { color: "white" },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  reqRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  modalCancelText: { ...typography.bodyMedium, color: c.textPrimary },
  submitBtn: { flex: 1, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  submitText: { color: "white", fontWeight: "800", fontSize: 15 },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  respSheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%", flexShrink: 1 },
  respHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  respHeaderTitle: { ...typography.h3, color: c.textPrimary, flex: 1, marginRight: 8 },
  respActions: { flexDirection: "row", gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  clearBtn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  clearText: { ...typography.bodyMedium, color: c.danger },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  optChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  optChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  optChipText: { ...typography.bodyMedium, color: c.textPrimary },
  optChipTextOn: { color: "white" },
});
