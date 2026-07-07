import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { todayISO } from "@/src/utils/format";
import DateField from "@/src/components/DateField";
import TimeField from "@/src/components/TimeField";
import TeamAvatar from "@/src/components/TeamAvatar";
import LinksEditor, { cleanLinks, type ExternalLink } from "@/src/components/LinksEditor";

const TYPES = [
  { key: "practice", label: "Practice", icon: "barbell", color: "#EA580C" },
  { key: "team_bonding", label: "Team Bonding", icon: "happy", color: "#0EA5E9" },
  { key: "private_lesson", label: "Private Lesson", icon: "person", color: "#DB2777" },
  { key: "choreography", label: "Choreography", icon: "musical-notes", color: "#9333EA" },
  { key: "class", label: "Class", icon: "school", color: "#0891B2" },
  { key: "fundraiser", label: "Fundraiser", icon: "gift", color: "#16A34A" },
  { key: "other", label: "Other", icon: "calendar", color: "#64748B" },
] as const;

const FREQUENCIES = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "biweekly", label: "Bi-weekly" },
  { key: "monthly", label: "Monthly" },
] as const;

// Sun=0..Sat=6 (matches JS Date.getDay() and backend rule format).
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Athlete = { id: string; name: string; avatar_color?: string };
type Team = { id: string; name: string; color?: string; logo_image?: string | null };
type Rule = { frequency: string; days_of_week: number[]; until: string };

