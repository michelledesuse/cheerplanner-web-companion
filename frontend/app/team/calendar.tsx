import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert, Switch, Platform, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, type DateData } from "react-native-calendars";
import * as DeviceCalendar from "expo-calendar";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import DateField from "@/src/components/DateField";
import TimeField from "@/src/components/TimeField";
import AddTypeModal from "@/src/components/AddTypeModal";
import { formatTime12, todayISO } from "@/src/utils/format";

type Ev = { event_id: string; occ_date: string; event_date?: string; title: string; event_type?: string; location?: string; address?: string; start_time?: string; end_time?: string; notes?: string; recurring?: boolean; recurrence?: any; exdates?: string[]; cancelled?: boolean; cancel_reason?: string; has_override?: boolean; can_edit?: boolean; rsvp_count?: number; my_rsvps?: { roster_id: string; status: string }[] };

const NOTIFY_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";
// Fire-and-report: text all team parents. Throws if SMS isn't configured.
async function notifyParents(message: string) {
  const r = await api.post<{ sent?: number }>("/team/broadcast/send", { message, recipients: { mode: "all" }, base_url: NOTIFY_BASE });
  return r.data?.sent || 0;
}
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

type CalView = "month" | "week" | "day" | "list";
function isoAddDays(iso: string, n: number): string { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function isoStartOfWeek(iso: string): string { const d = new Date(iso + "T00:00:00"); return isoAddDays(iso, -d.getDay()); }
function fmtDayLong(s: string) { try { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); } catch { return s; } }

