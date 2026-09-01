import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert, Switch, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import DateField from "@/src/components/DateField";
import TimeField from "@/src/components/TimeField";
import AddTypeModal from "@/src/components/AddTypeModal";
import { formatTime12, todayISO } from "@/src/utils/format";

type Ev = { event_id: string; occ_date: string; event_date?: string; title: string; event_type?: string; location?: string; address?: string; start_time?: string; end_time?: string; notes?: string; recurring?: boolean; recurrence?: any; can_edit?: boolean; rsvp_count?: number; my_rsvps?: { roster_id: string; status: string }[] };
type Ath = { roster_id: string; name: string };
type TypeDef = { key: string; label: string; icon: string; color: string };
const WD = ["S", "M", "T", "W", "T", "F", "S"];

const BUILTIN_TYPES: TypeDef[] = [
  { key: "practice", label: "Practice", icon: "barbell", color: "#EA580C" },
  { key: "team_bonding", label: "Team Bonding", icon: "happy", color: "#0EA5E9" },
  { key: "private_lesson", label: "Private Lesson", icon: "person", color: "#DB2777" },
  { key: "choreography", label: "Choreography", icon: "musical-notes", color: "#9333EA" },
  { key: "class", label: "Class", icon: "school", color: "#0891B2" },
  { key: "fundraiser", label: "Fundraiser", icon: "gift", color: "#16A34A" },
  { key: "competition", label: "Competition", icon: "trophy", color: "#F59E0B" },
  { key: "other", label: "Other", icon: "calendar", color: "#64748B" },
];

function fmtDate(s: string) { try { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); } catch { return s; } }
function fmtTime(s?: string) { return s ? formatTime12(s) : ""; }

