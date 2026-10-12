import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatDate, formatTime12 } from "@/src/utils/format";

type PinKind = "event" | "competition" | "booking" | "custom";
type PinItem = {
  id: string; kind: PinKind; ref_id?: string | null; title: string; date?: string | null; end_date?: string | null;
  time?: string | null; location?: string | null; body?: string | null; can_open?: boolean;
  competition_id?: string | null; pinned_by_name?: string;
};
type Option = { id: string; title: string; subtitle?: string | null; date?: string | null; time?: string | null };

const KIND_META: Record<PinKind, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  event: { label: "Event", icon: "calendar" },
  competition: { label: "Competition", icon: "trophy" },
  booking: { label: "Travel booking", icon: "airplane" },
  custom: { label: "Custom detail", icon: "document-text" },
};

function whenLine(p: { date?: string | null; time?: string | null; location?: string | null }) {
  return [p.date ? formatDate(p.date) : "", p.time ? formatTime12(p.time) : "", p.location || ""].filter(Boolean).join(" · ");
}

/** Pinned events / competitions / bookings / details shown above a chat thread.
 *  Lives beside the existing pinned-messages bar and never touches messages. */
export default function ChatPinnedItems({ channelId, refreshKey }: { channelId: string | null; refreshKey?: number }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<PinItem[]>([]);
  const [canPin, setCanPin] = useState(false);
  const [detail, setDetail] = useState<PinItem | null>(null);
  const [picker, setPicker] = useState(false);
  const [kind, setKind] = useState<PinKind | null>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: PinItem[]; can_pin: boolean }>("/team/chat/pin-items", { params: channelId ? { channel_id: channelId } : {} });
      setItems(r.data.items || []);
      setCanPin(!!r.data.can_pin);
    } catch { setItems([]); }
  }, [channelId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const chooseKind = async (k: PinKind) => {
    setKind(k);
    setOptions(null);
    if (k === "custom") return;
    try {
      const r = await api.get<{ options: Option[] }>("/team/chat/pin-options", { params: { kind: k } });
      setOptions(r.data.options || []);
    } catch { setOptions([]); }
  };

  const closePicker = () => { setPicker(false); setKind(null); setOptions(null); setTitle(""); setBody(""); };

  const pin = async (refId?: string) => {
    if (!kind) return;
    setSaving(true);
    try {
      await api.post("/team/chat/pin-items", { kind, ref_id: refId, title, body, channel_id: channelId });
      closePicker();
      load();
    } catch (e: any) {
      Alert.alert("Couldn't pin", e?.response?.data?.detail || "Please try again.");
    } finally { setSaving(false); }
  };

  const unpin = async (p: PinItem) => {
    try { await api.delete(`/team/chat/pin-items/${p.id}`); setDetail(null); load(); }
    catch (e: any) { Alert.alert("Couldn't unpin", e?.response?.data?.detail || "Please try again."); }
  };

  const open = (p: PinItem) => {
    if (p.can_open && p.ref_id) {
      if (p.kind === "competition") return router.push(`/competitions/${p.ref_id}` as any);
      if (p.kind === "event") return router.push({ pathname: "/schedule/new", params: { id: p.ref_id } } as any);
      if (p.kind === "booking") return router.push({ pathname: "/bookings/new", params: { id: p.ref_id, competition_id: p.competition_id || "" } } as any);
    }
    setDetail(p);
  };

  if (items.length === 0 && !canPin) return null;

  return (
    <View style={styles.wrap} testID="chat-pin-items">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {canPin && (
          <TouchableOpacity style={styles.pinBtn} onPress={() => setPicker(true)} testID="chat-pin-item-add">
            <Text style={styles.pinBtnText}>📌 Pin</Text>
          </TouchableOpacity>
        )}
        {items.map((p) => (
          <TouchableOpacity key={p.id} style={styles.card} onPress={() => open(p)} onLongPress={() => setDetail(p)} testID={`chat-pin-item-${p.id}`}>
            <Ionicons name={KIND_META[p.kind].icon} size={15} color={colors.accent} />
            <View style={{ maxWidth: 190 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>{p.title}</Text>
              {!!(whenLine(p) || p.body) && <Text style={styles.cardSub} numberOfLines={1}>{whenLine(p) || p.body}</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Detail (custom details, or items this viewer can't open) */}
      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setDetail(null)}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="chat-pin-item-detail">
            {detail && (
              <>
                <View style={styles.headRow}>
                  <Ionicons name={KIND_META[detail.kind].icon} size={18} color={colors.accent} />
                  <Text style={styles.sheetTitle} numberOfLines={2}>{detail.title}</Text>
                </View>
                {!!whenLine(detail) && <Text style={styles.meta}>{whenLine(detail)}{detail.end_date && detail.end_date !== detail.date ? ` – ${formatDate(detail.end_date)}` : ""}</Text>}
                {!!detail.body && <ScrollView style={{ maxHeight: 280 }}><Text style={styles.body}>{detail.body}</Text></ScrollView>}
                {!!detail.pinned_by_name && <Text style={styles.by}>Pinned by {detail.pinned_by_name}</Text>}
                {detail.can_open && (
                  <TouchableOpacity style={styles.actionRow} onPress={() => { const d = detail; setDetail(null); open({ ...d }); }}>
                    <Ionicons name="open-outline" size={18} color={colors.accent} />
                    <Text style={[styles.actionText, { color: colors.accent }]}>Open</Text>
                  </TouchableOpacity>
                )}
                {canPin && (
                  <TouchableOpacity style={styles.actionRow} onPress={() => unpin(detail)} testID="chat-pin-item-unpin">
                    <Ionicons name="close-circle-outline" size={18} color={colors.textPrimary} />
                    <Text style={styles.actionText}>Unpin</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.actionRow} onPress={() => setDetail(null)}>
                  <Ionicons name="close-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.actionText, { color: colors.textSecondary }]}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Pin picker */}
      <Modal visible={picker} transparent animationType="fade" onRequestClose={closePicker}>
        <Pressable style={styles.modalWrap} onPress={closePicker}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="chat-pin-picker">
            <Text style={styles.sheetTitle}>{kind ? `Pin ${KIND_META[kind].label.toLowerCase()}` : "Pin to this chat"}</Text>
            {!kind ? (
              (Object.keys(KIND_META) as PinKind[]).map((k) => (
                <TouchableOpacity key={k} style={styles.actionRow} onPress={() => chooseKind(k)} testID={`chat-pin-kind-${k}`}>
                  <Ionicons name={KIND_META[k].icon} size={18} color={colors.accent} />
                  <Text style={styles.actionText}>{KIND_META[k].label}</Text>
                </TouchableOpacity>
              ))
            ) : kind === "custom" ? (
              <>
                <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title (e.g. Uniform pickup)" placeholderTextColor={colors.textTertiary} maxLength={120} testID="chat-pin-custom-title" />
                <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} value={body} onChangeText={setBody} placeholder="Details everyone should see" placeholderTextColor={colors.textTertiary} multiline maxLength={2000} testID="chat-pin-custom-body" />
                <TouchableOpacity style={[styles.primary, (!title.trim() || saving) && { opacity: 0.5 }]} disabled={!title.trim() || saving} onPress={() => pin()} testID="chat-pin-custom-save">
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Pin detail</Text>}
                </TouchableOpacity>
              </>
            ) : options === null ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
            ) : options.length === 0 ? (
              <Text style={styles.meta}>Nothing to pin yet — add one in your planner first.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 340 }}>
                {options.map((o) => (
                  <TouchableOpacity key={o.id} style={styles.actionRow} onPress={() => pin(o.id)} disabled={saving} testID={`chat-pin-option-${o.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.actionText} numberOfLines={1}>{o.title}</Text>
                      {!!(o.subtitle || o.date) && <Text style={styles.meta} numberOfLines={1}>{[o.subtitle, whenLine(o)].filter(Boolean).join(" · ")}</Text>}
                    </View>
                    <Ionicons name="pin-outline" size={18} color={colors.accent} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.actionRow} onPress={kind ? () => { setKind(null); setOptions(null); } : closePicker}>
              <Ionicons name={kind ? "arrow-back" : "close-outline"} size={18} color={colors.textSecondary} />
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>{kind ? "Back" : "Cancel"}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => ({
  wrap: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
  row: { gap: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center" as const },
  pinBtn: { paddingHorizontal: 12, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: c.accent, justifyContent: "center" as const },
  pinBtnText: { ...typography.caption, color: c.accent, fontWeight: "800" as const },
  card: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingHorizontal: 12, minHeight: 44, borderRadius: radius.lg, backgroundColor: c.accentSubtle },
  cardTitle: { ...typography.caption, color: c.textPrimary, fontWeight: "800" as const },
  cardSub: { ...typography.micro, color: c.textSecondary },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center" as const, alignItems: "center" as const, padding: spacing.lg },
  sheet: { width: "100%" as const, maxWidth: 420, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg, gap: 6 },
  headRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  sheetTitle: { ...typography.h3, color: c.textPrimary, flexShrink: 1 },
  meta: { ...typography.caption, color: c.textSecondary },
  body: { ...typography.body, color: c.textPrimary, marginTop: 6 },
  by: { ...typography.micro, color: c.textTertiary, marginTop: 6 },
  actionRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.borderSoft },
  actionText: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "600" as const },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, color: c.textPrimary, backgroundColor: c.card, marginTop: 6 },
  primary: { backgroundColor: c.accent, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" as const, marginTop: 10 },
  primaryText: { color: "#fff", fontWeight: "800" as const },
});
