import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const ROLES: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "parent", label: "Parent", icon: "person-outline" },
  { value: "athlete", label: "Athlete", icon: "barbell-outline" },
  { value: "coach", label: "Coach", icon: "megaphone-outline" },
  { value: "team_rep", label: "Team Rep/Mgr", icon: "clipboard-outline" },
  { value: "staff", label: "Staff", icon: "briefcase-outline" },
];

export default function RosterMemberForm() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!params.id;

  const [name, setName] = useState("");
  const [role, setRole] = useState("parent");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const r = await api.get<any[]>("/roster");
        const m = r.data.find((x) => x.id === params.id);
        if (m) {
          setName(m.name || ""); setRole(m.role || "parent");
          setPhone(m.phone || ""); setEmail(m.email || ""); setNotes(m.notes || "");
        }
      } finally { setLoading(false); }
    })();
  }, [isEdit, params.id]);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name required", "Please enter a name."); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), role, phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null };
      if (isEdit) await api.patch(`/roster/${params.id}`, payload);
      else await api.post("/roster", payload);
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save.");
    } finally { setSaving(false); }
  };

  const remove = () => {
    Alert.alert("Remove from roster?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        try { await api.delete(`/roster/${params.id}`); router.back(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
      } },
    ]);
  };

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="roster-form-back" hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? "Edit person" : "Add person"}</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Jen Smith" placeholderTextColor={colors.textTertiary} testID="roster-name-input" />

          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => (
              <TouchableOpacity key={r.value} onPress={() => setRole(r.value)} style={[styles.roleChip, role === r.value && styles.roleChipOn]} testID={`roster-role-${r.value}`}>
                <Ionicons name={r.icon} size={14} color={role === r.value ? "white" : colors.textSecondary} />
                <Text style={[styles.roleChipText, role === r.value && styles.roleChipTextOn]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="e.g. 555-123-4567" placeholderTextColor={colors.textTertiary} keyboardType="phone-pad" testID="roster-phone-input" />

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="e.g. jen@example.com" placeholderTextColor={colors.textTertiary} keyboardType="email-address" autoCapitalize="none" testID="roster-email-input" />

          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, { height: 90, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} placeholder="Anything handy to remember" placeholderTextColor={colors.textTertiary} multiline testID="roster-notes-input" />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="roster-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : "Add to roster"}</Text>}
          </TouchableOpacity>

          {isEdit && (
            <TouchableOpacity style={styles.deleteBtn} onPress={remove} testID="roster-delete-btn">
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.deleteText}>Remove from roster</Text>
            </TouchableOpacity>
          )}
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
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleChip: { flexBasis: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 6, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  roleChipOn: { backgroundColor: c.primary, borderColor: c.primary },
  roleChipText: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700", fontSize: 14 },
  roleChipTextOn: { color: "white" },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: c.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.lg, paddingVertical: 12 },
  deleteText: { color: c.danger, fontWeight: "700" },
});
