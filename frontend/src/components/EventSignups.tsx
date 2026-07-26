import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

type Sheet = { id: string; name: string; event_id?: string | null; summary: { needed_total: number; claimed_total: number } };
type Props = { eventId: string; eventTitle?: string };

/** Sign-up sheets linked to a schedule event. Only shown to Team Hub members. */
export default function EventSignups({ eventId, eventTitle }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [all, setAll] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const enabled = !!user?.team_access;

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    try {
      const r = await api.get<Sheet[]>("/team/signups");
      setAll(r.data);
    } catch (_e) {} finally { setLoading(false); }
  }, [enabled]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const linked = all.filter((s) => s.event_id === eventId);
  const candidates = all.filter((s) => s.event_id !== eventId);

  const createLinked = async () => {
    setCreating(true);
    try {
      const name = `${eventTitle || "Event"} sign-ups`;
      const r = await api.post<{ id: string }>("/team/signups", { name, event_id: eventId });
      router.push({ pathname: "/team/signup-sheet", params: { id: r.data.id } });
    } catch (_e) {} finally { setCreating(false); }
  };

  const linkExisting = async (id: string) => {
    setLinkOpen(false);
    try { await api.patch(`/team/signups/${id}`, { event_id: eventId }); await load(); } catch (_e) {}
  };

  const unlink = async (id: string) => {
    try { await api.patch(`/team/signups/${id}`, { event_id: "" }); await load(); } catch (_e) {}
  };

  if (!enabled) return null;

  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={styles.head}>Sign-up sheets</Text>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
      ) : (
        <>
          {linked.map((s) => (
            <View key={s.id} style={styles.row}>
              <TouchableOpacity style={styles.rowMain} onPress={() => router.push({ pathname: "/team/signup-sheet", params: { id: s.id } })} testID={`event-signup-${s.id}`}>
                <Ionicons name="hand-left-outline" size={18} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{s.name}</Text>
                  <Text style={styles.meta}>{s.summary.claimed_total}/{s.summary.needed_total} claimed</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => unlink(s.id)} hitSlop={8} style={styles.unlinkBtn} testID={`event-signup-unlink-${s.id}`}>
                <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.addBtn} onPress={createLinked} disabled={creating} testID="event-signup-add">
              {creating ? <ActivityIndicator color={colors.accent} size="small" /> : (
                <>
                  <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                  <Text style={styles.addText}>New sheet</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => setLinkOpen(true)} disabled={candidates.length === 0} testID="event-signup-link">
              <Ionicons name="link-outline" size={18} color={candidates.length ? colors.accent : colors.textTertiary} />
              <Text style={[styles.addText, !candidates.length && { color: colors.textTertiary }]}>Link existing</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Modal visible={linkOpen} transparent animationType="slide" onRequestClose={() => setLinkOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setLinkOpen(false)}>
          <Pressable style={styles.sheetModal} onPress={() => {}}>
            <Text style={styles.modalTitle}>Link a sign-up sheet</Text>
            <Text style={styles.modalSub}>Attach an existing sheet to this event.</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {candidates.map((s) => (
                <TouchableOpacity key={s.id} style={styles.pickRow} onPress={() => linkExisting(s.id)} testID={`event-signup-pick-${s.id}`}>
                  <Ionicons name="hand-left-outline" size={18} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{s.name}</Text>
                    {!!s.event_id && <Text style={styles.linkedElsewhere}>Currently linked to another event — moves it here</Text>}
                  </View>
                  <Ionicons name="add" size={20} color={colors.accent} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingRight: spacing.sm, marginBottom: spacing.sm },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md },
  unlinkBtn: { padding: 6 },
  name: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700" },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm },
  addBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.accentSubtle, borderWidth: 1, borderColor: colors.accent },
  addText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetModal: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  modalTitle: { ...typography.h3, color: colors.textPrimary },
  modalSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  linkedElsewhere: { ...typography.micro, color: colors.textTertiary, marginTop: 2 },
});
