import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import ColorField from "@/src/components/ColorField";

const DEFAULT_COLOR = "#0EA5E9";

type Athlete = {
  id: string;
  name: string;
  role?: "athlete" | "coach";
  team?: string;
  gym?: string;
  avatar_color?: string;
  avatar_image?: string | null;
  team_ids?: string[];
};

type Team = { id: string; name: string; color?: string; season?: string };

export default function AthleteForm() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  const [name, setName] = useState("");
  const [role, setRole] = useState<"athlete" | "coach">("athlete");
  const [team, setTeam] = useState("");
  const [gym, setGym] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [pickingImage, setPickingImage] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const tRes = await api.get<Team[]>("/teams");
        setTeams(tRes.data);
      } catch (_) { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const r = await api.get<Athlete[]>("/athletes");
        const a = r.data.find((x) => x.id === editingId);
        if (a) {
          setName(a.name);
          setRole((a.role as any) || "athlete");
          setTeam(a.team || "");
          setGym(a.gym || "");
          setColor(a.avatar_color || DEFAULT_COLOR);
          setAvatarImage(a.avatar_image || null);
          setTeamIds(a.team_ids || []);
        }
      } finally { setLoading(false); }
    })();
  }, [editingId, isEdit]);

  const toggleTeam = (teamId: string) => {
    setTeamIds((prev) => {
      if (prev.includes(teamId)) return prev.filter((id) => id !== teamId);
      return [...prev, teamId];
    });
  };

  const pickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert("Permission needed", "Please enable photo access in Settings.");
        }
        return;
      }
      setPickingImage(true);
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        const mime = a.mimeType || "image/jpeg";
        const b64 = a.base64 || "";
        if (b64) setAvatarImage(`data:${mime};base64,${b64}`);
      }
    } catch (_e) {
      Alert.alert("Error", "Could not load image.");
    } finally { setPickingImage(false); }
  };

  const clearAvatar = () => setAvatarImage(null);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Missing", "Please enter name."); return; }
    setSaving(true);
    try {
      const payload: any = {
        name: name.trim(),
        role,
        team: team.trim() || null,
        gym: gym.trim() || null,
        avatar_color: color,
        avatar_image: avatarImage,
        team_ids: teamIds,
      };
      if (isEdit) {
        await api.patch(`/athletes/${editingId}`, payload);
      } else {
        await api.post("/athletes", payload);
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  const initial = (name || "?")[0].toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="athlete-form-back">
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? "Edit athlete" : "New athlete"}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {/* Avatar editor */}
          <View style={styles.avatarBlock}>
            <TouchableOpacity
              onPress={pickAvatar}
              style={[styles.avatar, { backgroundColor: color }]}
              testID="athlete-avatar-pick"
              activeOpacity={0.8}
              disabled={pickingImage}
            >
              {avatarImage ? (
                <Image source={{ uri: avatarImage }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
              <View style={styles.cameraOverlay}>
                {pickingImage ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Ionicons name="camera" size={16} color="white" />
                )}
              </View>
            </TouchableOpacity>
            <View style={styles.avatarActions}>
              <TouchableOpacity onPress={pickAvatar} style={styles.smallBtn}>
                <Ionicons name="image" size={14} color={colors.accent} />
                <Text style={styles.smallBtnText}>{avatarImage ? "Change photo" : "Upload photo"}</Text>
              </TouchableOpacity>
              {avatarImage && (
                <TouchableOpacity onPress={clearAvatar} style={[styles.smallBtn, { backgroundColor: colors.dangerBg }]} testID="athlete-clear-image">
                  <Ionicons name="trash" size={14} color={colors.dangerText} />
                  <Text style={[styles.smallBtnText, { color: colors.dangerText }]}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Ava" placeholderTextColor={colors.textTertiary} testID="athlete-name-input" />

          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            {(["athlete", "coach"] as const).map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setRole(r)}
                style={[styles.roleChip, role === r && styles.roleChipOn]}
                testID={`role-${r}`}
              >
                <Ionicons
                  name={r === "athlete" ? "barbell-outline" : "megaphone-outline"}
                  size={14}
                  color={role === r ? "white" : colors.textSecondary}
                />
                <Text style={[styles.roleChipText, role === r && styles.roleChipTextOn]}>
                  {r === "athlete" ? "Athlete" : "Coach"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: spacing.lg }}>
            <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>
              Teams ({teamIds.length})
            </Text>
            <TouchableOpacity onPress={() => router.push("/teams" as any)} testID="manage-teams-btn">
              <Text style={{ ...typography.caption, color: colors.accent, fontWeight: "700" }}>Manage</Text>
            </TouchableOpacity>
          </View>
          {teams.length === 0 ? (
            <TouchableOpacity onPress={() => router.push("/teams" as any)} style={styles.noTeams} testID="add-team-empty">
              <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
              <Text style={{ ...typography.caption, color: colors.accent, fontWeight: "600" }}>Create your first team</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.teamChipWrap}>
              {teams.map((t) => {
                const on = teamIds.includes(t.id);
                return (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => toggleTeam(t.id)}
                    style={[styles.teamChip, on && { backgroundColor: t.color || colors.accent, borderColor: t.color || colors.accent }]}
                    testID={`team-chip-${t.id}`}
                  >
                    <View style={[styles.teamDot, { backgroundColor: on ? "white" : (t.color || colors.accent) }]} />
                    <Text style={[styles.teamChipText, on && { color: "white" }]} numberOfLines={1}>{t.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={styles.label}>Legacy team label (optional)</Text>
          <TextInput style={styles.input} value={team} onChangeText={setTeam} placeholder="e.g. Senior Coed 5" placeholderTextColor={colors.textTertiary} testID="athlete-team-input" />

          <Text style={styles.label}>Gym (optional)</Text>
          <TextInput style={styles.input} value={gym} onChangeText={setGym} placeholder="e.g. California Allstars" placeholderTextColor={colors.textTertiary} testID="athlete-gym-input" />

          <Text style={styles.label}>Avatar color</Text>
          <ColorField value={color} onChange={setColor} testID="athlete-color" />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="athlete-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : "Save athlete"}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  avatarBlock: { alignItems: "center", marginVertical: spacing.lg },
  avatar: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: 110, height: 110, borderRadius: 55 },
  avatarText: { color: "white", fontWeight: "800", fontSize: 42 },
  cameraOverlay: {
    position: "absolute", bottom: 0, right: 0,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primary, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.bg,
  },
  avatarActions: { flexDirection: "row", gap: 8, marginTop: spacing.md },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accentSubtle, borderRadius: 999 },
  smallBtnText: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  colorRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  colorDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: "transparent" },
  colorDotActive: { borderColor: colors.textPrimary },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
  roleRow: { flexDirection: "row", gap: 8 },
  roleChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  roleChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleChipText: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  roleChipTextOn: { color: "white" },
  teamChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  teamChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, borderRadius: 999, borderWidth: 1, borderColor: colors.border, maxWidth: 200 },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  teamChipText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary },
  noTeams: { flexDirection: "row", alignItems: "center", gap: 6, padding: spacing.md, backgroundColor: colors.accentSubtle, borderRadius: radius.md, marginTop: 8, justifyContent: "center" },
});
