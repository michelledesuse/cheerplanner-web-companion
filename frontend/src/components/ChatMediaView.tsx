import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";

import { chatMediaUrl } from "@/src/utils/chatMedia";
import { colors, radius } from "@/src/theme";

type Media = { id: string; kind: "image" | "video" | "audio"; content_type: string; name?: string };

export default function ChatMediaView({ media, token, mine }: { media: Media; token: string; mine?: boolean }) {
  const uri = chatMediaUrl(media.id, token);
  if (!token) return null;
  if (media.kind === "image") return <ChatImage uri={uri} />;
  if (media.kind === "video") return <ChatVideo uri={uri} />;
  return <ChatAudio uri={uri} name={media.name} mine={mine} />;
}

function ChatImage({ uri }: { uri: string }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <TouchableOpacity activeOpacity={0.9} onPress={() => setFull(true)} testID="chat-media-image">
        <Image source={{ uri }} style={styles.image} contentFit="cover" transition={150} />
      </TouchableOpacity>
      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <Pressable style={styles.lightbox} onPress={() => setFull(false)}>
          <Image source={{ uri }} style={styles.lightboxImg} contentFit="contain" />
          <View style={styles.closePill}><Ionicons name="close" size={22} color="#fff" /></View>
        </Pressable>
      </Modal>
    </>
  );
}

function ChatVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" testID="chat-media-video" />;
}

function ChatAudio({ uri, name, mine }: { uri: string; name?: string; mine?: boolean }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const playing = status?.playing;
  const toggle = () => { if (playing) player.pause(); else { if ((status?.currentTime ?? 0) >= (status?.duration ?? 0)) player.seekTo(0); player.play(); } };
  return (
    <TouchableOpacity style={[styles.audio, mine && { backgroundColor: "rgba(255,255,255,0.18)" }]} onPress={toggle} testID="chat-media-audio">
      <Ionicons name={playing ? "pause-circle" : "play-circle"} size={30} color={mine ? "#fff" : colors.accent} />
      <Text numberOfLines={1} style={[styles.audioName, mine && { color: "#fff" }]}>{name || "Audio clip"}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  image: { width: 210, height: 210, borderRadius: radius.md, marginBottom: 4, backgroundColor: "rgba(0,0,0,0.05)" },
  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  lightboxImg: { width: "94%", height: "80%" },
  closePill: { position: "absolute", top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  video: { width: 230, height: 230, borderRadius: radius.md, marginBottom: 4, backgroundColor: "#000" },
  audio: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.md, backgroundColor: "rgba(0,0,0,0.05)", marginBottom: 4, minWidth: 180, maxWidth: 230 },
  audioName: { flex: 1, fontSize: 13, color: colors.textPrimary },
});