function defaultUntil(fromISO: string): string {
  try {
    const d = new Date(`${fromISO}T00:00:00`);
    d.setMonth(d.getMonth() + 3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return fromISO;
  }
}

function dowFromISO(iso: string): number {
  try { return new Date(`${iso}T00:00:00`).getDay(); } catch { return 0; }
}

export default function ScheduleForm() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!params.id;

  const [eventType, setEventType] = useState<string>("practice");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<ExternalLink[]>([]);

  // Recurrence
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<string>("weekly");
  const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(new Set());
  const [until, setUntil] = useState<string>(defaultUntil(todayISO()));

  // Edit-time series context (set when editing an event that is part of a series)
  const [seriesId, setSeriesId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const isPartOfSeries = !!seriesId;

  useEffect(() => {
    (async () => {
      const a = await api.get<Athlete[]>("/athletes");
      setAthletes(a.data);
      try { const tr = await api.get<Team[]>("/teams"); setTeams(tr.data); } catch (_) { /* ignore */ }
      if (isEdit) {
        try {
          const r = await api.get("/schedule");
          const e = (r.data as any[]).find(x => x.id === params.id);
          if (e) {
            setEventType(e.event_type || "practice");
            setTitle(e.title || "");
            setLocation(e.location || "");
            setAddress(e.address || "");
            setDate(e.date || todayISO());
            setStartTime(e.start_time || "");
            setEndTime(e.end_time || "");
            setNotes(e.notes || "");
            setSelectedIds(new Set(e.athlete_ids || []));
            setTeamId(e.team_id || null);
            setEndDate(e.end_date || "");
            setSeriesId(e.series_id || null);
            setLinks(Array.isArray(e.links) ? e.links : []);
            if (e.recurrence_rule) {
              setRepeat(true);
              setFrequency(e.recurrence_rule.frequency || "weekly");
              setDaysOfWeek(new Set(e.recurrence_rule.days_of_week || []));
              setUntil(e.recurrence_rule.until || defaultUntil(e.date || todayISO()));
            }
          }
        } finally { setLoading(false); }
      }
    })();
  }, [isEdit, params.id]);

  // When the start date changes and weekly/biweekly is on with no day picked, seed the date's DOW.
  useEffect(() => {
    if (repeat && (frequency === "weekly" || frequency === "biweekly") && daysOfWeek.size === 0) {
      const d = dowFromISO(date);
      setDaysOfWeek(new Set([d]));
    }
  }, [repeat, frequency, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAthlete = (id: string) => {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleDow = (i: number) => {
    setDaysOfWeek(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  };

  const buildPayload = (includeRecurrence: boolean) => ({
    event_type: eventType,
    title: title.trim(),
    location: location.trim() || null,
    address: address.trim() || null,
    team_id: teamId || null,
    end_date: (!repeat && endDate && endDate > date) ? endDate : null,
    date,
    start_time: startTime.trim() || null,
    end_time: endTime.trim() || null,
    notes: notes.trim() || null,
    athlete_ids: Array.from(selectedIds),
    links: cleanLinks(links),
    ...(includeRecurrence && repeat ? {
      recurrence_rule: {
        frequency,
        days_of_week: (frequency === "weekly" || frequency === "biweekly")
          ? Array.from(daysOfWeek).sort((a, b) => a - b)
          : [],
        until,
      },
    } : {}),
  });

  const doSave = async (scope: "single" | "series") => {
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/schedule/${params.id}?scope=${scope}`, buildPayload(false));
      } else {
        await api.post("/schedule", buildPayload(true));
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  const save = async () => {
    if (!title.trim()) { Alert.alert("Missing", "Add a title."); return; }
    if (repeat && !until) { Alert.alert("Missing", "Pick a 'Repeat until' date."); return; }
    if (repeat && (frequency === "weekly" || frequency === "biweekly") && daysOfWeek.size === 0) {
      Alert.alert("Missing", "Pick at least one day of the week."); return;
    }

    if (isEdit && isPartOfSeries) {
      Alert.alert(
        "Apply changes to…",
        "This event is part of a recurring series.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "This event only", onPress: () => doSave("single") },
          { text: "All events in series", onPress: () => doSave("series") },
        ],
      );
      return;
    }
    await doSave("single");
  };

  const onDelete = () => {
    if (!isEdit) return;
    const cleanup = async (scope: "single" | "series") => {
      try {
        await api.delete(`/schedule/${params.id}?scope=${scope}`);
        router.back();
      } catch (e: any) {
        Alert.alert("Error", e?.response?.data?.detail || "Could not delete");
      }
    };
    if (isPartOfSeries) {
      Alert.alert(
        "Delete event",
        "This event is part of a recurring series.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "This event only", style: "destructive", onPress: () => cleanup("single") },
          { text: "All events in series", style: "destructive", onPress: () => cleanup("series") },
        ],
      );
    } else {
      Alert.alert("Delete event?", "This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => cleanup("single") },
      ]);
    }
  };

  const dowLabel = useMemo(() => {
    const arr = Array.from(daysOfWeek).sort((a, b) => a - b);
    return arr.map(d => DOW[d]).join(", ");
  }, [daysOfWeek]);

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={{flex:1,alignItems:"center",justifyContent:"center"}}><ActivityIndicator color={colors.accent}/></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? "Edit event" : "New event"}</Text>
          {isEdit ? (
            <TouchableOpacity onPress={onDelete} style={styles.iconBtn} testID="schedule-delete">
              <Ionicons name="trash-outline" size={20} color="#DC2626" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {isPartOfSeries && (
            <View style={styles.seriesBanner}>
              <Ionicons name="repeat" size={16} color={colors.accent} />
              <Text style={styles.seriesBannerText}>Part of a recurring series</Text>
            </View>
          )}

          <Text style={styles.label}>Event type</Text>
          <View style={styles.typeGrid}>
            {TYPES.map(t => {
              const on = eventType === t.key;
              return (
                <TouchableOpacity key={t.key} onPress={() => setEventType(t.key)} style={[styles.typeBtn, on && { backgroundColor: t.color, borderColor: t.color }]} testID={`type-${t.key}`}>
                  <Text style={[styles.typeBtnText, on && { color: "white" }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Title</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Senior 5 practice" placeholderTextColor={colors.textTertiary} testID="schedule-title" />

          {teams.length > 0 && (
            <>
              <Text style={styles.label}>Team (optional)</Text>
              <View style={styles.chips}>
                {teams.map((t) => {
                  const on = teamId === t.id;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => setTeamId(on ? null : t.id)}
                      style={[styles.teamChip, on && { backgroundColor: t.color || colors.accent, borderColor: t.color || colors.accent }]}
                      testID={`schedule-team-${t.id}`}
                    >
                      <TeamAvatar logoImage={t.logo_image} color={t.color} size={18} dotColor={on ? "white" : undefined} />
                      <Text style={[styles.chipText, on && styles.chipTextActive]} numberOfLines={1}>{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.label}>Location (optional)</Text>
          <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. California Allstars gym" placeholderTextColor={colors.textTertiary} />

          <Text style={styles.label}>Address (optional, for maps)</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. 123 Main St, San Marcos, CA 92069"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            testID="schedule-address-input"
          />

          <Text style={styles.label}>{repeat ? "Starts" : "Date"}</Text>
          <DateField value={date} onChange={setDate} testID="schedule-date" />

          {!repeat && !isPartOfSeries && (
            <>
              <Text style={styles.label}>End date (optional · multi-day)</Text>
              <DateField value={endDate || date} onChange={setEndDate} testID="schedule-end-date" />
              {endDate && endDate > date ? (
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                  Spans {date} → {endDate} (creates one editable event per day)
                </Text>
              ) : null}
            </>
          )}

          {/* Stacked vertically so the AM/PM toggle on each TimeField always has
              the full container width — guarantees the period button never gets
              clipped on narrow phones (iPhone SE / Galaxy S series ≤ 360px). */}
          <Text style={styles.label}>Start time</Text>
          <TimeField value={startTime} onChange={setStartTime} testID="schedule-start-time" />

          <Text style={styles.label}>End time</Text>
          <TimeField value={endTime} onChange={setEndTime} testID="schedule-end-time" />

          {/* Repeat section — hidden for series edits so the rule can't be re-expanded */}
          {!isPartOfSeries && (
            <View style={styles.repeatBlock}>
              <View style={styles.repeatHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="repeat" size={18} color={colors.textPrimary} />
                  <Text style={styles.repeatTitle}>Repeat</Text>
                </View>
                <Switch
                  value={repeat}
                  onValueChange={setRepeat}
                  trackColor={{ true: colors.accent, false: "#CBD5E1" }}
                  thumbColor={Platform.OS === "android" ? (repeat ? "white" : "#F1F5F9") : undefined}
                  testID="schedule-repeat-toggle"
                />
              </View>

              {repeat && (
                <>
                  <Text style={styles.label}>Frequency</Text>
                  <View style={styles.freqRow}>
                    {FREQUENCIES.map(f => {
                      const on = frequency === f.key;
                      return (
                        <TouchableOpacity key={f.key} onPress={() => setFrequency(f.key)} style={[styles.freqBtn, on && styles.freqBtnOn]} testID={`freq-${f.key}`}>
                          <Text style={[styles.freqText, on && styles.freqTextOn]}>{f.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {(frequency === "weekly" || frequency === "biweekly") && (
                    <>
                      <Text style={styles.label}>On {dowLabel || "—"}</Text>
                      <View style={styles.dowRow}>
                        {DOW.map((d, i) => {
                          const on = daysOfWeek.has(i);
                          return (
                            <TouchableOpacity key={d} onPress={() => toggleDow(i)} style={[styles.dowBtn, on && styles.dowBtnOn]} testID={`dow-${i}`}>
                              <Text style={[styles.dowText, on && styles.dowTextOn]}>{d[0]}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

                  <Text style={styles.label}>Repeats until</Text>
                  <DateField value={until} onChange={setUntil} testID="schedule-until" />
                </>
              )}
            </View>
          )}

          {athletes.length > 0 && (
            <>
              <Text style={styles.label}>Athletes attending (optional)</Text>
              <View style={styles.chips}>
                {athletes.map(a => {
                  const on = selectedIds.has(a.id);
                  return (
                    <TouchableOpacity key={a.id} onPress={() => toggleAthlete(a.id)} style={[styles.chip, on && styles.chipActive]}>
                      {on && <Ionicons name="checkmark" size={14} color="white" style={{ marginRight: 4 }} />}
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{a.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.label}>Links (optional)</Text>
          <LinksEditor value={links} onChange={setLinks} testIDPrefix="schedule-link" />

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} multiline placeholder="e.g. Wear comp shoes" placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="schedule-save">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : (repeat ? "Save series" : "Save event")}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  typeBtnText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  teamChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  chipTextActive: { color: "white" },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },

  seriesBanner: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, backgroundColor: colors.accentSubtle, borderRadius: radius.md },
  seriesBannerText: { ...typography.caption, color: colors.accent, fontWeight: "700" },

  repeatBlock: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  repeatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  repeatTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  freqRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  freqBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  freqBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  freqText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary, fontSize: 13 },
  freqTextOn: { color: "white" },
  dowRow: { flexDirection: "row", gap: 6, justifyContent: "space-between" },
  dowBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, alignItems: "center" },
  dowBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dowText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary, fontSize: 13 },
  dowTextOn: { color: "white" },
});
