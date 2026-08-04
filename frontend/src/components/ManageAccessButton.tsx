import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";

type Member = { id: string; name?: string; email?: string; team_access?: boolean; blocked: boolean };
type Props = { resource: "payment" | "signup" | "paperwork" | "attendance"; resourceId: string };

/**
 * Owner-only control to hide a specific sheet/tracker from individual Team Hub
 * members (e.g. block the coach from the "Coach's gift" payment tracker).
 * Renders nothing unless the current user is the household owner AND there are
 * other members to manage.
 */
export default function ManageAccessButton({ resource, resourceId }: Props) {
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ is_owner: boolean; members: Member[] }>(`/team/blocks/${resource}/${resourceId}`);
      setIsOwner(!!r.data.is_owner);
      setMembers(r.data.members || []);
    } catch { /* non-owners get 200 with is_owner:false; ignore errors */ }
  }, [resource, resourceId]);

  useEffect(() => { load(); }, [load]);

  if (!isOwner || members.length === 0) return null;
  const hiddenCount = members.filter((m) => m.blocked).length;

  const toggle = async (m: Member, hide: boolean) => {
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, blocked: hide } : x)));
    try {
      await api.put(`/team/blocks?blocked=${hide}`, { blocked_user_id: m.id, resource, resource_id: resourceId });
    } catch {
      load();
    }
  };

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.iconBtn} testID="manage-access-btn" hitSlop={8}>
        <Ionicons name="people-outline" size={18} color={colors.textPrimary} />
        {hiddenCount > 0 && (
          <View style={styles.badge}><Text style={styles.badgeText}>{hiddenCount}</Text></View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Who can see this</Text>
            <Text style={styles.sub}>Turn on “Hidden” to hide this from a person (e.g. hide a coach’s-gift tracker from the coach).</Text>
            <ScrollView style={{ maxHeight: 380, marginTop: spacing.md }}>
              {members.map((m) => (
                <View key={m.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{m.name || m.email || "Member"}</Text>
                    {!!m.email && !!m.name && <Text style={styles.meta} numberOfLines={1}>{m.email}</Text>}
                  </View>
                  <Text style={[styles.tag, m.blocked ? styles.tagHidden : styles.tagVisible]}>{m.blocked ? "Hidden" : "Visible"}</Text>
                  <Switch
                    value={m.blocked}
                    onValueChange={(v) => toggle(m, v)}
                    trackColor={{ true: colors.danger, false: colors.border }}
                    testID={`manage-access-toggle-${m.id}`}
                  />
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.done} onPress={() => setOpen(false)} testID="manage-access-done">
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "white", fontSize: 10, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl, maxHeight: "80%" },
  title: { ...typography.h3, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700" },
  meta: { ...typography.caption, color: colors.textTertiary, marginTop: 1 },
  tag: { ...typography.caption, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagHidden: { color: colors.dangerText, backgroundColor: colors.danger + "22" },
  tagVisible: { color: colors.textSecondary, backgroundColor: colors.border + "55" },
  done: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  doneText: { color: "white", fontWeight: "800", fontSize: 15 },
});
