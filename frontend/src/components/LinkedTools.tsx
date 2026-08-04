import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

type Item = { id: string; name?: string; title?: string; competition_ids?: string[]; event_ids?: string[] };
type Props = { competitionId?: string; eventId?: string };

const TOOLS = [
  { key: "signup", label: "Sign-up sheets", icon: "hand-left-outline" as const, list: "/team/signups", route: "/team/signup-sheet", nameField: "name" },
  { key: "payment", label: "Payment trackers", icon: "card-outline" as const, list: "/team/payments", route: "/team/payment", nameField: "name" },
  { key: "attendance", label: "Attendance", icon: "checkmark-done-outline" as const, list: "/team/attendance", route: "/team/attendance-session", nameField: "title" },
];

/**
 * Shows Team Hub tools (sign-ups, payments, attendance) attached to a given
 * competition OR schedule event, with the ability to attach/detach existing
 * ones. Only rendered for Team Hub members.
 */
export default function LinkedTools({ competitionId, eventId }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const enabled = !!user?.team_access;
  const ctxKey: "competition_ids" | "event_ids" = competitionId ? "competition_ids" : "event_ids";
  const ctxId = (competitionId || eventId) as string;

  const [data, setData] = useState<Record<string, Item[]>>({});
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    try {
      const res = await Promise.all(TOOLS.map((t) => api.get<Item[]>(t.list).then((r) => r.data).catch(() => [])));
      const map: Record<string, Item[]> = {};
      TOOLS.forEach((t, i) => { map[t.key] = res[i]; });
      setData(map);
    } finally { setLoading(false); }
  }, [enabled]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const attachedOf = (key: string) => (data[key] || []).filter((it) => (it[ctxKey] || []).includes(ctxId));
  const unattachedOf = (key: string) => (data[key] || []).filter((it) => !(it[ctxKey] || []).includes(ctxId));

  const toggle = async (tool: typeof TOOLS[number], it: Item, attach: boolean) => {
    const set = new Set(it[ctxKey] || []);
    if (attach) set.add(ctxId); else set.delete(ctxId);
    const next = [...set];
    setData((prev) => ({ ...prev, [tool.key]: (prev[tool.key] || []).map((x) => (x.id === it.id ? { ...x, [ctxKey]: next } : x)) }));
    try { await api.patch(`${tool.list}/${it.id}`, { [ctxKey]: next }); } catch { load(); }
  };

  if (!enabled) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Attached Team Hub tools</Text>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
      ) : (
        TOOLS.map((tool) => {
          const attached = attachedOf(tool.key);
          const canAttach = unattachedOf(tool.key).length > 0;
          return (
            <View key={tool.key} style={styles.toolBlock}>
              <View style={styles.toolHead}>
                <Ionicons name={tool.icon} size={16} color={colors.textSecondary} />
                <Text style={styles.toolLabel}>{tool.label}</Text>
                {canAttach && (
                  <TouchableOpacity onPress={() => setPicker(tool.key)} hitSlop={8} testID={`link-attach-${tool.key}`}>
                    <Text style={styles.attachLink}>＋ Attach</Text>
                  </TouchableOpacity>
                )}
              </View>
              {attached.length === 0 ? (
                <Text style={styles.none}>None attached</Text>
              ) : attached.map((it) => (
                <View key={it.id} style={styles.row}>
                  <TouchableOpacity style={styles.rowMain} onPress={() => router.push({ pathname: tool.route as any, params: { id: it.id } })} testID={`link-open-${it.id}`}>
                    <Text style={styles.rowName} numberOfLines={1}>{(it as any)[tool.nameField]}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => toggle(tool, it, false)} hitSlop={8} style={styles.unlink} testID={`link-unlink-${it.id}`}>
                    <Ionicons name="close-circle" size={19} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          );
        })
      )}

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {picker && (() => {
              const tool = TOOLS.find((t) => t.key === picker)!;
              const options = unattachedOf(tool.key);
              return (
                <>
                  <Text style={styles.modalTitle}>Attach {tool.label.toLowerCase()}</Text>
                  <ScrollView style={{ maxHeight: 360 }}>
                    {options.length === 0 ? (
                      <Text style={styles.none}>Nothing left to attach.</Text>
                    ) : options.map((it) => (
                      <TouchableOpacity key={it.id} style={styles.pickRow} onPress={() => toggle(tool, it, true)} testID={`link-pick-${it.id}`}>
                        <Ionicons name={tool.icon} size={18} color={colors.accent} />
                        <Text style={styles.rowName} numberOfLines={1}>{(it as any)[tool.nameField]}</Text>
                        <Ionicons name="add-circle" size={20} color={colors.accent} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity style={styles.done} onPress={() => setPicker(null)} testID="link-picker-done">
                    <Text style={styles.doneText}>Done</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl },
  header: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  toolBlock: { marginBottom: spacing.md },
  toolHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  toolLabel: { ...typography.caption, fontWeight: "800", color: colors.textSecondary, flex: 1, textTransform: "uppercase", letterSpacing: 0.4 },
  attachLink: { ...typography.caption, color: colors.accent, fontWeight: "800" },
  none: { ...typography.caption, color: colors.textTertiary, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingRight: spacing.sm, marginBottom: 6 },
  rowMain: { flex: 1, padding: spacing.md },
  rowName: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700", flex: 1 },
  unlink: { padding: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  modalTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  done: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  doneText: { color: "white", fontWeight: "800", fontSize: 15 },
});
