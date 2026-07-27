import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import DateField from "@/src/components/DateField";
import AttachSection from "@/src/components/AttachSection";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

export default function AttendanceForm() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!params.id;

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [compIds, setCompIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const r = await api.get<{ title: string; date?: string | null; competition_ids?: string[]; event_ids?: string[] }>(`/team/attendance/${params.id}`);
        setTitle(r.data.title || "");
        setDate(r.data.date || "");
        setCompIds(r.data.competition_ids || []);
        setEventIds(r.data.event_ids || []);
      } catch (e: any) {
        Alert.alert("Error", e?.response?.data?.detail || "Could not load session.");
        router.back();
      } finally { setLoading(false); }
    })();
  }, [isEdit, params.id]);

  const save = async () => {
    if (!title.trim()) { Alert.alert("Title required", "Give this session a title."); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/team/attendance/${params.id}`, { title: title.trim(), date: date || null });
        router.back();
      } else {
        const r = await api.post<{ id: string }>("/team/attendance", { title: title.trim(), date: date || null });
        router.replace({ pathname: "/team/attendance-session", params: { id: r.data.id } });
      }
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save.");
    } finally { setSaving(false); }
  };

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="attendance-form-back" hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? "Edit session" : "New session"}</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Title</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Friday practice" placeholderTextColor={colors.textTertiary} testID="attendance-title-input" autoFocus={!isEdit} />

          <Text style={styles.label}>Date (optional)</Text>
          <DateField value={date} onChange={setDate} testID="attendance-date-input" />

          {isEdit && <AttachSection endpoint={`/team/attendance/${params.id}`} competitionIds={compIds} eventIds={eventIds} onChange={(c, e) => { setCompIds(c); setEventIds(e); }} />}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="attendance-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : "Create session"}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.lg, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: c.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "800", fontSize: 16 },
});
