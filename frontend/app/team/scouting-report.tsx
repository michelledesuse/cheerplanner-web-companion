import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { SCOUT_CATEGORIES, SCOUT_LEVELS, levelMeta } from "@/src/utils/scouting";

type Skill = { skill_id: string; name: string; category: string; level?: string | null; notes?: string; pending_review?: boolean };
type Report = { roster_id: string; name: string; role: string; can_edit: boolean; can_request: boolean; categories: Record<string, Skill[]> };

export default function ScoutingReport() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ roster_id?: string; name?: string }>();
  const rosterId = String(params.roster_id || "");

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Skill | null>(null);
  const [editLevel, setEditLevel] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Report>(`/team/scouting/report/${rosterId}`);
      setReport(r.data);
    } catch (_e) { setReport(null); }
    finally { setLoading(false); }
  }, [rosterId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openEdit = (s: Skill) => {
    if (!report?.can_edit) return;
    setEdit(s); setEditLevel(s.level || null); setEditNotes(s.notes || "");
  };

  const saveEdit = async () => {
    if (!edit || saving) return;
    setSaving(true);
    try {
      await api.put(`/team/scouting/report/${rosterId}/skill/${edit.skill_id}`, { level: editLevel || "", notes: editNotes });
      setEdit(null); load();
    } catch (_e) { Alert.alert("Error", "Could not save the assessment."); }
    finally { setSaving(false); }
  };

  const requestReview = async (s: Skill) => {
    try {
      await api.post(`/team/scouting/report/${rosterId}/skill/${s.skill_id}/request-review`, {});
      Alert.alert("Review requested", `Your coach has been notified that you'd like ${s.name} reviewed.`);
      load();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not send the request."); }
  };

  const shareReport = async () => {
    try {
      const r = await api.post<{ url: string }>("/team/share", { kind: "scouting", ref_id: rosterId });
      await Share.share({ message: `${report?.name}'s CheerPlanner Scouting Report:\n${r.data.url}`, url: r.data.url });
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not create a share link."); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="scouting-report-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{report?.name || String(params.name || "Scouting Report")}</Text>
          <Text style={styles.subtitle}>Scouting Report</Text>
        </View>
        {report && (report.can_edit || report.role === "parent") && (
          <TouchableOpacity onPress={shareReport} hitSlop={8} style={{ padding: 4 }} testID="scouting-share-btn">
            <Ionicons name="share-outline" size={22} color={colors.accent} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : !report ? (
        <View style={styles.empty}><Text style={styles.emptyText}>This report isn't available.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {report.can_edit && (
            <View style={styles.tip}><Ionicons name="information-circle-outline" size={15} color={colors.accent} /><Text style={styles.tipText}>Tap any skill to set the athlete's level and add coach notes.</Text></View>
          )}
          {SCOUT_CATEGORIES.map((cat) => {
            const list = report.categories[cat.key] || [];
            return (
              <View key={cat.key} style={{ gap: spacing.xs }}>
                <View style={styles.catHead}>
                  <Ionicons name={cat.icon as any} size={16} color={colors.accent} />
                  <Text style={styles.catTitle}>{cat.label}</Text>
                </View>
                {list.length === 0 ? (
                  <Text style={styles.catEmpty}>No {cat.label.toLowerCase()} skills yet.</Text>
                ) : (
                  list.map((s) => {
                    const lm = levelMeta(s.level);
                    return (
                      <TouchableOpacity key={s.skill_id} style={styles.skillCard} activeOpacity={report.can_edit ? 0.7 : 1} onPress={() => openEdit(s)} testID={`scouting-skill-${s.skill_id}`}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.skillTitleRow}>
                            <Text style={styles.skillName}>{s.name}</Text>
                            {s.pending_review && <View style={styles.pendPill}><Text style={styles.pendText}>REVIEW</Text></View>}
                          </View>
                          {!!s.notes && <Text style={styles.notes}>{s.notes}</Text>}
                          {report.can_request && (
                            <TouchableOpacity onPress={() => requestReview(s)} disabled={s.pending_review} hitSlop={6} testID={`scouting-request-${s.skill_id}`}>
                              <Text style={[styles.reqLink, s.pending_review && { color: colors.textTertiary }]}>
                                {s.pending_review ? "Review requested" : "Request review"}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={[styles.levelChip, { backgroundColor: (lm?.color || colors.textTertiary) + "22" }]}>
                          <Text style={[styles.levelChipText, { color: lm?.color || colors.textTertiary }]}>{lm?.label || "Not set"}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Coach edit modal */}
      <Modal visible={!!edit} transparent animationType="slide" onRequestClose={() => setEdit(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setEdit(null)}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="scouting-edit-modal">
            <Text style={styles.sheetTitle}>{edit?.name}</Text>
            <Text style={styles.sheetSub}>Progression level</Text>
            {SCOUT_LEVELS.map((l) => (
              <TouchableOpacity key={l.key} style={[styles.levelOpt, editLevel === l.key && { borderColor: l.color, backgroundColor: l.color + "14" }]} onPress={() => setEditLevel(l.key)} testID={`scouting-level-${l.key}`}>
                <View style={[styles.dot, { backgroundColor: l.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.levelOptLabel}>{l.label}</Text>
                  <Text style={styles.levelOptDesc}>{l.desc}</Text>
                </View>
                {editLevel === l.key && <Ionicons name="checkmark-circle" size={20} color={l.color} />}
              </TouchableOpacity>
            ))}
            <Text style={styles.sheetSub}>Coach notes / critique</Text>
            <TextInput
              style={styles.notesInput}
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="Feedback visible to the athlete & parent…"
              placeholderTextColor={colors.textTertiary}
              multiline
              testID="scouting-notes-input"
            />
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={saveEdit} disabled={saving} testID="scouting-save-btn">
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Save assessment</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEdit(null)} style={{ paddingVertical: 8, alignItems: "center" }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
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
  tip: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: c.accentSubtle, borderRadius: radius.md, padding: 10 },
  tipText: { ...typography.caption, color: c.textPrimary, flex: 1 },
  catHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs },
  catTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  catEmpty: { ...typography.caption, color: c.textTertiary, marginLeft: 4 },
  skillCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  skillTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  skillName: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary },
  notes: { ...typography.caption, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
  reqLink: { ...typography.caption, color: c.accent, fontWeight: "800", marginTop: 6 },
  pendPill: { backgroundColor: "#FEF3C7", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  pendText: { fontSize: 9, fontWeight: "800", color: "#92400E", letterSpacing: 0.5 },
  levelChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  levelChipText: { fontSize: 11, fontWeight: "800" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { ...typography.body, color: c.textSecondary, textAlign: "center" as const },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: 8, maxHeight: "90%" },
  sheetTitle: { ...typography.h3, color: c.textPrimary },
  sheetSub: { ...typography.caption, fontWeight: "800", color: c.textTertiary, letterSpacing: 0.5, marginTop: spacing.sm },
  levelOpt: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  levelOptLabel: { ...typography.bodyMedium, fontWeight: "700", color: c.textPrimary },
  levelOptDesc: { ...typography.caption, color: c.textSecondary, marginTop: 1 },
  notesInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, minHeight: 80, maxHeight: 160, textAlignVertical: "top", ...typography.body, color: c.textPrimary },
  saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.sm },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelText: { ...typography.body, color: c.textSecondary, fontWeight: "600" },
});
