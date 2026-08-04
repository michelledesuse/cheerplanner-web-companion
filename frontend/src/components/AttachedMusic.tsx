import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, Pressable, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";

import { api, TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

type Track = {
  id: string; title: string; size?: number;
  team_ids?: string[]; competition_ids?: string[]; event_ids?: string[];
  uploaded_by_name?: string;
};
type CtxKey = "competition_ids" | "event_ids" | "team_ids";
type Props = { contextKey: CtxKey; contextId: string; standalone?: boolean };

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || "";

/**
 * Shows Team Music tracks attached to a competition / event / team, with an
 * inline play/pause mini-player and the ability to attach/detach existing
 * tracks. Only rendered for Team Hub members. Reused inside LinkedTools
 * (competition + event) and on the Teams screen (team context).
 */
export default function AttachedMusic({ contextKey, contextId, standalone }: Props) {
  const { user } = useAuth();
  const enabled = !!user?.team_access;

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [token, setToken] = useState("");

  const [playingId, setPlayingId] = useState<string | null>(null);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); }, []);

  const load = useCallback(async () => {
    if (!enabled || !contextId) { setLoading(false); return; }
    try {
      const [r, tok] = await Promise.all([
        api.get<Track[]>("/team/music").then((x) => x.data).catch(() => [] as Track[]),
        storage.secureGet<string>(TOKEN_KEY, ""),
      ]);
      setTracks(r || []);
      setToken(typeof tok === "string" ? tok : "");
    } finally { setLoading(false); }
  }, [enabled, contextId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const attached = tracks.filter((t) => (t[contextKey] || []).includes(contextId));
  const unattached = tracks.filter((t) => !(t[contextKey] || []).includes(contextId));

  const togglePlay = (t: Track) => {
    if (playingId === t.id) {
      if (status.playing) player.pause(); else player.play();
      return;
    }
    try {
      player.replace({ uri: `${BACKEND}/api/team/music/${t.id}/stream?token=${encodeURIComponent(token)}` });
      player.play();
      setPlayingId(t.id);
    } catch {
      Alert.alert("Playback error", "Could not play this track.");
    }
  };

  const toggleAttach = async (t: Track, attach: boolean) => {
    if (playingId === t.id && !attach) { player.pause(); setPlayingId(null); }
    const set = new Set(t[contextKey] || []);
    if (attach) set.add(contextId); else set.delete(contextId);
    const next = [...set];
    setTracks((prev) => prev.map((x) => (x.id === t.id ? { ...x, [contextKey]: next } : x)));
    try { await api.patch(`/team/music/${t.id}`, { [contextKey]: next }); } catch { load(); }
  };

  if (!enabled || !contextId) return null;

  const isPlaying = (t: Track) => playingId === t.id && status.playing;

  const body = (
    <View style={standalone ? undefined : styles.toolBlock}>
      <View style={styles.toolHead}>
        <Ionicons name="musical-notes-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.toolLabel}>Team music</Text>
        {unattached.length > 0 && (
          <TouchableOpacity onPress={() => setPicker(true)} hitSlop={8} testID="music-attach-open">
            <Text style={styles.attachLink}>＋ Attach</Text>
          </TouchableOpacity>
        )}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.sm }} />
      ) : attached.length === 0 ? (
        <Text style={styles.none}>None attached</Text>
      ) : attached.map((t) => (
        <View key={t.id} style={styles.row}>
          <TouchableOpacity onPress={() => togglePlay(t)} style={styles.playBtn} testID={`music-play-${t.id}`}>
            <Ionicons name={isPlaying(t) ? "pause" : "play"} size={18} color="white" />
          </TouchableOpacity>
          <View style={styles.rowMain}>
            <Text style={styles.rowName} numberOfLines={1}>{t.title}</Text>
            {!!t.uploaded_by_name && <Text style={styles.rowMeta} numberOfLines={1}>{t.uploaded_by_name}</Text>}
          </View>
          <TouchableOpacity onPress={() => toggleAttach(t, false)} hitSlop={8} style={styles.unlink} testID={`music-unlink-${t.id}`}>
            <Ionicons name="close-circle" size={19} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      ))}

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(false)}>
          <Pressable style={[styles.sheet, styles.pickerSheet]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Attach team music</Text>
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator>
              {unattached.length === 0 ? (
                <Text style={styles.none}>Nothing left to attach.</Text>
              ) : unattached.map((t) => (
                <TouchableOpacity key={t.id} style={styles.pickRow} onPress={() => toggleAttach(t, true)} testID={`music-pick-${t.id}`}>
                  <Ionicons name="musical-notes" size={18} color={colors.accent} />
                  <Text style={styles.rowName} numberOfLines={1}>{t.title}</Text>
                  <Ionicons name="add-circle" size={20} color={colors.accent} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.done} onPress={() => setPicker(false)} testID="music-picker-done">
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );

  if (standalone) {
    return (
      <View style={styles.standaloneWrap}>
        <Text style={styles.header}>Team music</Text>
        {body}
      </View>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  standaloneWrap: { marginTop: spacing.xl },
  header: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  toolBlock: { marginBottom: spacing.md },
  toolHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  toolLabel: { ...typography.caption, fontWeight: "800", color: colors.textSecondary, flex: 1, textTransform: "uppercase", letterSpacing: 0.4 },
  attachLink: { ...typography.caption, color: colors.accent, fontWeight: "800" },
  none: { ...typography.caption, color: colors.textTertiary, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: 6 },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  rowMain: { flex: 1 },
  rowName: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700", flex: 1 },
  rowMeta: { ...typography.caption, color: colors.textTertiary, marginTop: 1 },
  unlink: { padding: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  pickerSheet: { maxHeight: "80%" },
  modalTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  done: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  doneText: { color: "white", fontWeight: "800", fontSize: 15 },
});
