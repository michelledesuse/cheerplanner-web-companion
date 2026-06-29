import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, RefreshControl, Modal, Image, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import ColorField from "@/src/components/ColorField";

type Team = { id: string; name: string; color?: string; season?: string; logo_image?: string | null };

const DEFAULT_TEAM_COLOR = "#0EA5E9";

export default function TeamsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_TEAM_COLOR);
  const [season, setSeason] = useState("");
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Team[]>("/teams");
      setItems(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => {
    setEditing(null);
    setName(""); setColor(DEFAULT_TEAM_COLOR); setSeason(""); setLogoImage(null);
    setShowForm(true);
  };

  const openEdit = (t: Team) => {
    setEditing(t);
    setName(t.name); setColor(t.color || DEFAULT_TEAM_COLOR); setSeason(t.season || ""); setLogoImage(t.logo_image || null);
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditing(null); };

  const pickLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Photo access needed",
          "Allow photo access to set a team logo.",
          perm.canAskAgain
            ? [{ text: "OK" }]
            : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }],
        );
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });
      if (!res.canceled && res.assets[0]?.base64) {
        const a = res.assets[0];
        setLogoImage(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
      }
    } catch (_e) { Alert.alert("Error", "Could not load image."); }
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Missing", "Please enter a team name."); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), color, season: season.trim() || null, logo_image: logoImage || "" };
      if (editing) {
        await api.patch(`/teams/${editing.id}`, payload);
      } else {
        await api.post("/teams", payload);
      }
      closeForm();
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  const remove = (t: Team) => {
    Alert.alert(
      "Delete team?",
      `"${t.name}" will be removed from all athletes and competitions. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try { await api.delete(`/teams/${t.id}`); await load(); }
            catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete"); }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="teams-back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Teams</Text>
        <TouchableOpacity onPress={openNew} style={styles.addBtn} testID="teams-add">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {items.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="people-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.empty}>No teams yet.</Text>
            <Text style={styles.emptySub}>Create your household's teams so you can track meet times, attendance, and assignments per team.</Text>
            <TouchableOpacity onPress={openNew} style={styles.bigAdd}>
              <Ionicons name="add" size={18} color="white" />
              <Text style={styles.bigAddText}>Add first team</Text>
            </TouchableOpacity>
          </View>
        ) : (
          items.map((t) => (
            <TouchableOpacity key={t.id} onPress={() => openEdit(t)} style={styles.row} testID={`team-row-${t.id}`}>
              {t.logo_image ? (
                <Image source={{ uri: t.logo_image }} style={styles.logoImg} />
              ) : (
                <View style={[styles.colorSwatch, { backgroundColor: t.color || colors.accent }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{t.name}</Text>
                {!!t.season && <Text style={styles.rowMeta}>{t.season}</Text>}
              </View>
              <TouchableOpacity onPress={() => remove(t)} hitSlop={10} testID={`team-delete-${t.id}`}>
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={closeForm}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editing ? "Edit team" : "New team"}</Text>
                <TouchableOpacity onPress={closeForm} hitSlop={10}>
                  <Ionicons name="close" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Senior Elite Coed 5"
                placeholderTextColor={colors.textTertiary}
                testID="team-name-input"
              />

              <Text style={styles.label}>Season (optional)</Text>
              <TextInput
                style={styles.input}
                value={season}
                onChangeText={setSeason}
                placeholder="e.g. 2025-2026"
                placeholderTextColor={colors.textTertiary}
                testID="team-season-input"
              />

              <Text style={styles.label}>Color</Text>
              <ColorField value={color} onChange={setColor} testID="team-color" />

              <Text style={styles.label}>Logo (optional)</Text>
              <View style={styles.logoRow}>
                <TouchableOpacity onPress={pickLogo} style={styles.logoPicker} testID="team-logo-pick">
                  {logoImage ? (
                    <Image source={{ uri: logoImage }} style={styles.logoPreview} />
                  ) : (
                    <View style={[styles.logoPlaceholder, { backgroundColor: color }]}>
                      <Ionicons name="image" size={22} color="white" />
                    </View>
                  )}
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <TouchableOpacity onPress={pickLogo} style={styles.logoBtn} testID="team-logo-upload">
                    <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} />
                    <Text style={styles.logoBtnText}>{logoImage ? "Change logo" : "Upload logo"}</Text>
                  </TouchableOpacity>
                  {logoImage ? (
                    <TouchableOpacity onPress={() => setLogoImage(null)} style={styles.logoRemove} testID="team-logo-remove">
                      <Text style={styles.logoRemoveText}>Remove logo</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.logoHint}>Shown as the team icon across the app.</Text>
                  )}
                </View>
              </View>

              <TouchableOpacity onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.7 }]} testID="team-save-btn">
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{editing ? "Save changes" : "Add team"}</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  addBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  empty: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  emptySub: { ...typography.body, color: colors.textTertiary, textAlign: "center", paddingHorizontal: spacing.lg },
  bigAdd: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.accent, borderRadius: 999, marginTop: spacing.md },
  bigAddText: { color: "white", fontWeight: "700", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  colorSwatch: { width: 36, height: 36, borderRadius: 18 },
  logoImg: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bg },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logoPicker: { width: 64, height: 64, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  logoPreview: { width: 64, height: 64, borderRadius: 14 },
  logoPlaceholder: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  logoBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSubtle },
  logoBtnText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  logoRemove: { marginTop: 8, alignSelf: "flex-start" },
  logoRemoveText: { color: colors.dangerText, fontWeight: "600", fontSize: 13 },
  logoHint: { ...typography.caption, color: colors.textTertiary, marginTop: 8 },
  rowName: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700" },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxl },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  saveBtn: { marginTop: spacing.xl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
