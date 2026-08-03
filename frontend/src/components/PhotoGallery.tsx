import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet, Alert, Modal, Pressable, Linking, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { colors, radius, spacing, typography } from "@/src/theme";

/**
 * Reusable multi-photo gallery. Stores photos as base64 data URLs (consistent
 * with avatars/receipts elsewhere). Add from library, view full-screen, remove.
 */
export default function PhotoGallery({
  photos,
  onChange,
  max = 8,
  label = "Photos",
  testIDPrefix = "photos",
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  max?: number;
  label?: string;
  testIDPrefix?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const list = photos || [];

  const add = async () => {
    if (list.length >= max) { Alert.alert("Limit reached", `You can add up to ${max} photos.`); return; }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Photo access needed",
          "Allow photo access to attach pictures.",
          perm.canAskAgain
            ? [{ text: "OK" }]
            : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]
        );
        return;
      }
      setBusy(true);
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        base64: true,
        allowsMultipleSelection: true,
        selectionLimit: max - list.length,
      });
      if (!res.canceled && res.assets?.length) {
        const next = [...list];
        for (const a of res.assets) {
          if (a.base64 && next.length < max) next.push(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
        }
        onChange(next);
      }
    } catch {
      Alert.alert("Error", "Could not load the image.");
    } finally { setBusy(false); }
  };

  const remove = (i: number) => onChange(list.filter((_, idx) => idx !== i));

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}{list.length ? ` (${list.length})` : ""}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {list.map((uri, i) => (
          <View key={i} style={styles.thumbWrap}>
            <TouchableOpacity onPress={() => setViewer(uri)} testID={`${testIDPrefix}-thumb-${i}`} activeOpacity={0.8}>
              <Image source={{ uri }} style={styles.thumb} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(i)} style={styles.removeBadge} testID={`${testIDPrefix}-remove-${i}`} hitSlop={6}>
              <Ionicons name="close" size={14} color="white" />
            </TouchableOpacity>
          </View>
        ))}
        {list.length < max && (
          <TouchableOpacity style={styles.addTile} onPress={add} disabled={busy} testID={`${testIDPrefix}-add`}>
            {busy ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="camera-outline" size={24} color={colors.accent} />}
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={styles.viewerImg} resizeMode="contain" /> : null}
          <View style={styles.viewerClose}><Ionicons name="close" size={28} color="white" /></View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", marginBottom: 8 },
  row: { gap: 10, paddingRight: spacing.md },
  thumbWrap: { position: "relative" },
  thumb: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  removeBadge: { position: "absolute", top: -6, right: -6, backgroundColor: "rgba(0,0,0,0.7)", width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  addTile: { width: 76, height: 76, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSubtle, gap: 2 },
  addText: { ...typography.micro, color: colors.accent, fontWeight: "700" },
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerImg: { width: "92%", height: "80%" },
  viewerClose: { position: "absolute", top: 50, right: 24 },
});
