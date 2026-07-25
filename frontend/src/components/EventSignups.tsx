import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

type Sheet = { id: string; name: string; summary: { needed_total: number; claimed_total: number } };
type Props = { eventId: string; eventTitle?: string };

/** Sign-up sheets linked to a schedule event. Only shown to Team Hub members. */
export default function EventSignups({ eventId, eventTitle }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const enabled = !!user?.team_access;

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    try {
      const r = await api.get<Sheet[]>("/team/signups", { params: { event_id: eventId } });
      setSheets(r.data);
    } catch (_e) {} finally { setLoading(false); }
  }, [enabled, eventId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createLinked = async () => {
    setCreating(true);
    try {
      const name = `${eventTitle || "Event"} sign-ups`;
      const r = await api.post<{ id: string }>("/team/signups", { name, event_id: eventId });
      router.push({ pathname: "/team/signup-sheet", params: { id: r.data.id } });
    } catch (_e) {} finally { setCreating(false); }
  };

  if (!enabled) return null;

  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={styles.head}>Sign-up sheets</Text>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
      ) : (
        <>
          {sheets.map((s) => (
            <TouchableOpacity key={s.id} style={styles.row} onPress={() => router.push({ pathname: "/team/signup-sheet", params: { id: s.id } })} testID={`event-signup-${s.id}`}>
              <Ionicons name="hand-left-outline" size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.meta}>{s.summary.claimed_total}/{s.summary.needed_total} claimed</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.addBtn} onPress={createLinked} disabled={creating} testID="event-signup-add">
            {creating ? <ActivityIndicator color={colors.accent} size="small" /> : (
              <>
                <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                <Text style={styles.addText}>New sign-up sheet for this event</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  name: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700" },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.accentSubtle, borderWidth: 1, borderColor: colors.accent },
  addText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
});
