import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";

type Member = { id: string; name?: string | null; email?: string | null; team_access: boolean; blocked: boolean };
type Props = { resource: "payment" | "paperwork" | "signup" | "sizes" | "attendance"; resourceId: string };

/**
 * Owner-only control to hide a specific sheet/tracker from an individual
 * granted member. Renders a small lock icon; opens a member access list.
 */
export default function SheetAccessButton({ resource, resourceId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get<{ is_owner: boolean; members: Member[] }>(`/team/blocks/${resource}/${resourceId}`);
      setIsOwner(r.data.is_owner);
      setMembers(r.data.members || []);
    } catch { setMembers([]); } finally { setLoading(false); }
  };

  const openModal = async () => { setOpen(true); await load(); };

  const toggle = async (m: Member) => {
    const nextBlocked = !m.blocked;
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, blocked: nextBlocked } : x)));
    try {
      await api.put(`/team/blocks?blocked=${nextBlocked}`, {
        blocked_user_id: m.id, resource, resource_id: resourceId,
      });
    } catch {
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, blocked: m.blocked } : x)));
    }
  };

  return (
    <>
      <TouchableOpacity onPress={openModal} hitSlop={8} testID={`sheet-access-${resourceId}`}>
        <Ionicons name="lock-closed-outline" size={17} color={colors.textTertiary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Who can view this?</Text>
            <Text style={styles.sub}>Toggle off to hide this sheet from a specific person. The account owner always has access.</Text>
            {loading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
            ) : !isOwner ? (
              <Text style={styles.empty}>Only the account owner can manage who sees this sheet.</Text>
            ) : members.length === 0 ? (
              <Text style={styles.empty}>No other members yet. Invite staff from Settings → Team Hub Access to control what each person can see.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 340 }}>
                {members.map((m) => (
                  <TouchableOpacity key={m.id} style={styles.row} onPress={() => toggle(m)} disabled={!m.team_access} testID={`sheet-access-toggle-${m.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{m.name || (m.email || "").split("@")[0]}</Text>
                      {!m.team_access && <Text style={styles.noAccess}>No Team Hub access</Text>}
                    </View>
                    {m.team_access && (
                      <View style={[styles.pill, m.blocked ? styles.pillOff : styles.pillOn]}>
                        <Ionicons name={m.blocked ? "eye-off-outline" : "eye-outline"} size={14} color={m.blocked ? colors.textSecondary : "white"} />
                        <Text style={[styles.pillText, m.blocked ? styles.pillTextOff : styles.pillTextOn]}>{m.blocked ? "Hidden" : "Can view"}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.done} onPress={() => setOpen(false)} testID="sheet-access-done">
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = {
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" as const },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  title: { ...typography.h3, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md, lineHeight: 18 },
  empty: { ...typography.caption, color: colors.textSecondary, marginVertical: spacing.lg, textAlign: "center" as const, lineHeight: 19 },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700" as const },
  noAccess: { ...typography.micro, color: colors.textTertiary, marginTop: 2 },
  pill: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillOn: { backgroundColor: colors.accent },
  pillOff: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  pillText: { ...typography.micro, fontWeight: "800" as const },
  pillTextOn: { color: "white" },
  pillTextOff: { color: colors.textSecondary },
  done: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" as const, marginTop: spacing.lg },
  doneText: { color: "white", fontWeight: "800" as const, fontSize: 15 },
};
