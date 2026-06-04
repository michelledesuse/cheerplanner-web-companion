import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { todayISO } from "@/src/utils/format";
import DateField from "@/src/components/DateField";

const TYPES = [
  { key: "practice", label: "Practice", icon: "barbell", color: "#EA580C" },
  { key: "team_bonding", label: "Team Bonding", icon: "happy", color: "#0EA5E9" },
  { key: "private_lesson", label: "Private Lesson", icon: "person", color: "#DB2777" },
  { key: "choreography", label: "Choreography", icon: "musical-notes", color: "#9333EA" },
  { key: "class", label: "Class", icon: "school", color: "#0891B2" },
  { key: "other", label: "Other", icon: "calendar", color: "#64748B" },
] as const;

type Athlete = { id: string; name: string; avatar_color?: string };

export default function ScheduleForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!params.id;

  const [eventType, setEventType] = useState<string>("practice");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    (async () => {
      const a = await api.get<Athlete[]>("/athletes");
      setAthletes(a.data);
      if (isEdit) {
        try {
          const r = await api.get("/schedule");
          const e = (r.data as any[]).find(x => x.id === params.id);
          if (e) {
            setEventType(e.event_type || "practice");
            setTitle(e.title || "");
            setLocation(e.location || "");
            setDate(e.date || todayISO());
            setStartTime(e.start_time || "");
            setEndTime(e.end_time || "");
            setNotes(e.notes || "");
            setSelectedIds(new Set(e.athlete_ids || []));
          }
        } finally { setLoading(false); }
      }
    })();
  }, [isEdit, params.id]);

  const toggleAthlete = (id: string) => {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const save = async () => {
    if (!title.trim()) { Alert.alert("Missing", "Add a title."); return; }
    setSaving(true);
    try {
      const payload = {
        event_type: eventType,
        title: title.trim(),
        location: location.trim() || null,
        date,
        start_time: startTime.trim() || null,
        end_time: endTime.trim() || null,
        notes: notes.trim() || null,
        athlete_ids: Array.from(selectedIds),
      };
      if (isEdit) await api.patch(`/schedule/${params.id}`, payload);
      else await api.post("/schedule", payload);
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

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
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Event type</Text>
          <View style={styles.typeGrid}>
            {TYPES.map(t => {
              const on = eventType === t.key;
              return (
                <TouchableOpacity key={t.key} onPress={() => setEventType(t.key)} style={[styles.typeBtn, on && { backgroundColor: t.color, borderColor: t.color }]} testID={`type-${t.key}`}>
                  <Ionicons name={t.icon as any} size={16} color={on ? "white" : t.color} />
                  <Text style={[styles.typeBtnText, on && { color: "white" }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Title</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Senior 5 practice" placeholderTextColor={colors.textTertiary} testID="schedule-title" />

          <Text style={styles.label}>Location (optional)</Text>
          <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. California Allstars gym" placeholderTextColor={colors.textTertiary} />

          <Text style={styles.label}>Date</Text>
          <DateField value={date} onChange={setDate} testID="schedule-date" />

          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Start time</Text>
              <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="18:00" placeholderTextColor={colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>End time</Text>
              <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="20:00" placeholderTextColor={colors.textTertiary} />
            </View>
          </View>

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

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} multiline placeholder="e.g. Wear comp shoes" placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="schedule-save">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : "Save event"}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  chipTextActive: { color: "white" },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
