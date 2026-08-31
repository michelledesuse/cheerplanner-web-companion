import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { SCOUT_CATEGORIES } from "@/src/utils/scouting";

type Skill = { id: string; name: string; category: string };

export default function ScoutingSkills() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [cats, setCats] = useState<Record<string, Skill[]>>({});
  const [loading, setLoading] = useState(true);
  const [addCat, setAddCat] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ categories: Record<string, Skill[]> }>("/team/scouting/skills");
      setCats(r.data.categories || {});
    } catch (_e) { setCats({}); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addSkill = async () => {
    if (!addCat || !name.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/team/scouting/skills", { category: addCat, name: name.trim() });
      setAddCat(null); setName(""); load();
    } catch (_e) { Alert.alert("Error", "Could not add the skill."); }
    finally { setSaving(false); }
  };

  const removeSkill = (s: Skill) => {
    Alert.alert("Delete skill?", `"${s.name}" and all athlete assessments for it will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await api.delete(`/team/scouting/skills/${s.id}`); load(); } catch (_e) {} } },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="scouting-skills-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Skill Library</Text>
          <Text style={styles.subtitle}>Skills your team is assessed on</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {SCOUT_CATEGORIES.map((cat) => (
            <View key={cat.key} style={{ gap: spacing.xs }}>
              <View style={styles.catHead}>
                <Ionicons name={cat.icon as any} size={16} color={colors.accent} />
                <Text style={styles.catTitle}>{cat.label}</Text>
              </View>
              {(cats[cat.key] || []).map((s) => (
                <View key={s.id} style={styles.skillRow} testID={`skill-${s.id}`}>
                  <Text style={styles.skillName}>{s.name}</Text>
                  <TouchableOpacity onPress={() => removeSkill(s)} hitSlop={8} testID={`skill-del-${s.id}`}>
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addRow} onPress={() => { setAddCat(cat.key); setName(""); }} testID={`skill-add-${cat.key}`}>
                <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                <Text style={styles.addText}>Add {cat.label.toLowerCase()} skill</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!addCat} transparent animationType="fade" onRequestClose={() => setAddCat(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setAddCat(null)}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="skill-add-modal">
            <Text style={styles.sheetTitle}>Add {SCOUT_CATEGORIES.find((c) => c.key === addCat)?.label} skill</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Standing Back Handspring" placeholderTextColor={colors.textTertiary} autoFocus testID="skill-name-input" />
            <TouchableOpacity style={[styles.saveBtn, (!name.trim() || saving) && { opacity: 0.6 }]} onPress={addSkill} disabled={!name.trim() || saving} testID="skill-save-btn">
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Add skill</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAddCat(null)} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { ...typography.h3, color: c.textPrimary },
  subtitle: { ...typography.caption, color: c.textSecondary },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  catHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs },
  catTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  skillRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.card, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: c.border },
  skillName: { ...typography.body, color: c.textPrimary, flex: 1 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingLeft: 4 },
  addText: { ...typography.caption, color: c.accent, fontWeight: "800" },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg, gap: 10 },
  sheetTitle: { ...typography.h3, color: c.textPrimary },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, ...typography.body, color: c.textPrimary },
  saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 13, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelText: { ...typography.body, color: c.textSecondary, fontWeight: "600" },
});
