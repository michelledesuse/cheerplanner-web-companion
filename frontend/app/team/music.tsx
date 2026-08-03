import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

import { api, TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";

type Track = {
  id: string; title: string; size: number; content_type: string;
  team_ids: string[]; competition_ids: string[]; uploaded_by_name?: string; created_at: string;
};
type Team = { id: string; name: string };
type Comp = { id: string; name: string };

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const CHUNK = 720000; // base64 chars per chunk (divisible by 4 → each chunk decodes cleanly)
const MAX_BYTES = 15 * 1024 * 1024;

function fmtSize(bytes: number) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function fileToBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }
  return await readAsStringAsync(uri, { encoding: "base64" });
}

export default function TeamMusicScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Upload / edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [pendingMime, setPendingMime] = useState<string>("audio/mpeg");
  const [pendingName, setPendingName] = useState<string>("");
  const [title, setTitle] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [compIds, setCompIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // Playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const load = useCallback(async () => {
    try {
      const [t, tm, cp, tok] = await Promise.all([
        api.get<Track[]>("/team/music"),
        api.get<Team[]>("/teams"),
        api.get<Comp[]>("/competitions"),
        storage.secureGet<string>(TOKEN_KEY, ""),
      ]);
      setTracks(t.data || []);
      setTeams(tm.data || []);
      setComps(cp.data || []);
      setToken(typeof tok === "string" ? tok : "");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRealtimeRefetch(load);

  const togglePlay = (t: Track) => {
    if (playingId === t.id) {
      if (status.playing) player.pause(); else player.play();
      return;
    }
    const uri = `${BACKEND}/api/team/music/${t.id}/stream?token=${encodeURIComponent(token)}`;
    try {
      player.replace({ uri });
      player.play();
      setPlayingId(t.id);
    } catch {
      Alert.alert("Playback error", "Could not play this track.");
    }
  };

  const pickAndOpen = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if (a.size && a.size > MAX_BYTES) {
        Alert.alert("File too large", "Please choose an audio file under 15 MB.");
        return;
      }
      setEditingId(null);
      setPendingUri(a.uri);
      setPendingMime(a.mimeType || "audio/mpeg");
      setPendingName(a.name || "track");
      setTitle((a.name || "Track").replace(/\.[^.]+$/, ""));
      setTeamIds([]); setCompIds([]); setProgress(0);
      setModalOpen(true);
    } catch {
      Alert.alert("Error", "Could not open the file picker.");
    }
  };

  const openEdit = (t: Track) => {
    setEditingId(t.id);
    setPendingUri(null);
    setTitle(t.title);
    setTeamIds(t.team_ids || []);
    setCompIds(t.competition_ids || []);
    setModalOpen(true);
  };

  const closeModal = () => { if (!busy) { setModalOpen(false); setPendingUri(null); setEditingId(null); } };

  const submit = async () => {
    if (!title.trim()) { Alert.alert("Missing", "Please enter a title."); return; }
    setBusy(true);
    try {
      if (editingId) {
        await api.patch(`/team/music/${editingId}`, { title: title.trim(), team_ids: teamIds, competition_ids: compIds });
      } else if (pendingUri) {
        const init = await api.post<{ track_id: string }>("/team/music/init", {
          title: title.trim(), filename: pendingName, content_type: pendingMime,
          team_ids: teamIds, competition_ids: compIds,
        });
        const tid = init.data.track_id;
        const b64 = await fileToBase64(pendingUri);
        if (!b64) throw new Error("empty");
        let idx = 0;
        for (let i = 0; i < b64.length; i += CHUNK, idx++) {
          await api.post(`/team/music/${tid}/chunk`, { index: idx, data: b64.slice(i, i + CHUNK) });
          setProgress(Math.min(0.99, (i + CHUNK) / b64.length));
        }
        await api.post(`/team/music/${tid}/finish`);
      }
      setModalOpen(false); setPendingUri(null); setEditingId(null);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save the track.");
    } finally { setBusy(false); setProgress(0); }
  };

  const remove = (t: Track) => {
    const doDelete = async () => {
      try {
        if (playingId === t.id) { player.pause(); setPlayingId(null); }
        await api.delete(`/team/music/${t.id}`);
        await load();
      } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete."); }
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`Delete "${t.title}"?`)) doDelete();
      return;
    }
    Alert.alert("Delete track?", `"${t.title}" will be removed for everyone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const attachLabel = (t: Track) => {
    const parts: string[] = [];
    t.team_ids?.forEach((id) => { const nm = teams.find((x) => x.id === id)?.name; if (nm) parts.push(nm); });
    t.competition_ids?.forEach((id) => { const nm = comps.find((x) => x.id === id)?.name; if (nm) parts.push(nm); });
    return parts.join(" · ");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={8} testID="music-back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Team Music</Text>
        <TouchableOpacity onPress={pickAndOpen} style={styles.iconBtn} hitSlop={8} testID="music-upload">
          <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {tracks.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="musical-notes-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No music yet</Text>
              <Text style={styles.emptyText}>Upload competition mixes or music to share with your team. Everyone with Team Hub access can listen.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={pickAndOpen} testID="music-upload-empty">
                <Ionicons name="cloud-upload-outline" size={16} color="white" />
                <Text style={styles.primaryBtnText}>Upload a track</Text>
              </TouchableOpacity>
            </View>
          ) : (
            tracks.map((t) => {
              const isPlaying = playingId === t.id && status.playing;
              const attach = attachLabel(t);
              return (
                <View key={t.id} style={styles.card} testID={`music-track-${t.id}`}>
                  <TouchableOpacity style={styles.playBtn} onPress={() => togglePlay(t)} testID={`music-play-${t.id}`}>
                    <Ionicons name={isPlaying ? "pause" : "play"} size={20} color="white" />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.trackMeta} numberOfLines={1}>
                      {[fmtSize(t.size), t.uploaded_by_name && `by ${t.uploaded_by_name}`].filter(Boolean).join(" · ")}
                    </Text>
                    {attach ? <Text style={styles.trackAttach} numberOfLines={1}>{attach}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => openEdit(t)} hitSlop={8} style={styles.rowAction} testID={`music-edit-${t.id}`}>
                    <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(t)} hitSlop={8} style={styles.rowAction} testID={`music-delete-${t.id}`}>
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{editingId ? "Edit track" : "Upload track"}</Text>
                <TouchableOpacity onPress={closeModal} hitSlop={10} disabled={busy}>
                  <Ionicons name="close" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                {!editingId && pendingName ? <Text style={styles.fileHint}>{pendingName}</Text> : null}
                <Text style={styles.label}>Title</Text>
                <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Senior Coed Mix" placeholderTextColor={colors.textTertiary} testID="music-title-input" />

                {teams.length > 0 && (
                  <>
                    <Text style={styles.label}>Attach to team(s) <Text style={styles.hint}>(optional)</Text></Text>
                    <View style={styles.chipWrap}>
                      {teams.map((tm) => {
                        const on = teamIds.includes(tm.id);
                        return (
                          <TouchableOpacity key={tm.id} onPress={() => setTeamIds((p) => on ? p.filter((x) => x !== tm.id) : [...p, tm.id])} style={[styles.chip, on && styles.chipOn]} testID={`music-team-${tm.id}`}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{tm.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
                {comps.length > 0 && (
                  <>
                    <Text style={styles.label}>Attach to competition(s) <Text style={styles.hint}>(optional)</Text></Text>
                    <View style={styles.chipWrap}>
                      {comps.map((cp) => {
                        const on = compIds.includes(cp.id);
                        return (
                          <TouchableOpacity key={cp.id} onPress={() => setCompIds((p) => on ? p.filter((x) => x !== cp.id) : [...p, cp.id])} style={[styles.chip, on && styles.chipOn]} testID={`music-comp-${cp.id}`}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{cp.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {busy && !editingId ? (
                  <View style={styles.progressWrap}>
                    <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
                    <Text style={styles.progressText}>Uploading… {Math.round(progress * 100)}%</Text>
                  </View>
                ) : null}

                <TouchableOpacity style={[styles.primaryBtn, { marginTop: spacing.lg }, busy && { opacity: 0.7 }]} onPress={submit} disabled={busy} testID="music-save">
                  {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>{editingId ? "Save changes" : "Upload"}</Text>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 48 },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: 4 },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center", lineHeight: 19, paddingHorizontal: 20 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, marginBottom: 10 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  trackTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  trackMeta: { ...typography.caption, color: c.textTertiary, marginTop: 2 },
  trackAttach: { ...typography.caption, color: c.accent, marginTop: 2, fontWeight: "600" },
  rowAction: { padding: 4 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16, marginTop: spacing.md },
  primaryBtnText: { color: "white", fontWeight: "800", fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: spacing.lg, maxHeight: "85%" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  sheetTitle: { ...typography.h3, color: c.textPrimary },
  fileHint: { ...typography.caption, color: c.textSecondary, marginBottom: 8 },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  hint: { ...typography.caption, color: c.textTertiary, fontWeight: "500" },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { ...typography.caption, color: c.textPrimary, fontWeight: "700", fontSize: 12 },
  chipTextOn: { color: "white" },
  progressWrap: { marginTop: spacing.lg, height: 24, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, justifyContent: "center", overflow: "hidden" },
  progressBar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: c.accentSubtle },
  progressText: { ...typography.micro, color: c.textPrimary, fontWeight: "700", textAlign: "center" },
});