export default function TeamCalendar() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [role, setRole] = useState("viewer");
  const [events, setEvents] = useState<Ev[]>([]);
  const [athletes, setAthletes] = useState<Ath[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<Ev | null>(null);
  const [formEv, setFormEv] = useState<Ev | null | "new">(null);
  const [customTypes, setCustomTypes] = useState<{ id: string; label: string; color: string }[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [view, setView] = useState<CalView>("month");
  const [selected, setSelected] = useState<string>(todayISO());
  const [month, setMonth] = useState<string>(todayISO().slice(0, 7));
  const [calKey, setCalKey] = useState<number>(0); // bump only to force-jump the grid (e.g. Today)
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  const allTypes: TypeDef[] = useMemo(() => [
    ...BUILTIN_TYPES,
    ...customTypes.map((t) => ({ key: t.id, label: t.label, icon: "pricetag", color: t.color })),
  ], [customTypes]);
  const typeOf = useCallback((k?: string) => allTypes.find((t) => t.key === k) || BUILTIN_TYPES[0], [allTypes]);

  const range = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    if (view === "day") return { start: selected, end: selected };
    if (view === "week") { const s = isoStartOfWeek(selected); return { start: s, end: isoAddDays(s, 6) }; }
    if (view === "list") { const t = todayISO(); return { start: t, end: isoAddDays(t, 120) }; }
    const [y, m] = month.split("-").map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 0));
    return {
      start: `${startDate.getUTCFullYear()}-${pad(startDate.getUTCMonth() + 1)}-${pad(startDate.getUTCDate())}`,
      end: `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}`,
    };
  }, [view, selected, month]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ role: string; events: Ev[]; athletes?: Ath[] }>(`/team/calendar/events?from_=${range.start}&to=${range.end}`);
      setRole(r.data.role); setEvents(r.data.events || []); setAthletes(r.data.athletes || []);
    } catch (_e) { setEvents([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [range.start, range.end]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { (async () => { try { const ht = await api.get("/household/custom-types"); setCustomTypes(ht.data.event_types || []); } catch (_e) { /* ignore */ } })(); }, []);

  const isStaff = role === "staff";

  // Filter-by-type: chips for the event types present in the current window.
  const presentTypes = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) s.add(e.event_type || "other");
    return allTypes.filter((t) => s.has(t.key));
  }, [events, allTypes]);
  const filteredEvents = useMemo(
    () => (typeFilter.size === 0 ? events : events.filter((e) => typeFilter.has(e.event_type || "other"))),
    [events, typeFilter],
  );
  const toggleType = (k: string) => setTypeFilter((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const markedDates = useMemo(() => {
    const map: Record<string, any> = {};
    const seen: Record<string, Set<string>> = {};
    for (const e of filteredEvents) {
      if (e.cancelled) continue;
      const color = typeOf(e.event_type).color;
      if (!seen[e.occ_date]) seen[e.occ_date] = new Set();
      if (seen[e.occ_date].has(color)) continue;
      seen[e.occ_date].add(color);
      if (!map[e.occ_date]) map[e.occ_date] = { dots: [] };
      map[e.occ_date].dots.push({ key: `${color}-${map[e.occ_date].dots.length}`, color });
    }
    map[selected] = { ...(map[selected] || { dots: [] }), selected: true, selectedColor: colors.accent };
    return map;
  }, [filteredEvents, selected, typeOf]);

  const dayEvents = useCallback((d: string) => filteredEvents.filter((e) => e.occ_date === d), [filteredEvents]);
  const weekDays = useMemo(() => { const s = isoStartOfWeek(selected); return Array.from({ length: 7 }, (_, i) => isoAddDays(s, i)); }, [selected]);

  const renderCard = (e: Ev, showDate = true) => {
    const t = typeOf(e.event_type);
    if (e.cancelled) {
      return (
        <TouchableOpacity key={e.event_id + e.occ_date} style={[styles.card, styles.cardCancelled]} onPress={() => setDetail(e)} testID={`event-${e.event_id}-${e.occ_date}`}>
          {showDate && <View style={styles.dateChip}><Text style={styles.dateChipText}>{fmtDate(e.occ_date)}</Text></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.rowT}>
              <View style={[styles.typeDot, { backgroundColor: colors.textTertiary }]} />
              <Text style={[styles.evTitle, styles.cancelledTitle]} numberOfLines={1}>{e.title}</Text>
            </View>
            <Text style={styles.evMeta}>{[t.label, fmtTime(e.start_time)].filter(Boolean).join(" · ")}</Text>
            {!!e.cancel_reason && <Text style={styles.cancelReason} numberOfLines={2}>“{e.cancel_reason}”</Text>}
          </View>
          <View style={styles.cancelledPill}><Text style={styles.cancelledPillText}>Cancelled</Text></View>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity key={e.event_id + e.occ_date} style={styles.card} onPress={() => setDetail(e)} testID={`event-${e.event_id}-${e.occ_date}`}>
        {showDate && <View style={styles.dateChip}><Text style={styles.dateChipText}>{fmtDate(e.occ_date)}</Text></View>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.rowT}>
            <View style={[styles.typeDot, { backgroundColor: t.color }]} />
            <Text style={styles.evTitle} numberOfLines={1}>{e.title}</Text>
            {e.recurring && <Ionicons name="repeat" size={14} color={colors.textTertiary} />}
            {e.has_override && <Ionicons name="pencil" size={12} color={colors.textTertiary} />}
          </View>
          <Text style={styles.evMeta}>{[t.label, fmtTime(e.start_time), e.location].filter(Boolean).join(" · ") || "All day"}</Text>
          {!isStaff && (e.my_rsvps || []).length > 0 && <Text style={styles.evRsvp}>{e.my_rsvps!.map((m) => athletes.find((a) => a.roster_id === m.roster_id)?.name.split(" ")[0] + ": " + (m.status === "attending" ? "✅" : "❌")).join("  ")}</Text>}
        </View>
        {isStaff && <View style={styles.countChip}><Text style={styles.countText}>{e.rsvp_count || 0}</Text></View>}
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  const emptyDay = <View style={styles.empty}><Ionicons name="calendar-outline" size={26} color={colors.textTertiary} /><Text style={styles.emptyText}>Nothing scheduled.</Text></View>;
  const spinner = <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;

  const doSync = async () => {
    try {
      const r = await api.post<{ added: number; updated: number; removed: number }>("/team/calendar/sync-to-personal", {});
      const { added, updated, removed } = r.data;
      if (!added && !updated && !removed) {
        Alert.alert("Up to date", "Your personal calendar already matches the TeamHub.");
      } else {
        const parts = [];
        if (added) parts.push(`${added} added`);
        if (updated) parts.push(`${updated} updated`);
        if (removed) parts.push(`${removed} removed`);
        Alert.alert("Calendar synced", parts.join(", ") + ".");
      }
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not sync events."); }
  };

  const doRemoveImported = async () => {
    try {
      const r = await api.post<{ removed: number }>("/team/calendar/remove-imported-from-team", {});
      Alert.alert(
        r.data.removed ? "Removed" : "Nothing to remove",
        r.data.removed
          ? `${r.data.removed} TeamHub event${r.data.removed === 1 ? "" : "s"} removed from your personal calendar.`
          : "You don't have any TeamHub events copied to your personal calendar.",
      );
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not remove events."); }
  };

  const importAll = () => {
    Alert.alert(
      "TeamHub → My Calendar",
      "Sync copies new TeamHub events to your personal (family) calendar and updates any that changed. You can also remove ones you added before.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove imported", style: "destructive", onPress: () => Alert.alert("Remove imported events?", "This deletes every TeamHub event you previously copied to your personal calendar. Your own events are untouched.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: doRemoveImported }]) },
        { text: "Sync my calendar", onPress: doSync },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="calendar-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={styles.title}>Calendar</Text><Text style={styles.subtitle}>{isStaff ? "Tap an event to see RSVPs" : "Tap an event to RSVP"}</Text></View>
        {(selected !== todayISO() || month !== todayISO().slice(0, 7)) && <TouchableOpacity onPress={() => { setSelected(todayISO()); setMonth(todayISO().slice(0, 7)); setCalKey((k) => k + 1); }} hitSlop={8} style={{ padding: 4 }} testID="calendar-today"><Ionicons name="today-outline" size={20} color={colors.accent} /></TouchableOpacity>}
        <TouchableOpacity onPress={importAll} hitSlop={8} style={{ padding: 4 }} testID="calendar-import-all"><Ionicons name="cloud-download-outline" size={22} color={colors.accent} /></TouchableOpacity>
        {isStaff && <TouchableOpacity onPress={() => setImportOpen(true)} hitSlop={8} style={{ padding: 4 }} testID="calendar-import-personal"><Ionicons name="albums-outline" size={22} color={colors.accent} /></TouchableOpacity>}
        {isStaff && <TouchableOpacity onPress={() => setFormEv("new")} hitSlop={8} style={{ padding: 4 }} testID="calendar-add-btn"><Ionicons name="add-circle" size={26} color={colors.accent} /></TouchableOpacity>}
      </View>

      <View style={styles.viewToggleRow}>
        <View style={styles.viewToggle}>
          {(["month", "week", "day", "list"] as const).map((v) => (
            <TouchableOpacity key={v} onPress={() => setView(v)} style={[styles.viewChip, view === v && styles.viewChipOn]} testID={`teamcal-view-${v}`}>
              <Text style={[styles.viewChipText, view === v && styles.viewChipTextOn]}>{v[0].toUpperCase() + v.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {presentTypes.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} testID="teamcal-filter-row">
          {typeFilter.size > 0 && (
            <TouchableOpacity onPress={() => setTypeFilter(new Set())} style={styles.filterClear} testID="teamcal-filter-all">
              <Ionicons name="close" size={13} color={colors.accent} /><Text style={styles.filterClearText}>All</Text>
            </TouchableOpacity>
          )}
          {presentTypes.map((t) => {
            const on = typeFilter.has(t.key);
            return (
              <TouchableOpacity key={t.key} onPress={() => toggleType(t.key)} style={[styles.filterChip, on && { backgroundColor: t.color, borderColor: t.color }]} testID={`teamcal-filter-${t.key}`}>
                <View style={[styles.filterDot, { backgroundColor: on ? "white" : t.color }]} />
                <Text style={[styles.filterChipText, on && { color: "white" }]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}>
        {view === "list" && (
          loading ? spinner : filteredEvents.length === 0 ? (
            <View style={styles.empty}><Ionicons name="calendar-outline" size={28} color={colors.textTertiary} /><Text style={styles.emptyText}>{typeFilter.size > 0 ? "No events match this filter." : "No upcoming events."}</Text></View>
          ) : filteredEvents.map((e) => renderCard(e, true))
        )}

        {view === "month" && (
          <>
            <Calendar
              key={calKey}
              current={`${month}-01`}
              markingType="multi-dot"
              markedDates={markedDates}
              onDayPress={(d: DateData) => setSelected(d.dateString)}
              onMonthChange={(d: DateData) => setMonth(`${d.year}-${String(d.month).padStart(2, "0")}`)}
              theme={{
                backgroundColor: colors.bg, calendarBackground: colors.bg,
                todayTextColor: colors.accent, selectedDayBackgroundColor: colors.accent,
                selectedDayTextColor: "white", arrowColor: colors.accent,
                textMonthFontWeight: "800", textDayFontWeight: "500", textDayHeaderFontWeight: "700",
                monthTextColor: colors.textPrimary, dayTextColor: colors.textPrimary,
                textSectionTitleColor: colors.textSecondary,
              }}
              style={styles.calGrid}
            />
            <View style={styles.daySection}>
              <Text style={styles.dayTitle}>{fmtDayLong(selected)}</Text>
              {loading ? spinner : dayEvents(selected).length === 0 ? emptyDay : dayEvents(selected).map((e) => renderCard(e, false))}
            </View>
          </>
        )}

        {view === "day" && (
          <View style={styles.daySection}>
            <View style={styles.navRow}>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, -1))} style={styles.navBtn} testID="teamcal-prev"><Ionicons name="chevron-back" size={20} color={colors.textPrimary} /></TouchableOpacity>
              <Text style={styles.dayTitle}>{fmtDayLong(selected)}</Text>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, 1))} style={styles.navBtn} testID="teamcal-next"><Ionicons name="chevron-forward" size={20} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            {loading ? spinner : dayEvents(selected).length === 0 ? emptyDay : dayEvents(selected).map((e) => renderCard(e, false))}
          </View>
        )}

        {view === "week" && (
          <View style={styles.daySection}>
            <View style={styles.navRow}>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, -7))} style={styles.navBtn} testID="teamcal-prev"><Ionicons name="chevron-back" size={20} color={colors.textPrimary} /></TouchableOpacity>
              <Text style={styles.dayTitle}>Week of {fmtDate(weekDays[0])}</Text>
              <TouchableOpacity onPress={() => setSelected(isoAddDays(selected, 7))} style={styles.navBtn} testID="teamcal-next"><Ionicons name="chevron-forward" size={20} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            {loading ? spinner : weekDays.map((d) => (
              <View key={d} style={{ marginBottom: spacing.md }}>
                <Text style={styles.weekDayHead}>{fmtDayLong(d)}</Text>
                {dayEvents(d).length === 0 ? <Text style={styles.weekEmpty}>—</Text> : dayEvents(d).map((e) => renderCard(e, false))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {detail && <DetailModal ev={detail} isStaff={isStaff} athletes={athletes} typeOf={typeOf} onEdit={() => { const d = detail; setDetail(null); setFormEv(d); }} onClose={() => setDetail(null)} onChanged={load} styles={styles} />}
      {formEv && <EventForm ev={formEv === "new" ? null : formEv} allTypes={allTypes} customTypes={customTypes} setCustomTypes={setCustomTypes} onClose={() => setFormEv(null)} onSaved={() => { setFormEv(null); load(); }} onChanged={load} styles={styles} />}
      {importOpen && <ImportFromPersonalModal onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} styles={styles} />}
    </SafeAreaView>
  );
}

function ConfirmModal({ visible, title, message, confirmText, cancelText, destructive, onConfirm, onCancel, styles }: any) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.confirmWrap} onPress={onCancel}>
        <Pressable style={styles.confirmCard} onPress={() => {}} testID="calendar-confirm-modal">
          <Text style={styles.confirmTitle}>{title}</Text>
          <Text style={styles.confirmMsg}>{message}</Text>
          <TouchableOpacity style={[styles.saveBtn, destructive && { backgroundColor: "#DC2626" }]} onPress={onConfirm} testID="calendar-confirm-yes">
            <Text style={styles.saveText}>{confirmText}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 10, alignItems: "center" }} testID="calendar-confirm-no">
            <Text style={styles.cancelText}>{cancelText || "Cancel"}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OccurrenceForm({ ev, onClose, onSaved, styles }: any) {
  const [startTime, setStartTime] = useState<string>(ev?.start_time || "");
  const [endTime, setEndTime] = useState<string>(ev?.end_time || "");
  const [loc, setLoc] = useState<string>(ev?.location || "");
  const [address, setAddress] = useState<string>(ev?.address || "");
  const [notes, setNotes] = useState<string>(ev?.notes || "");
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/team/calendar/events/${ev.event_id}/override-occurrence`, {
        occ_date: ev.occ_date, start_time: startTime, end_time: endTime,
        location: loc.trim(), address: address.trim(), notes: notes.trim(),
      });
      if (notify) {
        const when = `${fmtDate(ev.occ_date)}${startTime ? ` at ${formatTime12(startTime)}` : ""}`;
        try {
          const sent = await notifyParents(`Update: "${ev.title}" on ${when}${loc.trim() ? ` is now at ${loc.trim()}` : " has changed"}. Check the team calendar for details.`);
          Alert.alert("Saved", `This date was updated and ${sent} parent${sent === 1 ? "" : "s"} were texted.`);
        } catch (e: any) { Alert.alert("Saved (not texted)", e?.response?.data?.detail || "The date was updated, but the text couldn't be sent."); }
      }
      onSaved();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not save this date."); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="occurrence-edit-modal">
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
          <Text style={styles.sheetTitle}>Edit just this date</Text>
          <Text style={styles.sheetSub2}>{fmtDate(ev.occ_date)} · changes apply only to this one date, not the rest of the series.</Text>

          <Text style={styles.secLbl}>Start time</Text>
          <View style={{ marginTop: 8 }}><TimeField value={startTime} onChange={setStartTime} testID="occ-start-time" /></View>

          <Text style={styles.secLbl}>End time</Text>
          <View style={{ marginTop: 8 }}><TimeField value={endTime} onChange={setEndTime} testID="occ-end-time" /></View>

          <Text style={styles.secLbl}>Location (just this date)</Text>
          <TextInput style={styles.input} value={loc} onChangeText={setLoc} placeholder="e.g. Backup gym" placeholderTextColor={colors.textTertiary} testID="occ-location" />

          <Text style={styles.secLbl}>Address (just this date, for maps)</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="123 Main St, San Marcos, CA" placeholderTextColor={colors.textTertiary} autoCapitalize="words" testID="occ-address" />

          <Text style={styles.secLbl}>Notes (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60, maxHeight: 140, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} multiline placeholder="e.g. Earlier start this week" placeholderTextColor={colors.textTertiary} testID="occ-notes" />

          <View style={styles.notifyRow}>
            <View style={{ flex: 1 }}><Text style={styles.notifyTitle}>Text parents about this change</Text><Text style={styles.notifyHint}>Sends a quick heads-up to the whole roster.</Text></View>
            <Switch value={notify} onValueChange={setNotify} trackColor={{ true: colors.accent, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? (notify ? "white" : "#F1F5F9") : undefined} testID="occ-notify" />
          </View>

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="occ-save-btn">{saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Save this date</Text>}</TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </ScrollView>
      </Pressable></Pressable>
    </Modal>
  );
}

function CancelDatesForm({ ev, mode, onClose, onDone, styles }: any) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const [from, setFrom] = useState<string>(ev?.occ_date || todayISO());
  const [to, setTo] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const isRange = mode === "range";

  const submit = async () => {
    if (isRange && (!from || !to || to < from)) { Alert.alert("Pick dates", "Choose a valid start and end date."); return; }
    setSaving(true);
    try {
      let count = 1;
      if (isRange) {
        const r = await api.post<{ cancelled: number }>(`/team/calendar/events/${ev.event_id}/cancel-range`, { from, to, reason: reason.trim() });
        count = r.data?.cancelled || 0;
      } else {
        await api.post(`/team/calendar/events/${ev.event_id}/cancel-occurrence`, { occ_date: ev.occ_date, reason: reason.trim() });
      }
      if (notify && count > 0) {
        const span = isRange ? `${fmtDate(from)} – ${fmtDate(to)}` : fmtDate(ev.occ_date);
        try {
          const sent = await notifyParents(`Cancelled: "${ev.title}" on ${span}.${reason.trim() ? ` ${reason.trim()}` : ""}`);
          Alert.alert("Cancelled", `${count} date${count === 1 ? "" : "s"} cancelled and ${sent} parent${sent === 1 ? "" : "s"} were texted.`);
        } catch (e: any) { Alert.alert("Cancelled (not texted)", e?.response?.data?.detail || "Dates were cancelled, but the text couldn't be sent."); }
      } else if (isRange) {
        Alert.alert("Cancelled", `${count} date${count === 1 ? "" : "s"} cancelled.`);
      }
      onDone();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not cancel."); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="cancel-dates-modal">
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
          <Text style={styles.sheetTitle}>{isRange ? "Cancel a range of dates" : "Cancel this date"}</Text>
          <Text style={styles.sheetSub2}>{isRange ? "Cancels every occurrence of this event between the two dates (e.g. a holiday break). Restore any later from Edit event." : `${fmtDate(ev.occ_date)} — the rest of the series stays.`}</Text>

          {isRange && (
            <>
              <Text style={styles.secLbl}>From</Text>
              <View style={{ marginTop: 8 }}><DateField value={from} onChange={setFrom} testID="cancel-from-date" /></View>
              <Text style={styles.secLbl}>To</Text>
              <View style={{ marginTop: 8 }}><DateField value={to} onChange={setTo} testID="cancel-to-date" /></View>
            </>
          )}

          <Text style={styles.secLbl}>Reason (optional, shown to parents)</Text>
          <TextInput style={styles.input} value={reason} onChangeText={setReason} placeholder="e.g. Gym closed for the holiday" placeholderTextColor={colors.textTertiary} testID="cancel-reason" />

          <View style={styles.notifyRow}>
            <View style={{ flex: 1 }}><Text style={styles.notifyTitle}>Text parents about this</Text><Text style={styles.notifyHint}>Sends a quick heads-up to the whole roster.</Text></View>
            <Switch value={notify} onValueChange={setNotify} trackColor={{ true: colors.accent, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? (notify ? "white" : "#F1F5F9") : undefined} testID="cancel-notify" />
          </View>

          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: "#DC2626" }, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} testID="cancel-dates-confirm">{saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{isRange ? "Cancel these dates" : "Cancel this date"}</Text>}</TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Keep dates</Text></TouchableOpacity>
        </ScrollView>
      </Pressable></Pressable>
    </Modal>
  );
}

function DetailModal({ ev, isStaff, athletes, typeOf, onEdit, onClose, onChanged, styles }: any) {
  const [rsvps, setRsvps] = useState<any[]>([]);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [cancelMode, setCancelMode] = useState<null | "single" | "range">(null);
  const [occEditOpen, setOccEditOpen] = useState(false);
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
  const cancelOcc = () => setCancelMode("single");
  const restoreThis = async () => {
    try {
      await api.post(`/team/calendar/events/${ev.event_id}/restore-occurrence`, { occ_date: ev.occ_date });
      onChanged(); onClose();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not restore this date."); }
  };
  const resetOverride = async () => {
    try {
      await api.post(`/team/calendar/events/${ev.event_id}/clear-override`, { occ_date: ev.occ_date });
      onChanged(); onClose();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not reset this date."); }
  };
  const hide = async () => { await api.post("/team/calendar/hide", { event_id: ev.event_id, occ_date: ev.occ_date }); onChanged(); onClose(); };
  const addToMine = async () => {
    try {
      const r = await api.post<{ already?: boolean }>("/team/calendar/import-to-personal", { event_id: ev.event_id });
      Alert.alert(r.data.already ? "Already added" : "Added to your calendar", r.data.already ? "This event is already on your personal calendar." : "The event was added to your family calendar.");
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not add to your calendar."); }
  };
  const addToPhone = async () => {
    try {
      const mk = (t?: string) => { const [h, m] = (t || "00:00").split(":").map(Number); const d = new Date(ev.occ_date + "T00:00:00"); d.setHours(h || 0, m || 0, 0, 0); return d; };
      const allDay = !ev.start_time;
      const start = allDay ? new Date(ev.occ_date + "T00:00:00") : mk(ev.start_time);
      let end: Date;
      if (allDay) { end = new Date(start); end.setDate(end.getDate() + 1); }
      else if (ev.end_time) { end = mk(ev.end_time); if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000); }
      else { end = new Date(start.getTime() + 60 * 60 * 1000); }
      const location = [ev.location, ev.address].filter(Boolean).join(", ");
      await DeviceCalendar.createEventInCalendarAsync(
        { title: ev.title, startDate: start, endDate: end, allDay, location, notes: ev.notes || "" },
        { startNewActivityTask: false },
      );
    } catch (e: any) {
      Alert.alert("Couldn't open calendar", e?.message || "Please try again, or add this event manually.");
    }
  };

  const timeStr = [ev.start_time && formatTime12(ev.start_time), ev.end_time && formatTime12(ev.end_time)].filter(Boolean).join(" – ");

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="event-detail-modal">
        <View style={styles.rowT}><View style={[styles.typeDot, { backgroundColor: t.color }]} /><Text style={styles.sheetTitle}>{ev.title}</Text></View>
        <Text style={styles.sheetSub2}>{[t.label, fmtDate(ev.occ_date), timeStr, ev.location].filter(Boolean).join(" · ")}</Text>
        {!!ev.cancelled && <View style={styles.cancelBanner}><Ionicons name="close-circle" size={15} color="#B45309" /><Text style={styles.cancelBannerText}>This date is cancelled.{ev.cancel_reason ? ` ${ev.cancel_reason}` : ""}</Text></View>}
        {!!ev.address && <Text style={styles.sheetSub2}>{ev.address}</Text>}
        {!!ev.notes && <Text style={styles.notes}>{ev.notes}</Text>}
        <ScrollView style={{ maxHeight: 360 }}>
          {isStaff ? (
            <>
              <Text style={styles.secLbl}>RSVPs</Text>
              {ev.cancelled ? <Text style={styles.dim}>RSVPs are paused while this date is cancelled.</Text> : rsvps.length === 0 ? <Text style={styles.dim}>No responses yet.</Text> : rsvps.map((r) => (
                <View key={r.roster_id} style={styles.rsvpRow}><Text style={styles.rsvpName}>{r.athlete_name}</Text><Text style={[styles.rsvpStat, { color: r.status === "attending" ? "#10B981" : "#0F172A" }]}>{r.status === "attending" ? "Attending" : "Not attending"}</Text>{!!r.reason && <Text style={styles.rsvpReason}>“{r.reason}”</Text>}</View>
              ))}
              {!ev.cancelled && <TouchableOpacity style={styles.editBtn} onPress={onEdit} testID="event-edit"><Ionicons name="create-outline" size={16} color={colors.accent} /><Text style={styles.editText}>Edit event{ev.recurring ? " (all dates)" : ""}</Text></TouchableOpacity>}
              {ev.recurring && !ev.cancelled && <TouchableOpacity style={styles.editBtn} onPress={() => setOccEditOpen(true)} testID="event-edit-occurrence"><Ionicons name="time-outline" size={16} color={colors.accent} /><Text style={styles.editText}>Edit just this date (time / notes)</Text></TouchableOpacity>}
              {ev.recurring && ev.has_override && !ev.cancelled && <TouchableOpacity style={styles.editBtn} onPress={resetOverride} testID="event-reset-override"><Ionicons name="refresh-outline" size={16} color={colors.textSecondary} /><Text style={[styles.editText, { color: colors.textSecondary }]}>Reset this date to series default</Text></TouchableOpacity>}
              {ev.recurring && !ev.cancelled && <TouchableOpacity style={styles.cancelOccBtn} onPress={cancelOcc} testID="event-cancel-occurrence"><Ionicons name="close-circle-outline" size={16} color="#B45309" /><Text style={styles.cancelOccText}>Cancel just this date</Text></TouchableOpacity>}
              {ev.recurring && !ev.cancelled && <TouchableOpacity style={styles.cancelOccBtn} onPress={() => setCancelMode("range")} testID="event-cancel-range"><Ionicons name="calendar-clear-outline" size={16} color="#B45309" /><Text style={styles.cancelOccText}>Cancel a range of dates…</Text></TouchableOpacity>}
              {ev.recurring && ev.cancelled && <TouchableOpacity style={styles.editBtn} onPress={restoreThis} testID="event-restore-occurrence"><Ionicons name="refresh-outline" size={16} color={colors.accent} /><Text style={styles.editText}>Restore this date</Text></TouchableOpacity>}
              <TouchableOpacity style={styles.delBtn} onPress={del} testID="event-delete"><Ionicons name="trash-outline" size={16} color="#0F172A" /><Text style={styles.delText}>Delete event{ev.recurring ? " (all dates)" : ""}</Text></TouchableOpacity>
            </>
          ) : ev.cancelled ? (
            <Text style={styles.dim}>Your coach cancelled this date. The rest of the series is unchanged.</Text>
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
        <TouchableOpacity style={styles.phoneBtn} onPress={addToPhone} testID="event-add-phone"><Ionicons name="phone-portrait-outline" size={16} color={colors.accent} /><Text style={styles.importText}>Add to phone calendar</Text></TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Close</Text></TouchableOpacity>
      </Pressable></Pressable>
      {cancelMode && <CancelDatesForm ev={ev} mode={cancelMode} onClose={() => setCancelMode(null)} onDone={() => { setCancelMode(null); onChanged(); onClose(); }} styles={styles} />}
      {occEditOpen && <OccurrenceForm ev={ev} onClose={() => setOccEditOpen(false)} onSaved={() => { setOccEditOpen(false); onChanged(); onClose(); }} styles={styles} />}
    </Modal>
  );
}

function EventForm({ ev, allTypes, customTypes, setCustomTypes, onClose, onSaved, onChanged, styles }: any) {
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
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

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
  const [exdates, setExdates] = useState<string[]>(Array.isArray(ev?.exdates) ? ev.exdates : []);

  const restoreOcc = async (d: string) => {
    try {
      await api.post(`/team/calendar/events/${ev.event_id}/restore-occurrence`, { occ_date: d });
      setExdates((p) => p.filter((x) => x !== d));
      onChanged?.();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not restore that date."); }
  };

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

  const doSave = async () => {
    setConfirmAllOpen(false);
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

  const save = () => {
    if (!title.trim()) { Alert.alert("Missing", "Add a title."); return; }
    if (!date) { Alert.alert("Missing", "Pick a start date."); return; }
    if (repeat && (mode === "weekly" || mode === "biweekly") && wd.length === 0) { Alert.alert("Missing", "Pick at least one day of the week."); return; }
    // Edit-All confirmation: editing a repeating event changes every date.
    const wasRecurring = isEdit && !!ev?.recurrence?.freq && ev.recurrence.freq !== "none";
    if (wasRecurring) { setConfirmAllOpen(true); return; }
    doSave();
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

          {isEdit && exdates.length > 0 && (
            <>
              <Text style={styles.secLbl}>Cancelled dates</Text>
              <Text style={styles.sheetSub2}>These dates are hidden from the series. Restore any to bring it back.</Text>
              {exdates.slice().sort().map((d) => (
                <View key={d} style={styles.exRow}>
                  <View style={styles.rowT}><Ionicons name="close-circle" size={15} color="#B45309" /><Text style={styles.exText}>{fmtDate(d)}</Text></View>
                  <TouchableOpacity onPress={() => restoreOcc(d)} hitSlop={8} testID={`restore-${d}`}><Text style={styles.exRestore}>Restore</Text></TouchableOpacity>
                </View>
              ))}
            </>
          )}

          <Text style={styles.secLbl}>Notes (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60, maxHeight: 140, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} multiline placeholder="e.g. Wear comp shoes" placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="event-save-btn">{saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{isEdit ? "Save changes" : "Create event"}</Text>}</TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </ScrollView>
      </Pressable></Pressable>
      <AddTypeModal visible={addTypeOpen} title="New event type" placeholder="e.g. Tumbling" withColor onSubmit={(name: string, color?: string) => addType(name, color)} onClose={() => setAddTypeOpen(false)} />
      <ConfirmModal
        visible={confirmAllOpen}
        title="Update every date?"
        message="This is a repeating event, so your changes apply to all dates in the series. To change just one day, close this and cancel that single date instead."
        confirmText="Update all dates"
        onConfirm={doSave}
        onCancel={() => setConfirmAllOpen(false)}
        styles={styles}
      />
    </Modal>
  );
}

type ImpComp = { id: string; name: string; date?: string; already?: boolean };
type ImpEvent = { id: string; title: string; date?: string; event_type?: string; series_id?: string | null; already?: boolean };
type Importable = { competitions: ImpComp[]; events: ImpEvent[] };

function ImportFromPersonalModal({ onClose, onDone, styles }: any) {
  const [data, setData] = useState<Importable>({ competitions: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Record<string, "competition" | "schedule">>({});
  const [inc, setInc] = useState({ travel: true, teams_to_watch: true, packing_list: true, links: true });
  const [saving, setSaving] = useState(false);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const inRange = (d?: string) => { const s = String(d || "").slice(0, 10); if (!s) return false; if (fromDate && s < fromDate) return false; if (toDate && s > toDate) return false; return true; };

  useEffect(() => { (async () => {
    try { const r = await api.get<Importable>("/team/calendar/importable"); setData(r.data || { competitions: [], events: [] }); }
    catch { setData({ competitions: [], events: [] }); }
    finally { setLoading(false); }
  })(); }, []);

  const toggle = (id: string, source: "competition" | "schedule") => setSel((p) => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = source; return n; });
  const setMany = (items: { id: string; source: "competition" | "schedule" }[], on: boolean) =>
    setSel((p) => { const n = { ...p }; items.forEach(({ id, source }) => { if (on) n[id] = source; else delete n[id]; }); return n; });
  const count = Object.keys(sel).length;

  // Split events into repeating series (2+ dates) and single events.
  const { singleEvents, seriesGroups } = useMemo(() => {
    const byId = new Map<string, ImpEvent[]>();
    const singles: ImpEvent[] = [];
    for (const e of data.events) {
      if (e.series_id) { const a = byId.get(e.series_id) || []; a.push(e); byId.set(e.series_id, a); }
      else singles.push(e);
    }
    const groups: { sid: string; items: ImpEvent[] }[] = [];
    byId.forEach((items, sid) => {
      if (items.length > 1) groups.push({ sid, items: items.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) });
      else singles.push(items[0]);
    });
    singles.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    groups.sort((a, b) => String(a.items[0]?.date).localeCompare(String(b.items[0]?.date)));
    return { singleEvents: singles, seriesGroups: groups };
  }, [data.events]);

  const visibleComps = data.competitions.filter((c) => inRange(c.date));
  const visibleSingles = singleEvents.filter((e) => inRange(e.date));
  const visibleSeries = seriesGroups.filter((g) => g.items.some((it) => inRange(it.date)));

  const selectableComp = visibleComps.filter((c) => !c.already);
  // A repeating series imports as ONE recurring event — represent it by its first occurrence.
  const seriesUnits = visibleSeries
    .filter((g) => !g.items.some((e) => e.already))
    .map((g) => ({ id: g.items[0].id, source: "schedule" as const }));
  const selectableSingles = visibleSingles.filter((e) => !e.already).map((e) => ({ id: e.id, source: "schedule" as const }));
  const allSelectable = [
    ...selectableComp.map((c) => ({ id: c.id, source: "competition" as const })),
    ...seriesUnits,
    ...selectableSingles,
  ];
  const allSelected = allSelectable.length > 0 && allSelectable.every(({ id }) => sel[id]);
  // How many actual dates will land on the team calendar (a series counts as its occurrences).
  const seriesRepCount: Record<string, number> = {};
  visibleSeries.forEach((g) => { seriesRepCount[g.items[0].id] = g.items.length; });
  const dateCount = Object.keys(sel).reduce((acc, id) => acc + (seriesRepCount[id] || 1), 0);

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
      Alert.alert("Imported to TeamHub", parts.join(", ") + ".");
      onDone();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not import."); }
    finally { setSaving(false); }
  };

  const hasAny = data.competitions.length > 0 || data.events.length > 0;

  const CheckRow = ({ id, source, title, date, icon, iconColor, already, indent }: any) => {
    const on = !!sel[id];
    return (
      <TouchableOpacity
        key={id}
        style={[styles.impRow, indent && { paddingLeft: 18 }, already && { opacity: 0.5 }]}
        onPress={() => { if (!already) toggle(id, source); }}
        disabled={already}
        testID={`imp-${source === "competition" ? "comp" : "ev"}-${id}`}
      >
        <Ionicons
          name={already ? "checkmark-circle" : on ? "checkbox" : "square-outline"}
          size={22}
          color={already ? "#10B981" : on ? colors.accent : colors.textTertiary}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.impTitle} numberOfLines={1}>{title}</Text>
          {!!date && <Text style={styles.impMeta}>{fmtDate(String(date).slice(0, 10))}</Text>}
        </View>
        {already ? <View style={styles.addedPill}><Text style={styles.addedPillText}>Added</Text></View> : <Ionicons name={icon} size={16} color={iconColor} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}><Pressable style={styles.sheet} onPress={() => {}} testID="import-personal-modal">
        <View style={styles.rowT}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>Import to TeamHub</Text>
            <Text style={styles.sheetSub2}>Pick your competitions & events to add to the team calendar.</Text>
          </View>
          {hasAny && allSelectable.length > 0 && (
            <TouchableOpacity onPress={() => setMany(allSelectable, !allSelected)} style={styles.selectAllBtn} testID="imp-select-all">
              <Ionicons name={allSelected ? "close-circle-outline" : "checkmark-done-outline"} size={16} color={colors.accent} />
              <Text style={styles.selectAllText}>{allSelected ? "Clear" : "Select all"}</Text>
            </TouchableOpacity>
          )}
        </View>
        {loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} /> : (
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator>
            {!hasAny && <Text style={[styles.dim, { marginTop: 12 }]}>Nothing to import yet. Add competitions or upcoming schedule events in the parent portal first.</Text>}

            {hasAny && (
              <View style={styles.rangeBox} testID="imp-date-range">
                <Text style={styles.rangeLabel}>Only show dates in this range (optional)</Text>
                <View style={styles.rangeRow}>
                  <View style={{ flex: 1 }}><Text style={styles.rangeSub}>From</Text><DateField value={fromDate} onChange={setFromDate} testID="imp-from-date" /></View>
                  <View style={{ flex: 1 }}><Text style={styles.rangeSub}>To</Text><DateField value={toDate} onChange={setToDate} testID="imp-to-date" /></View>
                </View>
                {(!!fromDate || !!toDate) && (
                  <TouchableOpacity onPress={() => { setFromDate(""); setToDate(""); }} style={styles.rangeClear} testID="imp-range-clear"><Text style={styles.rangeClearText}>Clear range</Text></TouchableOpacity>
                )}
              </View>
            )}

            {visibleComps.length > 0 && <Text style={styles.secLbl}>Competitions</Text>}
            {visibleComps.map((c) => (
              <CheckRow key={c.id} id={c.id} source="competition" title={c.name} date={c.date} icon="trophy" iconColor="#F59E0B" already={c.already} />
            ))}

            {visibleSeries.length > 0 && <Text style={styles.secLbl}>Repeating series</Text>}
            {visibleSeries.map(({ sid, items }) => {
              const rep = items[0];
              const last = items[items.length - 1];
              const already = items.some((e) => e.already);
              const on = !!sel[rep.id];
              return (
                <TouchableOpacity
                  key={sid}
                  style={[styles.impRow, already && { opacity: 0.5 }]}
                  onPress={() => { if (!already) toggle(rep.id, "schedule"); }}
                  disabled={already}
                  testID={`imp-series-${sid}`}
                >
                  <Ionicons
                    name={already ? "checkmark-circle" : on ? "checkbox" : "square-outline"}
                    size={22}
                    color={already ? "#10B981" : on ? colors.accent : colors.textTertiary}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.rowT}>
                      <Ionicons name="repeat" size={13} color={colors.textSecondary} />
                      <Text style={styles.impTitle} numberOfLines={1}>  {rep.title}</Text>
                    </View>
                    <Text style={styles.impMeta}>Repeats · {items.length} dates · {fmtDate(String(rep.date).slice(0, 10))} – {fmtDate(String(last.date).slice(0, 10))}</Text>
                  </View>
                  {already ? <View style={styles.addedPill}><Text style={styles.addedPillText}>Added</Text></View> : <Ionicons name="repeat" size={16} color={colors.textSecondary} />}
                </TouchableOpacity>
              );
            })}

            {visibleSingles.length > 0 && <Text style={styles.secLbl}>Upcoming events</Text>}
            {visibleSingles.map((e) => (
              <CheckRow key={e.id} id={e.id} source="schedule" title={e.title} date={e.date} icon="calendar" iconColor={colors.textTertiary} already={e.already} />
            ))}

            {hasAny && visibleComps.length === 0 && visibleSeries.length === 0 && visibleSingles.length === 0 && (
              <Text style={[styles.dim, { marginTop: 12 }]}>No items in this date range. Widen the range above.</Text>
            )}

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
        {count > 0 && <Text style={styles.impPreview}>{`Adds ${dateCount} date${dateCount === 1 ? "" : "s"} to the team calendar${count !== dateCount ? ` (${count} item${count === 1 ? "" : "s"})` : ""}.`}</Text>}
        <TouchableOpacity style={[styles.saveBtn, (count === 0 || saving) && { opacity: 0.5 }]} onPress={doImport} disabled={count === 0 || saving} testID="import-personal-confirm">
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{count === 0 ? "Select items to import" : `Import ${dateCount} date${dateCount === 1 ? "" : "s"}`}</Text>}
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
  cardCancelled: { opacity: 0.7, backgroundColor: c.cardSubtle, borderStyle: "dashed" as const },
  cancelledTitle: { textDecorationLine: "line-through" as const, color: c.textSecondary },
  cancelledPill: { backgroundColor: "#FEF3C7", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  cancelledPillText: { ...typography.caption, color: "#B45309", fontWeight: "800", fontSize: 11 },
  cancelBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF3C7", borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  cancelBannerText: { ...typography.caption, color: "#B45309", fontWeight: "800" },
  cancelReason: { ...typography.caption, color: "#B45309", fontStyle: "italic", marginTop: 2 },
  notifyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: spacing.md, paddingVertical: 4 },
  notifyTitle: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  notifyHint: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
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
  phoneBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: spacing.xs, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
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
  rsvpBtnOn: { backgroundColor: "#10B981", borderColor: "#10B981" }, rsvpBtnNo: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  rsvpBtnText: { ...typography.caption, fontWeight: "800", color: c.textPrimary },
  reasonInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 10, ...typography.body, color: c.textPrimary },
  hideBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingVertical: 8 },
  hideText: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  delBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingVertical: 8 }, delText: { ...typography.caption, color: "#0F172A", fontWeight: "800" },
  cancelOccBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingVertical: 8 },
  cancelOccText: { ...typography.caption, color: "#B45309", fontWeight: "800" },
  exRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  exText: { ...typography.body, color: c.textPrimary },
  exRestore: { ...typography.caption, color: c.accent, fontWeight: "800" },
  impPreview: { ...typography.caption, color: c.textSecondary, fontWeight: "700", textAlign: "center", marginTop: spacing.sm },
  rangeBox: { backgroundColor: c.bg, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.sm, marginTop: spacing.sm, gap: 6 },
  rangeLabel: { ...typography.caption, fontWeight: "800", color: c.textTertiary, letterSpacing: 0.5 },
  rangeRow: { flexDirection: "row", gap: 10 },
  rangeSub: { ...typography.caption, color: c.textSecondary, marginBottom: 4 },
  rangeClear: { alignSelf: "flex-start", paddingVertical: 4 },
  rangeClearText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  confirmWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  confirmCard: { backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg, gap: 6 },
  confirmTitle: { ...typography.h3, color: c.textPrimary },
  confirmMsg: { ...typography.body, color: c.textSecondary, marginTop: 2 },
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
  viewToggleRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  viewToggle: { flexDirection: "row", backgroundColor: c.card, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: c.border },
  viewChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  viewChipOn: { backgroundColor: c.accent },
  viewChipText: { ...typography.caption, fontWeight: "800", color: c.textSecondary },
  viewChipTextOn: { color: "white" },
  calGrid: { marginHorizontal: spacing.md, marginTop: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, paddingBottom: 8 },
  daySection: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  dayTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.xs },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  weekDayHead: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, marginBottom: 6 },
  weekEmpty: { ...typography.caption, color: c.textTertiary, marginBottom: 4 },
  addedPill: { backgroundColor: "#10B98122", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  addedPillText: { ...typography.caption, color: "#059669", fontWeight: "800", fontSize: 11 },
  selectAllBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.accentSubtle, borderWidth: 1, borderColor: c.accent },
  selectAllText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  seriesBlock: { borderLeftWidth: 2, borderLeftColor: c.border, paddingLeft: 6, marginTop: 2 },
  seriesCount: { ...typography.caption, color: c.textSecondary, fontWeight: "800" },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 2 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  filterChipText: { ...typography.caption, fontWeight: "800", color: c.textSecondary },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  filterClear: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.accent, backgroundColor: c.accentSubtle },
  filterClearText: { ...typography.caption, fontWeight: "800", color: c.accent },
});
