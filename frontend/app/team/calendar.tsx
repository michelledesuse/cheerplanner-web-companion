import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Ev = { event_id: string; occ_date: string; title: string; location?: string; start_time?: string; end_time?: string; notes?: string; recurring?: boolean; can_edit?: boolean; rsvp_count?: number; my_rsvps?: { roster_id: string; status: string }[] };
type Ath = { roster_id: string; name: string };
const WD = ["S", "M", "T", "W", "T", "F", "S"];

function fmtDate(s: string) { try { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); } catch { return s; } }

export default function TeamCalendar() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [role, setRole] = useState("viewer");
  const [events, setEvents] = useState<Ev[]>([]);
  const [athletes, setAthletes] = useState<Ath[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Ev | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = new Date().toISOString().slice(0, 10);
      const r = await api.get<{ role: string; events: Ev[]; athletes?: Ath[] }>(`/team/calendar/events?from_=${from}`);
      setRole(r.data.role); setEvents(r.data.events || []); setAthletes(r.data.athletes || []);
    } catch (_e) { setEvents([]); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isStaff = role === "staff";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="calendar-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={styles.title}>📅 Practice Calendar</Text><Text style={styles.subtitle}>{isStaff ? "Tap an event to see RSVPs" : "Tap an event to RSVP"}</Text></View>
        {isStaff && <TouchableOpacity onPress={() => setAddOpen(true)} hitSlop={8} testID="calendar-add-btn"><Ionicons name="add-circle" size={26} color={colors.accent} /></TouchableOpacity>}
      </View>

      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {events.length === 0 ? (
            <View style={styles.empty}><Ionicons name="calendar-outline" size={28} color={colors.textTertiary} /><Text style={styles.emptyText}>No upcoming events.</Text></View>
          ) : events.map((e) => (
            <TouchableOpacity key={e.event_id + e.occ_date} style={styles.card} onPress={() => setDetail(e)} testID={`event-${e.event_id}-${e.occ_date}`}>
              <View style={styles.dateChip}><Text style={styles.dateChipText}>{fmtDate(e.occ_date)}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rowT}><Text style={styles.evTitle}>{e.title}</Text>{e.recurring && <Ionicons name="repeat" size={14} color={colors.textTertiary} />}</View>
                <Text style={styles.evMeta}>{[e.start_time, e.location].filter(Boolean).join(" · ") || "All day"}</Text>
                {!isStaff && (e.my_rsvps || []).length > 0 && <Text style={styles.evRsvp}>{e.my_rsvps!.map((m) => athletes.find((a) => a.roster_id === m.roster_id)?.name.split(" ")[0] + ": " + (m.status === "attending" ? "✅" : "❌")).join("  ")}</Text>}
              </View>
              {isStaff && <View style={styles.countChip}><Text style={styles.countText}>{e.rsvp_count || 0}</Text></View>}
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {detail && <DetailModal ev={detail} isStaff={isStaff} athletes={athletes} onClose={() => setDetail(null)} onChanged={load} styles={styles} />}
      {addOpen && <AddModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} styles={styles} />}
    </SafeAreaView>
  );
}