export default function TeamCalendar() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [role, setRole] = useState("viewer");
  const [events, setEvents] = useState<Ev[]>([]);
  const [athletes, setAthletes] = useState<Ath[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Ev | null>(null);
  const [formEv, setFormEv] = useState<Ev | null | "new">(null);
  const [customTypes, setCustomTypes] = useState<{ id: string; label: string; color: string }[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const allTypes: TypeDef[] = useMemo(() => [
    ...BUILTIN_TYPES,
    ...customTypes.map((t) => ({ key: t.id, label: t.label, icon: "pricetag", color: t.color })),
  ], [customTypes]);
  const typeOf = useCallback((k?: string) => allTypes.find((t) => t.key === k) || BUILTIN_TYPES[0], [allTypes]);

  const load = useCallback(async () => {
    try {
      const from = new Date().toISOString().slice(0, 10);
      const r = await api.get<{ role: string; events: Ev[]; athletes?: Ath[] }>(`/team/calendar/events?from_=${from}`);
      setRole(r.data.role); setEvents(r.data.events || []); setAthletes(r.data.athletes || []);
    } catch (_e) { setEvents([]); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { (async () => { try { const ht = await api.get("/household/custom-types"); setCustomTypes(ht.data.event_types || []); } catch (_e) { /* ignore */ } })(); }, []);

  const isStaff = role === "staff";

  const importAll = async () => {
    try {
      const r = await api.post<{ imported: number; skipped: number }>("/team/calendar/import-all-to-personal", {});
      Alert.alert("Added to your calendar", `${r.data.imported} event${r.data.imported === 1 ? "" : "s"} imported${r.data.skipped ? `, ${r.data.skipped} already on your calendar` : ""}.`);
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not import events."); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="calendar-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={styles.title}>Calendar</Text><Text style={styles.subtitle}>{isStaff ? "Tap an event to see RSVPs" : "Tap an event to RSVP"}</Text></View>
        <TouchableOpacity onPress={importAll} hitSlop={8} style={{ padding: 4 }} testID="calendar-import-all"><Ionicons name="cloud-download-outline" size={22} color={colors.accent} /></TouchableOpacity>
        {isStaff && <TouchableOpacity onPress={() => setImportOpen(true)} hitSlop={8} style={{ padding: 4 }} testID="calendar-import-personal"><Ionicons name="albums-outline" size={22} color={colors.accent} /></TouchableOpacity>}
        {isStaff && <TouchableOpacity onPress={() => setFormEv("new")} hitSlop={8} style={{ padding: 4 }} testID="calendar-add-btn"><Ionicons name="add-circle" size={26} color={colors.accent} /></TouchableOpacity>}
      </View>

      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {events.length === 0 ? (
            <View style={styles.empty}><Ionicons name="calendar-outline" size={28} color={colors.textTertiary} /><Text style={styles.emptyText}>No upcoming events.</Text></View>
          ) : events.map((e) => {
            const t = typeOf(e.event_type);
            return (
            <TouchableOpacity key={e.event_id + e.occ_date} style={styles.card} onPress={() => setDetail(e)} testID={`event-${e.event_id}-${e.occ_date}`}>
              <View style={styles.dateChip}><Text style={styles.dateChipText}>{fmtDate(e.occ_date)}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rowT}>
                  <View style={[styles.typeDot, { backgroundColor: t.color }]} />
                  <Text style={styles.evTitle} numberOfLines={1}>{e.title}</Text>
                  {e.recurring && <Ionicons name="repeat" size={14} color={colors.textTertiary} />}
                </View>
                <Text style={styles.evMeta}>{[t.label, fmtTime(e.start_time), e.location].filter(Boolean).join(" · ") || "All day"}</Text>
                {!isStaff && (e.my_rsvps || []).length > 0 && <Text style={styles.evRsvp}>{e.my_rsvps!.map((m) => athletes.find((a) => a.roster_id === m.roster_id)?.name.split(" ")[0] + ": " + (m.status === "attending" ? "✅" : "❌")).join("  ")}</Text>}
              </View>
              {isStaff && <View style={styles.countChip}><Text style={styles.countText}>{e.rsvp_count || 0}</Text></View>}
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {detail && <DetailModal ev={detail} isStaff={isStaff} athletes={athletes} typeOf={typeOf} onEdit={() => { const d = detail; setDetail(null); setFormEv(d); }} onClose={() => setDetail(null)} onChanged={load} styles={styles} />}
      {formEv && <EventForm ev={formEv === "new" ? null : formEv} allTypes={allTypes} customTypes={customTypes} setCustomTypes={setCustomTypes} onClose={() => setFormEv(null)} onSaved={() => { setFormEv(null); load(); }} styles={styles} />}
      {importOpen && <ImportFromPersonalModal onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} styles={styles} />}
    </SafeAreaView>
  );
}

function DetailModal({ ev, isStaff, athletes, typeOf, onEdit, onClose, onChanged, styles }: any) {
  const [rsvps, setRsvps] = useState<any[]>([]);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const t = typeOf(ev.event_type);
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
  const addToMine = async () => {
    try {
      const r = await api.post<{ already?: boolean }>("/team/calendar/import-to-personal", { event_id: ev.event_id });
      Alert.alert(r.data.already ? "Already added" : "Added to your calendar", r.data.already ? "This event is already on your personal calendar." : "The event was added to your family calendar.");
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not add to your calendar."); }
  };

  const timeStr = [ev.start_time && formatTime12(ev.start_time), ev.end_time && formatTime12(ev.end_time)].filter(Boolean).join(" – ");

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="event-detail-modal">
        <View style={styles.rowT}><View style={[styles.typeDot, { backgroundColor: t.color }]} /><Text style={styles.sheetTitle}>{ev.title}</Text></View>
        <Text style={styles.sheetSub2}>{[t.label, fmtDate(ev.occ_date), timeStr, ev.location].filter(Boolean).join(" · ")}</Text>
        {!!ev.address && <Text style={styles.sheetSub2}>{ev.address}</Text>}
        {!!ev.notes && <Text style={styles.notes}>{ev.notes}</Text>}
        <ScrollView style={{ maxHeight: 360 }}>
          {isStaff ? (
            <>
              <Text style={styles.secLbl}>RSVPs</Text>
              {rsvps.length === 0 ? <Text style={styles.dim}>No responses yet.</Text> : rsvps.map((r) => (
                <View key={r.roster_id} style={styles.rsvpRow}><Text style={styles.rsvpName}>{r.athlete_name}</Text><Text style={[styles.rsvpStat, { color: r.status === "attending" ? "#10B981" : "#DC2626" }]}>{r.status === "attending" ? "Attending" : "Not attending"}</Text>{!!r.reason && <Text style={styles.rsvpReason}>“{r.reason}”</Text>}</View>
              ))}
              <TouchableOpacity style={styles.editBtn} onPress={onEdit} testID="event-edit"><Ionicons name="create-outline" size={16} color={colors.accent} /><Text style={styles.editText}>Edit event</Text></TouchableOpacity>
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
              <TouchableOpacity style={styles.hideBtn} onPress={hide} testID="event-hide"><Ionicons name="eye-off-outline" size={16} color={colors.textSecondary} /><Text style={styles.hideText}>{"Hide from my family's calendar"}</Text></TouchableOpacity>
            </>
          )}
        </ScrollView>
        <TouchableOpacity style={styles.importBtn} onPress={addToMine} testID="event-import-personal"><Ionicons name="cloud-download-outline" size={16} color={colors.accent} /><Text style={styles.importText}>Add to my calendar</Text></TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Close</Text></TouchableOpacity>
      </Pressable></Pressable>
    </Modal>
  );
}

function EventForm({ ev, allTypes, customTypes, setCustomTypes, onClose, onSaved, styles }: any) {
  const isEdit = !!ev;
  const [eventType, setEventType] = useState<string>(ev?.event_type || "practice");
  const [title, setTitle] = useState(ev?.title || "");
  const [loc, setLoc] = useState(ev?.location || "");
  const [address, setAddress] = useState(ev?.address || "");
  const [date, setDate] = useState<string>(ev?.event_date || ev?.occ_date || todayISO());
  const [startTime, setStartTime] = useState<string>(ev?.start_time || "");
  const [endTime, setEndTime] = useState<string>(ev?.end_time || "");
  const [notes, setNotes] = useState(ev?.notes || "");
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Recurrence — derive initial mode from stored recurrence
  const rec0 = ev?.recurrence || { freq: "none" };
  const initMode = rec0.freq === "none" ? "none"
    : rec0.freq === "daily" ? "daily"
    : rec0.freq === "monthly" ? "monthly"
    : (Number(rec0.interval) === 2 ? "biweekly" : "weekly");
  const [repeat, setRepeat] = useState<boolean>(rec0.freq !== "none");
  const [mode, setMode] = useState<string>(initMode === "none" ? "weekly" : initMode);
  const [wd, setWd] = useState<number[]>(Array.isArray(rec0.byweekday) ? rec0.byweekday : []);
  const [until, setUntil] = useState<string>(rec0.until || "");

  const buildRecurrence = () => {
    if (!repeat) return { freq: "none" };
    const r: any = { until: until || undefined };
    if (mode === "daily") { r.freq = "daily"; r.interval = 1; }
    else if (mode === "monthly") { r.freq = "monthly"; r.interval = 1; }
    else { r.freq = "weekly"; r.interval = mode === "biweekly" ? 2 : 1; r.byweekday = wd.length ? wd : undefined; }
    return r;
  };

  const addType = async (name: string, color?: string) => {
    try {
      const r = await api.post("/household/custom-types/event-type", { label: name, color: color || "#64748B" });
      setCustomTypes(r.data.event_types || []);
      if (r.data.event_type) setEventType(r.data.event_type.id);
      setAddTypeOpen(false);
    } catch (e: any) { Alert.alert("Couldn't add", e?.response?.data?.detail || "Try again."); }
  };

  const save = async () => {
    if (!title.trim()) { Alert.alert("Missing", "Add a title."); return; }
    if (!date) { Alert.alert("Missing", "Pick a start date."); return; }
    if (repeat && (mode === "weekly" || mode === "biweekly") && wd.length === 0) { Alert.alert("Missing", "Pick at least one day of the week."); return; }
    setSaving(true);
    const payload = {
      event_type: eventType, title: title.trim(), location: loc.trim(), address: address.trim(),
      date, start_time: startTime, end_time: endTime, notes: notes.trim(), recurrence: buildRecurrence(),
    };
    try {
      if (isEdit) await api.patch(`/team/calendar/events/${ev.event_id}`, payload);
      else await api.post("/team/calendar/events", payload);
      onSaved();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save event."); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="event-add-modal">
        <ScrollView style={{ maxHeight: "100%" }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
          <Text style={styles.sheetTitle}>{isEdit ? "Edit event" : "New event"}</Text>

          <Text style={styles.secLbl}>Event type</Text>
          <View style={styles.typeGrid}>
            {allTypes.map((t: TypeDef) => {
              const on = eventType === t.key;
              return (
                <TouchableOpacity key={t.key} onPress={() => setEventType(t.key)} style={[styles.typeBtn, on && { backgroundColor: t.color, borderColor: t.color }]} testID={`cal-type-${t.key}`}>
                  {!on && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color, marginRight: 6 }} />}
                  <Text style={[styles.typeBtnText, on && { color: "#fff" }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => setAddTypeOpen(true)} style={[styles.typeBtn, styles.addTypeBtn]} testID="cal-type-add">
              <Ionicons name="add" size={14} color={colors.accent} /><Text style={[styles.typeBtnText, { color: colors.accent }]}>New</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.secLbl}>Title</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Senior 5 practice" placeholderTextColor={colors.textTertiary} testID="event-title-input" />

          <Text style={styles.secLbl}>Location (optional)</Text>
          <TextInput style={styles.input} value={loc} onChangeText={setLoc} placeholder="e.g. California Allstars gym" placeholderTextColor={colors.textTertiary} />

          <Text style={styles.secLbl}>Address (optional, for maps)</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="123 Main St, San Marcos, CA" placeholderTextColor={colors.textTertiary} autoCapitalize="words" testID="event-address-input" />

          <Text style={styles.secLbl}>{repeat ? "Starts" : "Date"}</Text>
          <View style={{ marginTop: 8 }}><DateField value={date} onChange={setDate} testID="event-date-field" /></View>

          <Text style={styles.secLbl}>Start time</Text>
          <View style={{ marginTop: 8 }}><TimeField value={startTime} onChange={setStartTime} testID="event-start-time" /></View>

          <Text style={styles.secLbl}>End time</Text>
          <View style={{ marginTop: 8 }}><TimeField value={endTime} onChange={setEndTime} testID="event-end-time" /></View>

          <View style={styles.repeatHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="repeat" size={18} color={colors.textPrimary} /><Text style={styles.repeatTitle}>Repeat</Text></View>
            <Switch value={repeat} onValueChange={setRepeat} trackColor={{ true: colors.accent, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? (repeat ? "white" : "#F1F5F9") : undefined} testID="event-repeat-toggle" />
          </View>

          {repeat && (
            <>
              <Text style={styles.secLbl}>Frequency</Text>
              <View style={styles.btnRow}>
                {[["daily", "Daily"], ["weekly", "Weekly"], ["biweekly", "Bi-weekly"], ["monthly", "Monthly"]].map(([k, l]) => (
                  <TouchableOpacity key={k} style={[styles.freqBtn, mode === k && styles.freqOn]} onPress={() => setMode(k)} testID={`freq-${k}`}><Text style={[styles.freqText, mode === k && { color: "#fff" }]}>{l}</Text></TouchableOpacity>
                ))}
              </View>
              {(mode === "weekly" || mode === "biweekly") && (
                <View style={styles.wdRow}>{WD.map((d, i) => (
                  <TouchableOpacity key={i} style={[styles.wdChip, wd.includes(i) && styles.wdOn]} onPress={() => setWd((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i])} testID={`wd-${i}`}><Text style={[styles.wdText, wd.includes(i) && { color: "#fff" }]}>{d}</Text></TouchableOpacity>
                ))}</View>
              )}
              <Text style={styles.secLbl}>Repeats until (optional)</Text>
              <View style={{ marginTop: 8 }}><DateField value={until} onChange={setUntil} testID="event-until-field" /></View>
            </>
          )}

          <Text style={styles.secLbl}>Notes (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60, maxHeight: 140, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} multiline placeholder="e.g. Wear comp shoes" placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="event-save-btn">{saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{isEdit ? "Save changes" : "Create event"}</Text>}</TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </ScrollView>
      </Pressable></Pressable>
      <AddTypeModal visible={addTypeOpen} title="New event type" placeholder="e.g. Tumbling" withColor onSubmit={(name: string, color?: string) => addType(name, color)} onClose={() => setAddTypeOpen(false)} />
    </Modal>
  );
}

type Importable = { competitions: { id: string; name: string; date?: string }[]; events: { id: string; title: string; date?: string; event_type?: string }[] };

function ImportFromPersonalModal({ onClose, onDone, styles }: any) {
  const [data, setData] = useState<Importable>({ competitions: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Record<string, "competition" | "schedule">>({});
  const [inc, setInc] = useState({ travel: true, teams_to_watch: true, packing_list: true, links: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => {
    try { const r = await api.get<Importable>("/team/calendar/importable"); setData(r.data || { competitions: [], events: [] }); }
    catch { setData({ competitions: [], events: [] }); }
    finally { setLoading(false); }
  })(); }, []);

  const toggle = (id: string, source: "competition" | "schedule") => setSel((p) => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = source; return n; });
  const count = Object.keys(sel).length;

  const doImport = async () => {
    if (count === 0) return;
    setSaving(true);
    const items = Object.entries(sel).map(([id, source]) => ({ id, source }));
    try {
      const r = await api.post<{ imported: number; already: number; skipped: number }>("/team/calendar/import-from-personal-bulk", { items, include: inc });
      const { imported, already, skipped } = r.data;
      const parts = [`${imported} imported`];
      if (already) parts.push(`${already} already on the hub`);
      if (skipped) parts.push(`${skipped} skipped`);
      Alert.alert("Imported to Team Hub", parts.join(", ") + ".");
      onDone();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not import."); }
    finally { setSaving(false); }
  };

  const hasAny = data.competitions.length > 0 || data.events.length > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="import-personal-modal">
        <Text style={styles.sheetTitle}>Import to Team Hub</Text>
        <Text style={styles.sheetSub2}>Pick your competitions & events to add to the team calendar.</Text>
        {loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} /> : (
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator>
            {!hasAny && <Text style={[styles.dim, { marginTop: 12 }]}>Nothing to import yet. Add competitions or upcoming schedule events in the parent portal first.</Text>}
            {data.competitions.length > 0 && <Text style={styles.secLbl}>Competitions</Text>}
            {data.competitions.map((c) => {
              const on = !!sel[c.id];
              return (
                <TouchableOpacity key={c.id} style={styles.impRow} onPress={() => toggle(c.id, "competition")} testID={`imp-comp-${c.id}`}>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.accent : colors.textTertiary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.impTitle} numberOfLines={1}>{c.name}</Text>
                    {!!c.date && <Text style={styles.impMeta}>{fmtDate(String(c.date).slice(0, 10))}</Text>}
                  </View>
                  <Ionicons name="trophy" size={16} color="#F59E0B" />
                </TouchableOpacity>
              );
            })}
            {data.events.length > 0 && <Text style={styles.secLbl}>Upcoming events</Text>}
            {data.events.map((e) => {
              const on = !!sel[e.id];
              return (
                <TouchableOpacity key={e.id} style={styles.impRow} onPress={() => toggle(e.id, "schedule")} testID={`imp-ev-${e.id}`}>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.accent : colors.textTertiary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.impTitle} numberOfLines={1}>{e.title}</Text>
                    {!!e.date && <Text style={styles.impMeta}>{fmtDate(String(e.date).slice(0, 10))}</Text>}
                  </View>
                  <Ionicons name="calendar" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}

            {hasAny && (
              <>
                <Text style={styles.secLbl}>Include details</Text>
                {([["travel", "✈️ Travel details"], ["teams_to_watch", "👀 Teams to watch"], ["packing_list", "🎒 Packing list"], ["links", "🔗 Links"]] as const).map(([k, label]) => (
                  <View key={k} style={styles.incRow}>
                    <Text style={styles.incLabel}>{label}</Text>
                    <Switch value={(inc as any)[k]} onValueChange={(v) => setInc((p) => ({ ...p, [k]: v }))} trackColor={{ true: colors.accent, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? ((inc as any)[k] ? "white" : "#F1F5F9") : undefined} testID={`imp-inc-${k}`} />
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        )}
        <TouchableOpacity style={[styles.saveBtn, (count === 0 || saving) && { opacity: 0.5 }]} onPress={doImport} disabled={count === 0 || saving} testID="import-personal-confirm">
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{count === 0 ? "Select items to import" : `Import ${count} to Team Hub`}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
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
  typeDot: { width: 9, height: 9, borderRadius: 5 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  typeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border },
  addTypeBtn: { borderStyle: "dashed" as const, borderColor: c.accent },
  typeBtnText: { ...typography.caption, fontWeight: "700", color: c.textPrimary },
  repeatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  repeatTitle: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingVertical: 8 },
  editText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: spacing.sm, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.accent, backgroundColor: c.accentSubtle },
  importText: { ...typography.bodyMedium, color: c.accent, fontWeight: "800" },
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
  impRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  impTitle: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary },
  impMeta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  incRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  incLabel: { ...typography.body, color: c.textPrimary, fontWeight: "600" },
});
