import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import DraggableFlatList, { ScaleDecorator } from "react-native-draggable-flatlist";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";

import { api, TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { SCOUT_CATEGORIES } from "@/src/utils/scouting";

type Skill = { id: string; name: string; category: string; level_group?: number; sub_category?: string };
type Row =
  | { type: "cat"; key: string; category: string; label: string; icon: string }
  | { type: "divider"; key: string; category: string; level: number }
  | { type: "subdivider"; key: string; category: string; level: number; sub: string }
  | { type: "skill"; key: string; skill: Skill };

const LEVELS = [1, 2, 3, 4, 5, 6, 7];
const SUBS: { key: string; label: string }[] = [
  { key: "standing", label: "Standing Tumbling" },
  { key: "running", label: "Running Tumbling" },
];

function buildRows(cats: Record<string, Skill[]>): Row[] {
  const rows: Row[] = [];
  for (const c of SCOUT_CATEGORIES) {
    rows.push({ type: "cat", key: `cat-${c.key}`, category: c.key, label: c.label, icon: c.icon });
    const list = cats[c.key] || [];
    for (const lvl of LEVELS) {
      rows.push({ type: "divider", key: `div-${c.key}-${lvl}`, category: c.key, level: lvl });
      if (c.key === "tumbling") {
        for (const sub of SUBS) {
          rows.push({ type: "subdivider", key: `sub-${c.key}-${lvl}-${sub.key}`, category: c.key, level: lvl, sub: sub.key });
          list
            .filter((s) => (s.level_group || 1) === lvl && (s.sub_category || "standing") === sub.key)
            .forEach((s) => rows.push({ type: "skill", key: `sk-${s.id}`, skill: { ...s, level_group: lvl, sub_category: sub.key } }));
        }
      } else {
        list
          .filter((s) => (s.level_group || 1) === lvl)
          .forEach((s) => rows.push({ type: "skill", key: `sk-${s.id}`, skill: { ...s, level_group: lvl } }));
      }
    }
  }
  return rows;
}

export default function ScoutingSkills() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [addCat, setAddCat] = useState<string | null>(null);
  const [addLevel, setAddLevel] = useState(1);
  const [addSub, setAddSub] = useState<string>("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | "template" | "import">(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ categories: Record<string, Skill[]> }>("/team/scouting/skills");
      setRows(buildRows(r.data.categories || {}));
    } catch (_e) { setRows([]); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const downloadTemplate = async (fmt: "csv" | "xlsx") => {
    if (busy) return;
    setBusy("template");
    try {
      const ext = fmt === "xlsx" ? "xlsx" : "csv";
      const mime = fmt === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv";
      const filename = `cheerplanner-skills-template.${ext}`;
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/team/scouting/skills/template?fmt=${fmt}`;
      if (Platform.OS === "web") {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      } else {
        const FS: any = await import("expo-file-system/legacy");
        const Sharing: any = await import("expo-sharing");
        const path = `${FS.cacheDirectory}${filename}`;
        const dl = await FS.downloadAsync(url, path, { headers: { Authorization: `Bearer ${token}` } });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dl.uri, { mimeType: mime, dialogTitle: "Save template" });
        } else {
          Alert.alert("Saved", `Template saved to ${dl.uri}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Download failed", e?.message || "Could not download the template.");
    } finally { setBusy(null); }
  };

  const onTemplatePress = () => {
    Alert.alert("Download template", "Pick a format. Fill in Category, Level (1-7) and Skill Name, then upload.", [
      { text: "CSV (.csv)", onPress: () => downloadTemplate("csv") },
      { text: "Excel (.xlsx)", onPress: () => downloadTemplate("xlsx") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const pickAndImport = async () => {
    if (busy) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      setBusy("import");
      const fd = new FormData();
      if (Platform.OS === "web") {
        const blob = await fetch(asset.uri).then((r) => r.blob());
        fd.append("file", blob, asset.name || "upload");
      } else {
        // @ts-expect-error RN FormData accepts file objects with uri/name/type
        fd.append("file", { uri: asset.uri, name: asset.name || "upload", type: asset.mimeType || "application/octet-stream" });
      }
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      const res = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/team/scouting/skills/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      await load();
      const parts = [`${data.added || 0} skill${(data.added === 1) ? "" : "s"} added`];
      if (data.skipped_duplicates) parts.push(`${data.skipped_duplicates} duplicate${data.skipped_duplicates === 1 ? "" : "s"} skipped`);
      if (data.invalid_rows) parts.push(`${data.invalid_rows} row${data.invalid_rows === 1 ? "" : "s"} skipped (missing category/level/name)`);
      Alert.alert("Import complete", parts.join("\n"));
    } catch (e: any) {
      let msg = e?.message || "Could not import the file.";
      try { const j = JSON.parse(msg); if (j?.detail) msg = j.detail; } catch {}
      Alert.alert("Import failed", msg);
    } finally { setBusy(null); }
  };

  const persist = async (data: Row[]) => {
    // Recompute each skill's category + level + sub-category from anchors above it.
    let curCat = SCOUT_CATEGORIES[0].key;
    let curLevel = 1;
    let curSub = "";
    let order = 0;
    const items: { id: string; category: string; level_group: number; sub_category: string; order: number }[] = [];
    for (const it of data) {
      if (it.type === "cat") { curCat = it.category; curLevel = 1; curSub = ""; order = 0; }
      else if (it.type === "divider") { curLevel = it.level; curSub = ""; order = 0; }
      else if (it.type === "subdivider") { curSub = it.sub; order = 0; }
      else { items.push({ id: it.skill.id, category: curCat, level_group: curLevel, sub_category: curCat === "tumbling" ? curSub : "", order: order++ }); }
    }
    try { await api.post("/team/scouting/skills/reorder", { items }); } catch (_e) { load(); }
  };

  const onDragEnd = ({ data }: { data: Row[] }) => {
    // Keep category/level/sub-dividers in canonical positions; only skills move.
    const skillsByKey: Record<string, Skill> = {};
    data.forEach((r) => { if (r.type === "skill") skillsByKey[r.skill.id] = r.skill; });
    let curCat = SCOUT_CATEGORIES[0].key, curLevel = 1, curSub = "";
    const placed: Record<string, { category: string; level: number; sub: string; seq: number }> = {};
    let seq = 0;
    for (const it of data) {
      if (it.type === "cat") { curCat = it.category; curSub = ""; }
      else if (it.type === "divider") { curLevel = it.level; curSub = ""; }
      else if (it.type === "subdivider") { curSub = it.sub; }
      else placed[it.skill.id] = { category: curCat, level: curLevel, sub: curSub, seq: seq++ };
    }
    const cats: Record<string, Skill[]> = {};
    Object.values(skillsByKey).forEach((s) => {
      const p = placed[s.id];
      const cat = p?.category || s.category;
      (cats[cat] = cats[cat] || []).push({ ...s, category: cat, level_group: p?.level || 1, sub_category: cat === "tumbling" ? (p?.sub || "standing") : "" });
    });
    Object.keys(cats).forEach((k) => cats[k].sort((a, b) => (placed[a.id]?.seq || 0) - (placed[b.id]?.seq || 0)));
    const next = buildRows(cats);
    setRows(next);
    persist(next);
  };

  const addSkill = async () => {
    if (!addCat || !name.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/team/scouting/skills", { category: addCat, name: name.trim(), level_group: addLevel, sub_category: addSub });
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

  const renderItem = ({ item, drag, isActive }: { item: Row; drag: () => void; isActive: boolean }) => {
    if (item.type === "cat") {
      return (
        <View style={styles.catHead}>
          <Ionicons name={item.icon as any} size={16} color={colors.accent} />
          <Text style={styles.catTitle}>{item.label}</Text>
        </View>
      );
    }
    if (item.type === "divider") {
      const isTumbling = item.category === "tumbling";
      return (
        <View style={styles.dividerRow}>
          <Text style={styles.dividerText}>Level {item.level}</Text>
          <View style={styles.dividerLine} />
          {!isTumbling && (
            <TouchableOpacity onPress={() => { setAddCat(item.category); setAddLevel(item.level); setAddSub(""); setName(""); }} hitSlop={8} testID={`skill-add-${item.category}-${item.level}`}>
              <Ionicons name="add-circle" size={20} color={colors.accent} />
            </TouchableOpacity>
          )}
        </View>
      );
    }
    if (item.type === "subdivider") {
      const label = SUBS.find((s) => s.key === item.sub)?.label || item.sub;
      return (
        <View style={styles.subdividerRow}>
          <Ionicons name={item.sub === "standing" ? "body-outline" : "walk-outline"} size={13} color={colors.textSecondary} />
          <Text style={styles.subdividerText}>{label}</Text>
          <View style={styles.dividerLine} />
          <TouchableOpacity onPress={() => { setAddCat(item.category); setAddLevel(item.level); setAddSub(item.sub); setName(""); }} hitSlop={8} testID={`skill-add-${item.category}-${item.level}-${item.sub}`}>
            <Ionicons name="add-circle" size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <ScaleDecorator>
        <View style={[styles.skillRow, isActive && styles.skillActive]} testID={`skill-${item.skill.id}`}>
          <TouchableOpacity onLongPress={drag} delayLongPress={120} hitSlop={8} testID={`skill-drag-${item.skill.id}`}>
            <Ionicons name="reorder-three-outline" size={22} color={colors.textTertiary} />
          </TouchableOpacity>
          <Text style={styles.skillName}>{item.skill.name}</Text>
          <TouchableOpacity onPress={() => removeSkill(item.skill)} hitSlop={8} testID={`skill-del-${item.skill.id}`}>
            <Ionicons name="trash-outline" size={18} color="#DC2626" />
          </TouchableOpacity>
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="scouting-skills-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Skill Library</Text>
          <Text style={styles.subtitle}>Drag skills to reorder or move between levels</Text>
        </View>
        <TouchableOpacity onPress={onTemplatePress} disabled={!!busy} hitSlop={8} style={styles.headBtn} testID="skills-template-btn">
          {busy === "template" ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="download-outline" size={22} color={colors.accent} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={pickAndImport} disabled={!!busy} hitSlop={8} style={styles.headBtn} testID="skills-import-btn">
          {busy === "import" ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="cloud-upload-outline" size={22} color={colors.accent} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <GestureHandlerRootView style={{ flex: 1 }}>
          <DraggableFlatList
            data={rows}
            keyExtractor={(it) => it.key}
            renderItem={renderItem}
            onDragEnd={onDragEnd}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator
          />
        </GestureHandlerRootView>
      )}

      <Modal visible={!!addCat} transparent animationType="fade" onRequestClose={() => setAddCat(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setAddCat(null)}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="skill-add-modal">
            <Text style={styles.sheetTitle}>Add skill · {SCOUT_CATEGORIES.find((c) => c.key === addCat)?.label}{addSub ? ` · ${SUBS.find((s) => s.key === addSub)?.label}` : ""} · Level {addLevel}</Text>
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
  headBtn: { padding: 4, minWidth: 30, alignItems: "center" as const },
  title: { ...typography.h3, color: c.textPrimary },
  subtitle: { ...typography.caption, color: c.textSecondary },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  catHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, marginBottom: 4 },
  catTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, fontSize: 17 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm, marginBottom: 4 },
  dividerText: { ...typography.caption, fontWeight: "800", color: c.textTertiary, letterSpacing: 0.5 },
  subdividerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, marginBottom: 2, paddingLeft: 6 },
  subdividerText: { ...typography.caption, fontWeight: "700", color: c.textSecondary, fontSize: 11 },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
  skillRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: c.border, marginBottom: 6 },
  skillActive: { borderColor: c.accent, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 },
  skillName: { ...typography.body, color: c.textPrimary, flex: 1 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg, gap: 10 },
  sheetTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, ...typography.body, color: c.textPrimary },
  saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 13, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelText: { ...typography.body, color: c.textSecondary, fontWeight: "600" },
});
