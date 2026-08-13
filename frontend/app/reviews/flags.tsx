import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { Stars } from "@/src/components/Stars";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type FlagRow = {
  flag: { id: string; reason?: string; created_at?: string };
  review: { id: string; author_name: string; rating: number; body?: string };
  place?: { name?: string; city?: string };
};

export default function FlagsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get("/reviews/flags"); setRows(r.data.flags || []); }
    catch (_e) {} finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const del = (rev: FlagRow["review"]) => {
    Alert.alert("Delete this review?", "Removes it for everyone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/reviews/${rev.id}`); await load(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not delete"); }
      } },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={styles._icon.color} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reported reviews</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={styles._icon.color} /> :
          rows.length === 0 ? <Text style={styles.empty}>No reported reviews. 🎉</Text> :
          rows.map((row) => (
            <View key={row.flag.id} style={styles.card}>
              <Text style={styles.place}>{row.place?.name || "Unknown place"}{row.place?.city ? ` • ${row.place.city}` : ""}</Text>
              <View style={{ marginTop: 4 }}><Stars value={row.review.rating} size={14} /></View>
              <Text style={styles.author}>by {row.review.author_name}</Text>
              {!!row.review.body && <Text style={styles.body}>{row.review.body}</Text>}
              {!!row.flag.reason && <Text style={styles.reason}>Reason: {row.flag.reason}</Text>}
              <TouchableOpacity style={styles.delBtn} onPress={() => del(row.review)}>
                <Ionicons name="trash-outline" size={16} color="#fff" />
                <Text style={styles.delText}>Delete review</Text>
              </TouchableOpacity>
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  _icon: { color: c.textPrimary },
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  headerTitle: { fontSize: 18, fontWeight: "700" as const, color: c.textPrimary },
  empty: { color: c.textTertiary, textAlign: "center" as const, marginTop: 50, fontSize: 14 },
  card: { backgroundColor: c.card, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border, marginBottom: 12 },
  place: { fontWeight: "700" as const, color: c.textPrimary, fontSize: 15 },
  author: { color: c.textTertiary, fontSize: 12, marginTop: 6 },
  body: { color: c.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 8 },
  reason: { color: c.warningText, fontSize: 13, marginTop: 8 },
  delBtn: { flexDirection: "row" as const, alignItems: "center" as const, alignSelf: "flex-start" as const, backgroundColor: c.danger || "#DC2626", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginTop: 12, gap: 6 },
  delText: { color: "#fff", fontWeight: "700" as const, fontSize: 13 },
});
