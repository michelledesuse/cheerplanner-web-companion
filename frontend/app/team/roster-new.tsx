import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const ROLES: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "athlete", label: "Athlete", icon: "barbell-outline" },
  { value: "coach", label: "Coach", icon: "megaphone-outline" },
  { value: "team_rep", label: "Team Rep/Mgr", icon: "clipboard-outline" },
  { value: "staff", label: "Staff", icon: "briefcase-outline" },
];

export default function RosterMemberForm() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; team_id?: string }>();
  const isEdit = !!params.id;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("athlete");
  const [teamIds, setTeamIds] = useState<string[]>(params.team_id ? [params.team_id] : []);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [parentFirst, setParentFirst] = useState("");
  const [parentLast, setParentLast] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [foodAllergies, setFoodAllergies] = useState("");
  const [otherAllergies, setOtherAllergies] = useState("");
  const [medicalConcerns, setMedicalConcerns] = useState("");
  const [hostBonding, setHostBonding] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [columns, setColumns] = useState<{ id: string; label: string }[]>([]);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [sizeColumns, setSizeColumns] = useState<{ id: string; label: string }[]>([]);
  const [sizeValues, setSizeValues] = useState<Record<string, string>>({});
  const [newColLabel, setNewColLabel] = useState("");
  const [addingCol, setAddingCol] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.get<{ id: string; label: string }[]>("/roster/columns").then((r) => setColumns(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get<{ columns: { id: string; label: string; order?: number }[]; values?: Record<string, Record<string, string>> }>("/team/sizes")
      .then((r) => {
        const cols = [...(r.data.columns || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((c) => ({ id: c.id, label: c.label }));
        setSizeColumns(cols);
        if (isEdit && params.id) setSizeValues((r.data.values || {})[params.id] || {});
      })
      .catch(() => {});
  }, [isEdit, params.id]);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>("/teams").then((r) => setTeams(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const r = await api.get<any[]>("/roster");
        const m = r.data.find((x) => x.id === params.id);
        if (m) {
          setFirstName(m.first_name || (m.name || "").split(" ")[0] || "");
          setLastName(m.last_name || (m.name || "").split(" ").slice(1).join(" ") || "");
          setRole(m.role && m.role !== "parent" ? m.role : "athlete");
          setTeamIds(m.team_ids || (m.team_id ? [m.team_id] : []));
          setParentFirst(m.parent_first_name || "");
          setParentLast(m.parent_last_name || "");
          setParentPhone(m.parent_phone || "");
          setParentEmail(m.parent_email || "");
          setPhone(m.phone || "");
          setEmail(m.email || "");
          setNotes(m.notes || "");
          setPreferredName(m.preferred_name || "");
          setFoodAllergies(m.food_allergies || "");
          setOtherAllergies(m.other_allergies || "");
          setMedicalConcerns(m.medical_concerns || "");
          setHostBonding(typeof m.host_bonding_opt_in === "boolean" ? m.host_bonding_opt_in : null);
          setPhoto(m.photo || null);
          setCustom(m.custom || {});
        }
      } finally { setLoading(false); }
    })();
  }, [isEdit, params.id]);

  const save = async () => {
    if (!firstName.trim() && !lastName.trim()) { Alert.alert("Name required", "Please enter a first or last name."); return; }
    setSaving(true);
    try {
      const isAthlete = role === "athlete";
      const payload = {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        role,
        team_ids: teamIds,
        parent_first_name: isAthlete ? (parentFirst.trim() || null) : null,
        parent_last_name: isAthlete ? (parentLast.trim() || null) : null,
        parent_phone: isAthlete ? (parentPhone.trim() || null) : null,
        parent_email: isAthlete ? (parentEmail.trim() || null) : null,
        phone: isAthlete ? null : (phone.trim() || null),
        email: isAthlete ? null : (email.trim() || null),
        notes: notes.trim() || null,
        preferred_name: preferredName.trim() || null,
        food_allergies: foodAllergies.trim() || null,
        other_allergies: otherAllergies.trim() || null,
        medical_concerns: medicalConcerns.trim() || null,
        host_bonding_opt_in: hostBonding,
        photo: photo,
        custom,
      };
      let memberId = params.id as string | undefined;
      if (isEdit) { await api.patch(`/roster/${params.id}`, payload); }
      else { const r = await api.post<{ id: string }>("/roster", payload); memberId = r.data.id; }
      if (memberId && sizeColumns.length) {
        await api.put("/team/sizes/values", { member_id: memberId, values: sizeValues });
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save.");
    } finally { setSaving(false); }
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access needed", "Allow photo access to add a picture.",
        perm.canAskAgain ? [{ text: "OK" }] : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true, allowsEditing: true, aspect: [1, 1] });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const a = res.assets[0];
      setPhoto(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
    }
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

  const addColumn = async () => {
    const label = newColLabel.trim();
    if (!label) return;
    setAddingCol(true);
    try {
      const r = await api.post<{ id: string; label: string }>("/roster/columns", { label });
      setColumns((prev) => [...prev, r.data]);
      setNewColLabel("");
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not add field."); }
    finally { setAddingCol(false); }
  };

  const removeColumn = (col: { id: string; label: string }) => {
    Alert.alert("Delete field?", `Remove "${col.label}" from every roster member? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api.delete(`/roster/columns/${col.id}`);
          setColumns((prev) => prev.filter((c) => c.id !== col.id));
          setCustom((prev) => { const n = { ...prev }; delete n[col.id]; return n; });
        } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
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
          <View style={styles.nameRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>First name</Text>
              <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholder="First" placeholderTextColor={colors.textTertiary} testID="roster-first-input" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Last name</Text>
              <TextInput style={styles.input} value={lastName} onChangeText={setLastName} placeholder="Last" placeholderTextColor={colors.textTertiary} testID="roster-last-input" />
            </View>
          </View>

          <Text style={styles.label}>Preferred name <Text style={styles.labelHint}>(optional)</Text></Text>
          <TextInput style={styles.input} value={preferredName} onChangeText={setPreferredName} placeholder="What they go by" placeholderTextColor={colors.textTertiary} testID="roster-preferred-input" />

          <Text style={styles.label}>Photo <Text style={styles.labelHint}>(optional)</Text></Text>
          <View style={styles.photoRow}>
            <TouchableOpacity onPress={pickPhoto} activeOpacity={0.8} testID="roster-photo-pick">
              {photo ? (
                <Image source={{ uri: photo }} style={styles.photoThumb} />
              ) : (
                <View style={[styles.photoThumb, styles.photoEmpty]}>
                  <Ionicons name="camera-outline" size={24} color={colors.accent} />
                </View>
              )}
            </TouchableOpacity>
            <View style={{ flex: 1, gap: 8 }}>
              <TouchableOpacity onPress={pickPhoto} style={styles.photoBtn} testID="roster-photo-add">
                <Text style={styles.photoBtnText}>{photo ? "Change photo" : "Add photo"}</Text>
              </TouchableOpacity>
              {photo ? (
                <TouchableOpacity onPress={() => setPhoto(null)} style={styles.photoBtnGhost} testID="roster-photo-remove">
                  <Text style={styles.photoBtnGhostText}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => (
              <TouchableOpacity key={r.value} onPress={() => setRole(r.value)} style={[styles.roleChip, role === r.value && styles.roleChipOn]} testID={`roster-role-${r.value}`}>
                <Ionicons name={r.icon} size={14} color={role === r.value ? "white" : colors.textSecondary} />
                <Text style={[styles.roleChipText, role === r.value && styles.roleChipTextOn]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Teams <Text style={styles.labelHint}>(select all that apply)</Text></Text>
          <View style={styles.roleRow}>
            <TouchableOpacity onPress={() => setTeamIds([])} style={[styles.roleChip, teamIds.length === 0 && styles.roleChipOn]} testID="roster-team-none">
              <Text style={[styles.roleChipText, teamIds.length === 0 && styles.roleChipTextOn]}>No team</Text>
            </TouchableOpacity>
            {teams.map((t) => {
              const on = teamIds.includes(t.id);
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTeamIds((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                  style={[styles.roleChip, on && styles.roleChipOn]}
                  testID={`roster-team-${t.id}`}
                >
                  {on && <Ionicons name="checkmark" size={14} color="white" />}
                  <Text style={[styles.roleChipText, on && styles.roleChipTextOn]} numberOfLines={1}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {role === "athlete" ? (
            <>
              <Text style={styles.sectionLabel}>Parent / guardian</Text>
              <View style={styles.nameRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>First name</Text>
                  <TextInput style={styles.input} value={parentFirst} onChangeText={setParentFirst} placeholder="First" placeholderTextColor={colors.textTertiary} testID="roster-parent-first-input" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Last name</Text>
                  <TextInput style={styles.input} value={parentLast} onChangeText={setParentLast} placeholder="Last" placeholderTextColor={colors.textTertiary} testID="roster-parent-last-input" />
                </View>
              </View>

              <Text style={styles.label}>Parent phone</Text>
              <TextInput style={styles.input} value={parentPhone} onChangeText={setParentPhone} placeholder="e.g. 555-123-4567" placeholderTextColor={colors.textTertiary} keyboardType="phone-pad" testID="roster-parent-phone-input" />

              <Text style={styles.label}>Parent email</Text>
              <TextInput style={styles.input} value={parentEmail} onChangeText={setParentEmail} placeholder="e.g. jen@example.com" placeholderTextColor={colors.textTertiary} keyboardType="email-address" autoCapitalize="none" testID="roster-parent-email-input" />
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Contact</Text>
              <Text style={styles.label}>Phone</Text>
              <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="e.g. 555-123-4567" placeholderTextColor={colors.textTertiary} keyboardType="phone-pad" testID="roster-phone-input" />

              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="e.g. coach@example.com" placeholderTextColor={colors.textTertiary} keyboardType="email-address" autoCapitalize="none" testID="roster-email-input" />
            </>
          )}

          <Text style={styles.sectionLabel}>Health & extra info</Text>
          <Text style={styles.label}>Food allergies</Text>
          <TextInput style={styles.input} value={foodAllergies} onChangeText={setFoodAllergies} placeholder="e.g. Peanuts, dairy" placeholderTextColor={colors.textTertiary} testID="roster-food-input" />

          <Text style={styles.label}>Other allergies</Text>
          <TextInput style={styles.input} value={otherAllergies} onChangeText={setOtherAllergies} placeholder="e.g. Bee stings, latex" placeholderTextColor={colors.textTertiary} testID="roster-other-allergy-input" />

          <Text style={styles.label}>Medical concerns</Text>
          <TextInput style={[styles.input, { height: 70, textAlignVertical: "top" }]} value={medicalConcerns} onChangeText={setMedicalConcerns} placeholder="Asthma, medications, etc." placeholderTextColor={colors.textTertiary} multiline testID="roster-medical-input" />

          <Text style={styles.label}>Host bonding opt-in</Text>
          <View style={styles.roleRow}>
            {[{ v: true, l: "Yes" }, { v: false, l: "No" }, { v: null, l: "Not set" }].map((o) => {
              const on = hostBonding === o.v;
              return (
                <TouchableOpacity key={o.l} onPress={() => setHostBonding(o.v as boolean | null)} style={[styles.roleChip, on && styles.roleChipOn]} testID={`roster-host-${o.l}`}>
                  <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{o.l}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {sizeColumns.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Sizes</Text>
              {sizeColumns.map((col) => (
                <View key={col.id}>
                  <Text style={styles.label}>{col.label}</Text>
                  <TextInput
                    style={styles.input}
                    value={sizeValues[col.id] || ""}
                    onChangeText={(v) => setSizeValues((prev) => ({ ...prev, [col.id]: v }))}
                    placeholder={col.label}
                    placeholderTextColor={colors.textTertiary}
                    testID={`roster-size-${col.id}`}
                  />
                </View>
              ))}
            </>
          )}

          {columns.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Custom fields</Text>
              {columns.map((col) => (
                <View key={col.id}>
                  <View style={styles.colLabelRow}>
                    <Text style={styles.label}>{col.label}</Text>
                    <TouchableOpacity onPress={() => removeColumn(col)} hitSlop={8} testID={`roster-col-delete-${col.id}`}>
                      <Ionicons name="trash-outline" size={15} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.input}
                    value={custom[col.id] || ""}
                    onChangeText={(v) => setCustom((prev) => ({ ...prev, [col.id]: v }))}
                    placeholder={col.label}
                    placeholderTextColor={colors.textTertiary}
                    testID={`roster-col-input-${col.id}`}
                  />
                </View>
              ))}
            </>
          )}

          <Text style={styles.label}>Add a custom field</Text>
          <View style={styles.addColRow}>
            <TextInput style={[styles.input, { flex: 1 }]} value={newColLabel} onChangeText={setNewColLabel} placeholder="e.g. Jersey #, Grade" placeholderTextColor={colors.textTertiary} testID="roster-col-new-input" onSubmitEditing={addColumn} />
            <TouchableOpacity style={styles.addColBtn} onPress={addColumn} disabled={addingCol || !newColLabel.trim()} testID="roster-col-add-btn">
              {addingCol ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="add" size={22} color="white" />}
            </TouchableOpacity>
          </View>

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
  labelHint: { ...typography.caption, color: c.textTertiary, fontWeight: "500" },
  sectionLabel: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "800", marginTop: spacing.xl },
  nameRow: { flexDirection: "row", gap: spacing.md },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  photoThumb: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  photoEmpty: { alignItems: "center", justifyContent: "center", borderStyle: "dashed", borderColor: c.accent, backgroundColor: c.accentSubtle },
  photoBtn: { backgroundColor: c.accentSubtle, borderRadius: radius.md, paddingVertical: 10, alignItems: "center" },
  photoBtnText: { ...typography.caption, color: c.accent, fontWeight: "700" },
  photoBtnGhost: { paddingVertical: 8, alignItems: "center" },
  photoBtnGhostText: { ...typography.caption, color: c.textTertiary, fontWeight: "600" },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleChip: { flexBasis: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 6, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  roleChipOn: { backgroundColor: c.primary, borderColor: c.primary },
  roleChipText: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700", fontSize: 14 },
  roleChipTextOn: { color: "white" },
  colLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  addColRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addColBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: c.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.lg, paddingVertical: 12 },
  deleteText: { color: c.danger, fontWeight: "700" },
});