function DetailModal({ ev, isStaff, athletes, onClose, onChanged, styles }: any) {
  const [rsvps, setRsvps] = useState<any[]>([]);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    if (isStaff) { try { const r = await api.get(`/team/calendar/rsvps?event_id=${ev.event_id}&occ_date=${ev.occ_date}`); setRsvps(r.data.rsvps || []); } catch {} }
  }, [ev, isStaff]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rsvp = async (roster_id: string, status: string, rsn?: string) => {
    try { await api.post("/team/calendar/rsvp", { event_id: ev.event_id, occ_date: ev.occ_date, roster_id, status, reason: rsn || "" }); setReasonFor(null); setReason(""); onChanged(); onClose(); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save RSVP."); }
  };
  const del = () => Alert.alert("Delete event?", "This removes it for the whole team.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { await api.delete(`/team/calendar/events/${ev.event_id}`); onChanged(); onClose(); } }]);
  const hide = async () => { await api.post("/team/calendar/hide", { event_id: ev.event_id, occ_date: ev.occ_date }); onChanged(); onClose(); };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="event-detail-modal">
        <Text style={styles.sheetTitle}>{ev.title}</Text>
        <Text style={styles.sheetSub2}>{fmtDate(ev.occ_date)}{ev.start_time ? ` · ${ev.start_time}` : ""}{ev.location ? ` · ${ev.location}` : ""}</Text>
        {!!ev.notes && <Text style={styles.notes}>{ev.notes}</Text>}
        <ScrollView style={{ maxHeight: 360 }}>
          {isStaff ? (
            <>
              <Text style={styles.secLbl}>RSVPs</Text>
              {rsvps.length === 0 ? <Text style={styles.dim}>No responses yet.</Text> : rsvps.map((r) => (
                <View key={r.roster_id} style={styles.rsvpRow}><Text style={styles.rsvpName}>{r.athlete_name}</Text><Text style={[styles.rsvpStat, { color: r.status === "attending" ? "#10B981" : "#DC2626" }]}>{r.status === "attending" ? "Attending" : "Not attending"}</Text>{!!r.reason && <Text style={styles.rsvpReason}>“{r.reason}”</Text>}</View>
              ))}
              <TouchableOpacity style={styles.delBtn} onPress={del} testID="event-delete"><Ionicons name="trash-outline" size={16} color="#DC2626" /><Text style={styles.delText}>Delete event</Text></TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.secLbl}>RSVP</Text>
              {athletes.map((a: Ath) => {
                const cur = (ev.my_rsvps || []).find((m: any) => m.roster_id === a.roster_id)?.status;
                return (
                  <View key={a.roster_id} style={styles.athBlock}>
                    <Text style={styles.rsvpName}>{a.name}{cur ? (cur === "attending" ? " · ✅" : " · ❌") : ""}</Text>
                    <View style={styles.btnRow}>
                      <TouchableOpacity style={[styles.rsvpBtn, cur === "attending" && styles.rsvpBtnOn]} onPress={() => rsvp(a.roster_id, "attending")} testID={`rsvp-yes-${a.roster_id}`}><Text style={[styles.rsvpBtnText, cur === "attending" && { color: "#fff" }]}>Attending</Text></TouchableOpacity>
                      <TouchableOpacity style={[styles.rsvpBtn, cur === "not_attending" && styles.rsvpBtnNo]} onPress={() => setReasonFor(a.roster_id)} testID={`rsvp-no-${a.roster_id}`}><Text style={[styles.rsvpBtnText, cur === "not_attending" && { color: "#fff" }]}>Not attending</Text></TouchableOpacity>
                    </View>
                    {reasonFor === a.roster_id && (
                      <View style={{ marginTop: 6, gap: 6 }}>
                        <TextInput style={styles.reasonInput} value={reason} onChangeText={setReason} placeholder="Reason (visible to coaches only)" placeholderTextColor={colors.textTertiary} testID={`rsvp-reason-${a.roster_id}`} />
                        <TouchableOpacity style={[styles.saveBtn, !reason.trim() && { opacity: 0.6 }]} disabled={!reason.trim()} onPress={() => rsvp(a.roster_id, "not_attending", reason)} testID={`rsvp-reason-save-${a.roster_id}`}><Text style={styles.saveText}>Submit</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
              <TouchableOpacity style={styles.hideBtn} onPress={hide} testID="event-hide"><Ionicons name="eye-off-outline" size={16} color={colors.textSecondary} /><Text style={styles.hideText}>Hide from my family's calendar</Text></TouchableOpacity>
            </>
          )}
        </ScrollView>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Close</Text></TouchableOpacity>
      </Pressable></Pressable>
    </Modal>
  );
}

function AddModal({ onClose, onSaved, styles }: any) {
  const [title, setTitle] = useState(""); const [loc, setLoc] = useState(""); const [date, setDate] = useState(""); const [time, setTime] = useState("");
  const [freq, setFreq] = useState("none"); const [wd, setWd] = useState<number[]>([]); const [until, setUntil] = useState(""); const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim() || !date.trim()) { Alert.alert("Missing", "Enter a title and a start date (YYYY-MM-DD)."); return; }
    setSaving(true);
    const rec: any = { freq }; if (freq === "weekly") { rec.byweekday = wd.length ? wd : undefined; rec.interval = 1; } if (freq === "monthly") rec.interval = 1; if (until.trim()) rec.until = until.trim();
    try { await api.post("/team/calendar/events", { title: title.trim(), location: loc.trim(), date: date.trim(), start_time: time.trim(), recurrence: rec }); onSaved(); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not create event."); }
    finally { setSaving(false); }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="event-add-modal">
        <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sheetTitle}>New event</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title (e.g. Practice)" placeholderTextColor={colors.textTertiary} testID="event-title-input" />
          <TextInput style={styles.input} value={loc} onChangeText={setLoc} placeholder="Location" placeholderTextColor={colors.textTertiary} />
          <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="Start date  YYYY-MM-DD" placeholderTextColor={colors.textTertiary} testID="event-date-input" />
          <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="Start time (e.g. 6:00 PM)" placeholderTextColor={colors.textTertiary} />
          <Text style={styles.secLbl}>Repeat</Text>
          <View style={styles.btnRow}>
            {[["none", "Once"], ["weekly", "Weekly"], ["monthly", "Monthly"]].map(([k, l]) => (
              <TouchableOpacity key={k} style={[styles.freqBtn, freq === k && styles.freqOn]} onPress={() => setFreq(k)} testID={`freq-${k}`}><Text style={[styles.freqText, freq === k && { color: "#fff" }]}>{l}</Text></TouchableOpacity>
            ))}
          </View>
          {freq === "weekly" && (
            <View style={styles.wdRow}>{WD.map((d, i) => (
              <TouchableOpacity key={i} style={[styles.wdChip, wd.includes(i) && styles.wdOn]} onPress={() => setWd((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i])} testID={`wd-${i}`}><Text style={[styles.wdText, wd.includes(i) && { color: "#fff" }]}>{d}</Text></TouchableOpacity>
            ))}</View>
          )}
          {freq !== "none" && <TextInput style={styles.input} value={until} onChangeText={setUntil} placeholder="Repeat until  YYYY-MM-DD (optional)" placeholderTextColor={colors.textTertiary} />}
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="event-save-btn">{saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Create event</Text>}</TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </ScrollView>
      </Pressable></Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { ...typography.h3, color: c.textPrimary }, subtitle: { ...typography.caption, color: c.textSecondary },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  dateChip: { backgroundColor: c.accentSubtle, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6, minWidth: 66, alignItems: "center" },
  dateChipText: { ...typography.caption, color: c.accent, fontWeight: "800", fontSize: 11 },
  rowT: { flexDirection: "row", alignItems: "center", gap: 6 },
  evTitle: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary }, evMeta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  evRsvp: { ...typography.caption, color: c.textPrimary, marginTop: 3 },
  countChip: { backgroundColor: c.cardSubtle, borderRadius: 999, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  countText: { fontSize: 12, fontWeight: "800", color: c.textSecondary },
  empty: { alignItems: "center", gap: 10, padding: spacing.xl }, emptyText: { ...typography.body, color: c.textSecondary },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: 8, maxHeight: "92%" },
  sheetTitle: { ...typography.h3, color: c.textPrimary }, sheetSub2: { ...typography.caption, color: c.textSecondary },
  notes: { ...typography.body, color: c.textSecondary, marginTop: 4 },
  secLbl: { ...typography.caption, fontWeight: "800", color: c.textTertiary, letterSpacing: 0.5, marginTop: spacing.sm },
  dim: { ...typography.body, color: c.textTertiary },
  rsvpRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  rsvpName: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary },
  rsvpStat: { ...typography.caption, fontWeight: "800", marginTop: 2 }, rsvpReason: { ...typography.caption, color: c.textSecondary, fontStyle: "italic", marginTop: 2 },
  athBlock: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" },
  rsvpBtn: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 14 },
  rsvpBtnOn: { backgroundColor: "#10B981", borderColor: "#10B981" }, rsvpBtnNo: { backgroundColor: "#DC2626", borderColor: "#DC2626" },
  rsvpBtnText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  reasonInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 10, ...typography.body, color: c.textPrimary },
  hideBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingVertical: 8 },
  hideText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  delBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingVertical: 8 }, delText: { ...typography.caption, color: "#DC2626", fontWeight: "800" },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, ...typography.body, color: c.textPrimary, marginTop: 8 },
  freqBtn: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 16 }, freqOn: { backgroundColor: c.accent, borderColor: c.accent },
  freqText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  wdRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  wdChip: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" }, wdOn: { backgroundColor: c.accent, borderColor: c.accent },
  wdText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 13, alignItems: "center", marginTop: spacing.md }, saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelText: { ...typography.body, color: c.textSecondary, fontWeight: "600" },
});
