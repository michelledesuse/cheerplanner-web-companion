import React, { useCallback, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, Modal, Pressable, Image, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/src/api/client";
import LinksEditor, { cleanLinks, type ExternalLink } from "@/src/components/LinksEditor";
import DateField from "@/src/components/DateField";
import TimeField from "@/src/components/TimeField";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Member = { id: string; name: string; role: string; parent_first_name?: string; parent_phone?: string; phone?: string };
type Team = { id: string; name: string };
type Track = { id: string; title: string };
type Attachment = { token: string; filename: string; uri?: string };

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export default function BroadcastScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [roster, setRoster] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<"all" | "team" | "members">("all");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const [message, setMessage] = useState("");
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [musicPickerOpen, setMusicPickerOpen] = useState(false);
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  type Template = { id: string; name: string; message: string; links: ExternalLink[] };
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [result, setResult] = useState<null | { id?: string; sent: number; failed: number; failed_recipients: { name: string; phone: string }[]; no_phone_count: number; no_phone: string[] }>(null);
  const [resending, setResending] = useState(false);
  const [sendLater, setSendLater] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");

  const [review, setReview] = useState<null | { recipient_count: number; no_phone_count: number; preview: { name: string; phone: string; body: string }[] }>(null);

  const load = useCallback(async () => {
    try {
      const [r, t, m, tpl] = await Promise.all([
        api.get<Member[]>("/roster"),
        api.get<Team[]>("/teams").catch(() => ({ data: [] as Team[] })),
        api.get<Track[]>("/team/music").catch(() => ({ data: [] as Track[] })),
        api.get<Template[]>("/team/broadcast/templates").catch(() => ({ data: [] as Template[] })),
      ]);
      setRoster(r.data || []);
      setTeams(t.data || []);
      setTracks(m.data || []);
      setTemplates(tpl.data || []);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Photo access needed", "Allow photo access to attach a photo.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const a = res.assets[0];
      setUploading(true);
      const up = await api.post<{ token: string; filename: string }>("/team/broadcast/attachment", {
        filename: a.fileName || "photo.jpg",
        content_type: a.mimeType || "image/jpeg",
        data_base64: a.base64,
      });
      setAttachments((prev) => [...prev, { token: up.data.token, filename: up.data.filename, uri: a.uri }]);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not attach photo.");
    } finally { setUploading(false); }
  };

  const schedISO = () => {
    if (!sendLater || !schedDate || !schedTime) return undefined;
    const d = new Date(`${schedDate}T${schedTime}:00`);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  };

  const buildPayload = (dry: boolean) => ({
    message: message.trim(),
    recipients: { mode, team_id: teamId || undefined, member_ids: memberIds },
    links: cleanLinks(links),
    track_ids: trackIds,
    attachment_tokens: attachments.map((a) => a.token),
    base_url: BASE,
    dry_run: dry,
    send_at: dry ? undefined : schedISO(),
  });

  const openReview = async () => {
    if (!message.trim() && links.length === 0 && trackIds.length === 0 && attachments.length === 0) {
      Alert.alert("Nothing to send", "Write a message or attach something first.");
      return;
    }
    if (mode === "team" && !teamId) { Alert.alert("Pick a team", "Choose which team to message."); return; }
    if (mode === "members" && memberIds.length === 0) { Alert.alert("Pick people", "Choose at least one person."); return; }
    try {
      setSending(true);
      const r = await api.post("/team/broadcast/send", buildPayload(true));
      setReview(r.data);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not prepare the message.");
    } finally { setSending(false); }
  };

  const doSend = async () => {
    if (sendLater && !schedISO()) { Alert.alert("Pick a date & time", "Choose when to send, or turn off “Send later”."); return; }
    try {
      setSending(true);
      const r = await api.post("/team/broadcast/send", buildPayload(false));
      setReview(null);
      if (r.data?.scheduled) {
        const when = new Date(r.data.send_at);
        Alert.alert("Scheduled", `Your text will go out on ${when.toLocaleString()}.`, [{ text: "OK", onPress: () => router.back() }]);
        return;
      }
      setResult(r.data);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not send.");
    } finally { setSending(false); }
  };

  const resendFailed = async () => {
    if (!result?.id) return;
    try {
      setResending(true);
      const r = await api.post<{ resent: number; still_failed: number }>(`/team/broadcast/${result.id}/resend-failed`, {}, { params: { base_url: BASE } });
      setResult((prev) => prev ? { ...prev, sent: prev.sent + r.data.resent, failed: r.data.still_failed, failed_recipients: prev.failed_recipients.slice(0, r.data.still_failed) } : prev);
      Alert.alert("Resent", `Retried ${r.data.resent}. ${r.data.still_failed} still failed.`);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not resend.");
    } finally { setResending(false); }
  };

  const applyTemplate = (t: { message: string; links: ExternalLink[] }) => {
    setMessage(t.message || "");
    setLinks(t.links || []);
    setTemplatesOpen(false);
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) { Alert.alert("Name required", "Give this template a name."); return; }
    try {
      const r = await api.post<{ id: string; name: string; message: string; links: ExternalLink[] }>("/team/broadcast/templates", {
        name, message: message.trim(), links: cleanLinks(links),
      });
      setTemplates((p) => [r.data, ...p]);
      setSaveOpen(false); setTemplateName("");
      Alert.alert("Saved", "Template saved.");
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save template.");
    }
  };

  const deleteTemplate = async (id: string) => {
    setTemplates((p) => p.filter((x) => x.id !== id));
    try { await api.delete(`/team/broadcast/templates/${id}`); } catch { load(); }
  };

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="broadcast-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Message parents</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity onPress={() => router.push("/team/replies" as any)} style={styles.iconBtn} testID="broadcast-replies" hitSlop={8}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/team/broadcast-history" as any)} style={styles.iconBtn} testID="broadcast-history" hitSlop={8}>
            <Ionicons name="time-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Send to</Text>
          <View style={styles.segment}>
            {(["all", "team", "members"] as const).map((k) => (
              <TouchableOpacity key={k} onPress={() => setMode(k)} style={[styles.segBtn, mode === k && styles.segBtnOn]} testID={`broadcast-mode-${k}`}>
                <Text style={[styles.segText, mode === k && styles.segTextOn]}>{k === "all" ? "Everyone" : k === "team" ? "A team" : "Choose people"}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === "team" && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              {teams.map((t) => (
                <TouchableOpacity key={t.id} onPress={() => setTeamId(t.id)} style={[styles.chip, teamId === t.id && styles.chipOn]} testID={`broadcast-team-${t.id}`}>
                  <Text style={[styles.chipText, teamId === t.id && styles.chipTextOn]}>{t.name}</Text>
                </TouchableOpacity>
              ))}
              {teams.length === 0 && <Text style={styles.hint}>No teams yet.</Text>}
            </ScrollView>
          )}

          {mode === "members" && (
            <TouchableOpacity style={styles.selectBtn} onPress={() => setPeoplePickerOpen(true)} testID="broadcast-pick-people">
              <Ionicons name="people-outline" size={18} color={colors.accent} />
              <Text style={styles.selectBtnText}>{memberIds.length > 0 ? `${memberIds.length} selected` : "Choose people"}</Text>
            </TouchableOpacity>
          )}

          <View style={styles.msgHeadRow}>
            <Text style={styles.label}>Message</Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <TouchableOpacity onPress={() => setTemplatesOpen(true)} testID="broadcast-templates-open">
                <Text style={styles.linkAction}>Templates</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setTemplateName(""); setSaveOpen(true); }} disabled={!message.trim()} testID="broadcast-template-save-open">
                <Text style={[styles.linkAction, !message.trim() && { opacity: 0.4 }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.hint}>Each parent gets a personalized text starting with their first name.</Text>
          <TextInput
            style={styles.textArea}
            value={message}
            onChangeText={setMessage}
            placeholder="e.g. Reminder: competition this Saturday! Arrive by 7am in full uniform."
            placeholderTextColor={colors.textTertiary}
            multiline
            testID="broadcast-message"
          />

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Links</Text>
          <LinksEditor value={links} onChange={setLinks} testIDPrefix="broadcast-link" />

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Team music</Text>
          {trackIds.length > 0 && (
            <View style={styles.pillWrap}>
              {trackIds.map((id) => {
                const tr = tracks.find((x) => x.id === id);
                return (
                  <View key={id} style={styles.pill}>
                    <Ionicons name="musical-notes" size={13} color={colors.accent} />
                    <Text style={styles.pillText} numberOfLines={1}>{tr?.title || "Track"}</Text>
                    <TouchableOpacity onPress={() => setTrackIds((p) => p.filter((x) => x !== id))} hitSlop={6}>
                      <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
          <TouchableOpacity style={styles.addChip} onPress={() => setMusicPickerOpen(true)} testID="broadcast-add-music" disabled={tracks.length === 0}>
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.addChipText}>{tracks.length === 0 ? "No music uploaded yet" : "Attach music"}</Text>
          </TouchableOpacity>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Photo attachments</Text>
          {attachments.length > 0 && (
            <View style={styles.pillWrap}>
              {attachments.map((a) => (
                <View key={a.token} style={styles.attachChip}>
                  {a.uri ? <Image source={{ uri: a.uri }} style={styles.attachThumb} /> : <Ionicons name="document" size={18} color={colors.accent} />}
                  <TouchableOpacity onPress={() => setAttachments((p) => p.filter((x) => x.token !== a.token))} style={styles.attachRemove} hitSlop={6}>
                    <Ionicons name="close-circle" size={18} color="white" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.addChip} onPress={addPhoto} disabled={uploading} testID="broadcast-add-photo">
            {uploading ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="camera-outline" size={16} color={colors.accent} />}
            <Text style={styles.addChipText}>{uploading ? "Uploading…" : "Attach photo"}</Text>
          </TouchableOpacity>

          <View style={styles.schedRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Send later</Text>
              <Text style={styles.hint}>Schedule this text for a future date & time.</Text>
            </View>
            <Switch value={sendLater} onValueChange={setSendLater} trackColor={{ true: colors.accent, false: colors.border }} testID="broadcast-schedule-toggle" />
          </View>
          {sendLater && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><DateField value={schedDate} onChange={setSchedDate} placeholder="Date" testID="broadcast-sched-date" /></View>
              <View style={{ flex: 1 }}><TimeField value={schedTime} onChange={setSchedTime} placeholder="Time" testID="broadcast-sched-time" /></View>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.sendBtn} onPress={openReview} disabled={sending} testID="broadcast-review">
            {sending ? <ActivityIndicator color="white" /> : (
              <>
                <Ionicons name={sendLater ? "calendar-outline" : "paper-plane-outline"} size={18} color="white" />
                <Text style={styles.sendBtnText}>{sendLater ? "Review & schedule" : "Review & send"}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Music picker */}
      <Modal visible={musicPickerOpen} transparent animationType="slide" onRequestClose={() => setMusicPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMusicPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Attach music</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {tracks.map((t) => {
                const on = trackIds.includes(t.id);
                return (
                  <TouchableOpacity key={t.id} style={styles.pickRow} onPress={() => setTrackIds((p) => on ? p.filter((x) => x !== t.id) : [...p, t.id])} testID={`broadcast-track-${t.id}`}>
                    <Ionicons name="musical-notes" size={18} color={colors.accent} />
                    <Text style={styles.pickName} numberOfLines={1}>{t.title}</Text>
                    <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={22} color={on ? colors.accent : colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.done} onPress={() => setMusicPickerOpen(false)}><Text style={styles.doneText}>Done</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* People picker */}
      <Modal visible={peoplePickerOpen} transparent animationType="slide" onRequestClose={() => setPeoplePickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPeoplePickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Choose people</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {roster.map((m) => {
                const on = memberIds.includes(m.id);
                const hasPhone = !!(m.parent_phone || m.phone);
                return (
                  <TouchableOpacity key={m.id} style={styles.pickRow} onPress={() => setMemberIds((p) => on ? p.filter((x) => x !== m.id) : [...p, m.id])} testID={`broadcast-person-${m.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickName} numberOfLines={1}>{m.name}</Text>
                      {!hasPhone && <Text style={styles.noPhone}>No phone on file</Text>}
                    </View>
                    <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={22} color={on ? colors.accent : colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.done} onPress={() => setPeoplePickerOpen(false)}><Text style={styles.doneText}>Done</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Review & confirm */}
      <Modal visible={!!review} transparent animationType="slide" onRequestClose={() => setReview(null)}>
        <Pressable style={styles.backdrop} onPress={() => setReview(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Confirm send</Text>
            <Text style={styles.reviewCount}>{review?.recipient_count || 0} parent{review?.recipient_count === 1 ? "" : "s"} will get a text.</Text>
            {!!review?.no_phone_count && <Text style={styles.noPhone}>{review.no_phone_count} roster member(s) have no phone on file and will be skipped.</Text>}
            {!!review?.preview?.length && (
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>Preview to {review.preview[0].name || "parent"} ({review.preview[0].phone})</Text>
                <Text style={styles.previewBody}>{review.preview[0].body}</Text>
              </View>
            )}
            <TouchableOpacity style={[styles.done, (review?.recipient_count || 0) === 0 && { opacity: 0.5 }]} onPress={doSend} disabled={sending || (review?.recipient_count || 0) === 0} testID="broadcast-confirm-send">
              {sending ? <ActivityIndicator color="white" /> : <Text style={styles.doneText}>{sendLater ? "Schedule" : "Send now"}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancel} onPress={() => setReview(null)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      {/* Templates */}
      <Modal visible={templatesOpen} transparent animationType="slide" onRequestClose={() => setTemplatesOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setTemplatesOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Saved templates</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {templates.length === 0 ? (
                <Text style={styles.hint}>No templates yet. Write a message, then tap “Save”.</Text>
              ) : templates.map((t) => (
                <View key={t.id} style={styles.pickRow}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => applyTemplate(t)} testID={`broadcast-template-${t.id}`}>
                    <Text style={styles.pickName} numberOfLines={1}>{t.name}</Text>
                    <Text style={styles.noPhone2} numberOfLines={1}>{t.message || "(no message)"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteTemplate(t.id)} hitSlop={8} testID={`broadcast-template-del-${t.id}`}>
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.done} onPress={() => setTemplatesOpen(false)}><Text style={styles.doneText}>Done</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Save template */}
      <Modal visible={saveOpen} transparent animationType="fade" onRequestClose={() => setSaveOpen(false)}>
        <Pressable style={styles.centerBackdrop} onPress={() => setSaveOpen(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Save as template</Text>
            <TextInput
              style={styles.dialogInput}
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="e.g. Comp day reminder"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              testID="broadcast-template-name"
            />
            <TouchableOpacity style={styles.done} onPress={saveTemplate} testID="broadcast-template-save"><Text style={styles.doneText}>Save</Text></TouchableOpacity>
            <TouchableOpacity style={styles.cancel} onPress={() => setSaveOpen(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delivery summary */}
      <Modal visible={!!result} transparent animationType="slide" onRequestClose={() => { setResult(null); router.back(); }}>
        <Pressable style={styles.backdrop} onPress={() => { setResult(null); router.back(); }}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Delivery summary</Text>
            <View style={styles.summaryRow}>
              <SummaryStat label="Sent" value={result?.sent || 0} color={colors.success} />
              <SummaryStat label="Failed" value={result?.failed || 0} color={colors.danger} />
              <SummaryStat label="No phone" value={result?.no_phone_count || 0} color={colors.textTertiary} />
            </View>
            <ScrollView style={{ maxHeight: 300, marginTop: spacing.md }}>
              {!!result?.failed_recipients?.length && (
                <>
                  <Text style={styles.summaryHead}>Failed — try again or contact directly</Text>
                  {result.failed_recipients.map((f, i) => (
                    <Text key={`f${i}`} style={styles.summaryItem}>• {f.name} ({f.phone})</Text>
                  ))}
                </>
              )}
              {!!result?.no_phone?.length && (
                <>
                  <Text style={styles.summaryHead}>No phone on file</Text>
                  {result.no_phone.map((n, i) => (
                    <Text key={`n${i}`} style={styles.summaryItem}>• {n}</Text>
                  ))}
                </>
              )}
              {!result?.failed_recipients?.length && !result?.no_phone?.length && (
                <Text style={styles.hint}>Everyone with a phone on file received the text. 🎉</Text>
              )}
            </ScrollView>
            {!!result?.failed && (
              <TouchableOpacity style={styles.resendBtn} onPress={resendFailed} disabled={resending} testID="broadcast-resend-failed">
                {resending ? <ActivityIndicator color="white" /> : (<><Ionicons name="refresh" size={16} color="white" /><Text style={styles.doneText}>Resend to {result.failed} failed</Text></>)}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.done} onPress={() => { setResult(null); router.back(); }} testID="broadcast-summary-done"><Text style={styles.doneText}>Done</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "800", color }}>{value}</Text>
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  msgHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg },
  linkAction: { ...typography.caption, color: c.accent, fontWeight: "800" },
  hint: { ...typography.caption, color: c.textTertiary, marginBottom: 6 },
  segment: { flexDirection: "row", backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: "center" },
  segBtnOn: { backgroundColor: c.accent },
  segText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  segTextOn: { color: "white" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { ...typography.caption, fontWeight: "700", color: c.textPrimary },
  chipTextOn: { color: "white" },
  selectBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: c.accentBorder, backgroundColor: c.accentSubtle, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  selectBtnText: { ...typography.bodyMedium, color: c.accent, fontWeight: "700" },
  textArea: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 14, minHeight: 110, fontSize: 15, color: c.textPrimary, textAlignVertical: "top" },
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 220 },
  pillText: { ...typography.caption, color: c.textPrimary, fontWeight: "700", flexShrink: 1 },
  attachChip: { width: 64, height: 64, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: c.border, backgroundColor: c.card, alignItems: "center", justifyContent: "center" },
  attachThumb: { width: 64, height: 64 },
  attachRemove: { position: "absolute", top: 2, right: 2, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999 },
  addChip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderWidth: 1, borderColor: c.accentBorder, backgroundColor: c.accentSubtle, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  addChipText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.accent, paddingVertical: 15, borderRadius: radius.md },
  sendBtnText: { color: "white", fontWeight: "800", fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl, maxHeight: "85%" },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  pickName: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700", flex: 1 },
  noPhone: { ...typography.caption, color: c.dangerText, marginTop: 1 },
  done: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  doneText: { color: "white", fontWeight: "800", fontSize: 15 },
  cancel: { paddingVertical: 12, alignItems: "center" },
  cancelText: { ...typography.body, color: c.textSecondary, fontWeight: "700" },
  reviewCount: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  previewBox: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, marginTop: spacing.md },
  previewLabel: { ...typography.caption, color: c.textTertiary, marginBottom: 6 },
  previewBody: { ...typography.body, color: c.textPrimary },
  noPhone2: { ...typography.caption, color: c.textTertiary, marginTop: 1 },
  centerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  dialog: { backgroundColor: c.bg, borderRadius: radius.xl, padding: spacing.lg, width: "100%", maxWidth: 400 },
  dialogInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 14, fontSize: 15, color: c.textPrimary, marginTop: spacing.md },
  summaryRow: { flexDirection: "row", marginTop: spacing.md, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingVertical: spacing.md },
  summaryHead: { ...typography.caption, color: c.textSecondary, fontWeight: "800", marginTop: spacing.md, marginBottom: 4 },
  summaryItem: { ...typography.body, color: c.textPrimary, paddingVertical: 2 },
  schedRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.sm },
  resendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 13, marginTop: spacing.md },
});
