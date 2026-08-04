import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Broadcast = {
  id: string; message: string; created_by_name?: string;
  recipient_count: number; sent: number; failed: number;
  failed_recipients?: { name: string; phone: string }[]; no_phone?: string[];
  track_count?: number; attachment_count?: number; created_at?: string;
};

function fmt(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function BroadcastHistoryScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Broadcast[]>("/team/broadcast/history");
      setItems(r.data || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="history-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Text history</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyText}>No texts sent yet.</Text>
            </View>
          ) : items.map((b) => {
            const open = expanded === b.id;
            return (
              <TouchableOpacity key={b.id} style={styles.card} activeOpacity={0.7} onPress={() => setExpanded(open ? null : b.id)} testID={`history-row-${b.id}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.date}>{fmt(b.created_at)}</Text>
                  <View style={styles.pills}>
                    <Text style={[styles.pill, styles.sentPill]}>{b.sent} sent</Text>
                    {b.failed > 0 && <Text style={[styles.pill, styles.failPill]}>{b.failed} failed</Text>}
                  </View>
                </View>
                <Text style={styles.msg} numberOfLines={open ? undefined : 2}>{b.message || "(no message)"}</Text>
                <Text style={styles.meta}>
                  {b.recipient_count} recipient{b.recipient_count === 1 ? "" : "s"}
                  {b.track_count ? ` · ${b.track_count} 🎵` : ""}
                  {b.attachment_count ? ` · ${b.attachment_count} 📎` : ""}
                  {b.created_by_name ? ` · by ${b.created_by_name}` : ""}
                </Text>
                {open && (
                  <View style={styles.details}>
                    {!!b.failed_recipients?.length && (
                      <>
                        <Text style={styles.detailHead}>Failed</Text>
                        {b.failed_recipients.map((f, i) => <Text key={`f${i}`} style={styles.detailItem}>• {f.name} ({f.phone})</Text>)}
                      </>
                    )}
                    {!!b.no_phone?.length && (
                      <>
                        <Text style={styles.detailHead}>No phone on file</Text>
                        {b.no_phone.map((n, i) => <Text key={`n${i}`} style={styles.detailItem}>• {n}</Text>)}
                      </>
                    )}
                    {!b.failed_recipients?.length && !b.no_phone?.length && (
                      <Text style={styles.detailItem}>Delivered to everyone with a phone on file. 🎉</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary },
  empty: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText: { ...typography.body, color: c.textSecondary },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  date: { ...typography.caption, color: c.textTertiary, fontWeight: "700" },
  pills: { flexDirection: "row", gap: 6 },
  pill: { ...typography.caption, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  sentPill: { color: c.success, backgroundColor: c.success + "22" },
  failPill: { color: c.dangerText, backgroundColor: c.danger + "22" },
  msg: { ...typography.body, color: c.textPrimary, marginBottom: 6 },
  meta: { ...typography.caption, color: c.textTertiary },
  details: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm },
  detailHead: { ...typography.caption, color: c.textSecondary, fontWeight: "800", marginTop: 6, marginBottom: 2 },
  detailItem: { ...typography.body, color: c.textPrimary, paddingVertical: 1 },
});
