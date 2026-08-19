import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";

import { chatMediaUrl, downloadChatMedia } from "@/src/utils/chatMedia";
import { colors, radius } from "@/src/theme";

type Media = { id: string; kind: "image" | "video" | "audio"; content_type: string; name?: string };

/** Small round "download/save" button reused across media types. */
function DownloadBtn({ media, style, dark }: { media: Media; style?: any; dark?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await downloadChatMedia(media); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || "Please try again."); }
    finally { setBusy(false); }
  };
  return (
    <TouchableOpacity style={[styles.dlBtn, dark && styles.dlBtnDark, style]} onPress={run} hitSlop={8} testID="chat-media-download">
      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={16} color="#fff" />}
    </TouchableOpacity>
  );
}

export default function ChatMediaView({ media, token, mine }: { media: Media; token: string; mine?: boolean }) {
  const uri = chatMediaUrl(media.id, token);
  if (!token) return null;
  if (media.kind === "image") return <ChatImage uri={uri} media={media} />;
  if (media.kind === "video") return <ChatVideo uri={uri} media={media} />;
  return <ChatAudio uri={uri} media={media} mine={mine} />;
}

function ChatImage({ uri, media }: { uri: string; media: Media }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <View>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setFull(true)} testID="chat-media-image">
          <Image source={{ uri }} style={styles.image} contentFit="cover" transition={150} />
        </TouchableOpacity>
        <DownloadBtn media={media} style={styles.overlayBtn} />
      </View>
      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <Pressable style={styles.lightbox} onPress={() => setFull(false)}>
          <Image source={{ uri }} style={styles.lightboxImg} contentFit="contain" />
          <View style={styles.closePill}><Ionicons name="close" size={22} color="#fff" /></View>
          <DownloadBtn media={media} style={styles.lightboxDl} dark />
        </Pressable>
      </Modal>
    </>
  );
}

function ChatVideo({ uri, media }: { uri: string; media: Media }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return (
    <View>
      <VideoView player={player} style={styles.video} nativeControls contentFit="contain" testID="chat-media-video" />
      <DownloadBtn media={media} style={styles.overlayBtn} />
    </View>
  );
}

function ChatAudio({ uri, media, mine }: { uri: string; media: Media; mine?: boolean }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const playing = status?.playing;
  const toggle = () => { if (playing) player.pause(); else { if ((status?.currentTime ?? 0) >= (status?.duration ?? 0)) player.seekTo(0); player.play(); } };
  return (
    <View style={[styles.audio, mine && { backgroundColor: "rgba(255,255,255,0.18)" }]}>
      <TouchableOpacity onPress={toggle} testID="chat-media-audio"><Ionicons name={playing ? "pause-circle" : "play-circle"} size={30} color={mine ? "#fff" : colors.accent} /></TouchableOpacity>
      <Text numberOfLines={1} style={[styles.audioName, mine && { color: "#fff" }]}>{media.name || "Audio clip"}</Text>
      <DownloadBtn media={media} style={mine ? undefined : styles.dlBtnAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: 210, height: 210, borderRadius: radius.md, marginBottom: 4, backgroundColor: "rgba(0,0,0,0.05)" },
  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  lightboxImg: { width: "94%", height: "80%" },
  lightboxDl: { position: "absolute", top: 48, left: 20 },
  closePill: { position: "absolute", top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  video: { width: 230, height: 230, borderRadius: radius.md, marginBottom: 4, backgroundColor: "#000" },
  audio: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.md, backgroundColor: "rgba(0,0,0,0.05)", marginBottom: 4, minWidth: 200, maxWidth: 250 },
  audioName: { flex: 1, fontSize: 13, color: colors.textPrimary },
  dlBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  dlBtnDark: { backgroundColor: "rgba(255,255,255,0.22)" },
  dlBtnAccent: { backgroundColor: colors.accent },
  overlayBtn: { position: "absolute", top: 8, right: 8 },
});
