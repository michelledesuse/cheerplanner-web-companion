import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Kind = "calendar" | "expense" | "fundraiser" | "competition" | "packing" | "watch";
type Suggestions = Partial<Record<Kind, any>>;

const META: Record<Kind, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  calendar: { label: "Calendar", icon: "calendar-outline" },
  expense: { label: "Expenses", icon: "card-outline" },
  fundraiser: { label: "Fundraisers", icon: "heart-outline" },
  competition: { label: "Competitions", icon: "trophy-outline" },
  packing: { label: "Packing List", icon: "bag-handle-outline" },
  watch: { label: "Watch List", icon: "eye-outline" },
};
const ORDER: Kind[] = ["calendar", "expense", "fundraiser", "competition", "packing", "watch"];
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => (v && !isNaN(Number(v)) ? Number(v) : null);
const str = (v: any) => (v === null || v === undefined ? "" : String(v));

/** "Add to…" for one chat message: the AI suggests what it could become in the
 *  reader's own planner; the user reviews a short form and saves. */
export default function ChatQuickAdd({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const [sugg, setSugg] = useState<Suggestions | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [athletes, setAthletes] = useState<{ id: string; name: string }[]>([]);
  const [comps, setComps] = useState<{ id: string; name: string; event_date?: string; teams_to_watch?: any[] }[]>([]);
  const [pickId, setPickId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!messageId) return;
    setSugg(null); setKind(null);
    api.post<{ suggestions: Suggestions }>(`/team/chat/messages/${messageId}/quick-add`)
      .then((r) => setSugg(r.data.suggestions || {}))
      .catch((e) => { Alert.alert("Couldn't read message", e?.response?.data?.detail || "Please try again."); onClose(); });
  }, [messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const choose = async (k: Kind) => {
    const s = (sugg && sugg[k]) || {};
    setKind(k);
    setPickId("");
    if (k === "calendar") setForm({ title: str(s.title), date: str(s.date), start_time: str(s.start_time), end_time: str(s.end_time), location: str(s.location), notes: str(s.notes) });
    if (k === "expense") setForm({ category: str(s.category) || "Other", amount: str(s.amount), due_date: str(s.due_date), note: str(s.note) });
    if (k === "fundraiser") setForm({ name: str(s.name), goal_amount: str(s.goal_amount), amount_raised: str(s.amount_raised), date: str(s.date) || today(), link_url: str(s.link_url), note: str(s.note) });
    if (k === "competition") setForm({ name: str(s.name), event_date: str(s.event_date), end_date: str(s.end_date), location: str(s.location), event_time: str(s.event_time) });
    if (k === "packing") setForm({ items: (s.items || []).join("\n") });
    if (k === "watch") setForm({ teams: (s.teams || []).map((t: any) => (t.performance_time ? `${t.name} @ ${t.performance_time}` : t.name)).join("\n") });
    if (k === "expense" || k === "fundraiser") {
      try { const r = await api.get("/athletes"); setAthletes(r.data || []); if ((r.data || []).length === 1) setPickId(r.data[0].id); } catch { setAthletes([]); }
    }
    if (k === "packing" || k === "watch") {
      try {
        const r = await api.get("/competitions");
        const list = (r.data || []).sort((a: any, b: any) => (a.event_date || "").localeCompare(b.event_date || ""));
        setComps(list);
        const hint = String(s.competition_name || "").toLowerCase();
        const match = hint && list.find((c: any) => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase()));
        const upcoming = list.find((c: any) => (c.event_date || "") >= today());
        setPickId((match || upcoming || list[0] || {}).id || "");
      } catch { setComps([]); }
    }
  };

  const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

  const save = async () => {
    if (!kind) return;
    setSaving(true);
    try {
      if (kind === "calendar") {
        if (!form.title.trim() || !form.date) throw new Error("Add a title and date.");
        await api.post("/schedule", { title: form.title.trim(), date: form.date, event_type: "other", start_time: form.start_time || null, end_time: form.end_time || null, location: form.location || null, notes: form.notes || null });
      } else if (kind === "expense") {
        if (!pickId) throw new Error("Choose an athlete.");
        if (num(form.amount) === null) throw new Error("Add an amount.");
        await api.post("/expenses", { athlete_id: pickId, category: form.category || "Other", amount: num(form.amount), incurred_on: today(), due_date: form.due_date || null, note: form.note || null });
      } else if (kind === "fundraiser") {
        if (!form.name.trim()) throw new Error("Add a name.");
        await api.post("/fundraisers", { name: form.name.trim(), athlete_id: pickId || null, raised_on: form.date || today(), amount_raised: num(form.amount_raised) || 0, goal_amount: num(form.goal_amount), link_url: form.link_url || null, note: form.note || null });
      } else if (kind === "competition") {
        if (!form.name.trim() || !form.event_date) throw new Error("Add a name and date.");
        await api.post("/competitions", { name: form.name.trim(), event_date: form.event_date, end_date: form.end_date || null, location: form.location || null, event_time: form.event_time || null });
      } else if (kind === "packing") {
        if (!pickId) throw new Error("Choose a competition.");
        const add = lines(form.items);
        if (!add.length) throw new Error("Add at least one item.");
        const r = await api.get(`/competitions/${pickId}/packing-list`);
        const existing = r.data?.items || [];
        const have = new Set(existing.map((i: any) => String(i.label).toLowerCase()));
        const fresh = add.filter((l) => !have.has(l.toLowerCase())).map((label, i) => ({ label, category: "Other", order: existing.length + i }));
        if (r.data?.id) await api.patch(`/packing-lists/${r.data.id}`, { items: [...existing, ...fresh] });
        else await api.post(`/competitions/${pickId}/packing-list`, { items: fresh });
      } else if (kind === "watch") {
        if (!pickId) throw new Error("Choose a competition.");
        const add = lines(form.teams).map((l) => {
          const [name, time] = l.split("@").map((x) => x.trim());
          return { name, performance_time: /^\d{1,2}:\d{2}$/.test(time || "") ? time : null };
        });
        if (!add.length) throw new Error("Add at least one team.");
        const c = (await api.get(`/competitions/${pickId}`)).data;
        const existing = c?.teams_to_watch || [];
        const have = new Set(existing.map((t: any) => String(t.name).toLowerCase()));
        await api.patch(`/competitions/${pickId}`, { teams_to_watch: [...existing, ...add.filter((t) => !have.has(t.name.toLowerCase()))] });
      }
      Alert.alert("Added", `Saved to your ${META[kind].label}.`);
      onClose();
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.response?.data?.detail || e?.message || "Please try again.");
    } finally { setSaving(false); }
  };

  const available = ORDER.filter((k) => sugg && sugg[k]);
  const F = (k: string, label: string, opts: { multiline?: boolean; keyboard?: any; placeholder?: string } = {}) => (
    <View key={k}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, opts.multiline && { minHeight: 80, textAlignVertical: "top" }]}
        value={form[k] || ""} onChangeText={set(k)} multiline={opts.multiline} keyboardType={opts.keyboard}
        placeholder={opts.placeholder} placeholderTextColor={colors.textTertiary} testID={`quickadd-field-${k}`}
      />
    </View>
  );
  const Chips = ({ list }: { list: { id: string; name: string }[] }) => (
    <View style={styles.chips}>
      {list.map((o) => (
        <TouchableOpacity key={o.id} style={[styles.chip, pickId === o.id && styles.chipOn]} onPress={() => setPickId(o.id)} testID={`quickadd-pick-${o.id}`}>
          <Text style={[styles.chipText, pickId === o.id && { color: "#fff" }]}>{o.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <Modal visible={!!messageId} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}} testID="chat-quickadd-sheet">
          <Text style={styles.title}>{kind ? `Add to ${META[kind].label}` : "Add to…"}</Text>
          {sugg === null ? (
            <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.meta}>Reading message…</Text></View>
          ) : !kind ? (
            available.length === 0 ? (
              <Text style={[styles.meta, { paddingVertical: 12 }]} testID="quickadd-none">Nothing to add from this message.</Text>
            ) : available.map((k) => (
              <TouchableOpacity key={k} style={styles.row} onPress={() => choose(k)} testID={`quickadd-${k}`}>
                <Ionicons name={META[k].icon} size={18} color={colors.accent} />
                <Text style={styles.rowText}>{META[k].label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} style={{ marginLeft: "auto" }} />
              </TouchableOpacity>
            ))
          ) : (
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {kind === "calendar" && [F("title", "Title"), F("date", "Date (YYYY-MM-DD)"), F("start_time", "Start time (HH:MM, 24h)"), F("end_time", "End time (HH:MM, 24h)"), F("location", "Location"), F("notes", "Notes", { multiline: true })]}
              {kind === "expense" && (<>
                <Text style={styles.label}>Athlete</Text><Chips list={athletes} />
                {[F("category", "Category"), F("amount", "Amount ($)", { keyboard: "decimal-pad" }), F("due_date", "Due date (YYYY-MM-DD)"), F("note", "Note")]}
              </>)}
              {kind === "fundraiser" && (<>
                {F("name", "Fundraiser name")}
                {athletes.length > 0 && (<><Text style={styles.label}>Athlete (optional)</Text><Chips list={athletes} /></>)}
                {[F("goal_amount", "Goal ($)", { keyboard: "decimal-pad" }), F("amount_raised", "Raised so far ($)", { keyboard: "decimal-pad" }), F("date", "Date (YYYY-MM-DD)"), F("link_url", "Link"), F("note", "Note")]}
              </>)}
              {kind === "competition" && [F("name", "Competition name"), F("event_date", "Start date (YYYY-MM-DD)"), F("end_date", "End date (YYYY-MM-DD)"), F("location", "Venue"), F("event_time", "Performance time (HH:MM, 24h)")]}
              {(kind === "packing" || kind === "watch") && (<>
                <Text style={styles.label}>Competition</Text>
                {comps.length === 0 ? <Text style={styles.meta}>Add a competition first.</Text> : <Chips list={comps} />}
                {kind === "packing"
                  ? F("items", "Items (one per line)", { multiline: true })
                  : F("teams", "Teams (one per line, optional “@ 14:30”)", { multiline: true })}
              </>)}
              <TouchableOpacity style={[styles.primary, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="quickadd-save">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
              </TouchableOpacity>
            </ScrollView>
          )}
          <TouchableOpacity style={styles.row} onPress={kind ? () => setKind(null) : onClose} testID="quickadd-back">
            <Ionicons name={kind ? "arrow-back" : "close-outline"} size={18} color={colors.textSecondary} />
            <Text style={[styles.rowText, { color: colors.textSecondary }]}>{kind ? "Back" : "Cancel"}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemePalette) => ({
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center" as const, alignItems: "center" as const, padding: spacing.lg },
  sheet: { width: "100%" as const, maxWidth: 420, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg, gap: 4 },
  title: { ...typography.h3, color: c.textPrimary, marginBottom: 4 },
  center: { alignItems: "center" as const, gap: 8, paddingVertical: 20 },
  meta: { ...typography.caption, color: c.textSecondary },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.borderSoft },
  rowText: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "600" as const },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700" as const, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, color: c.textPrimary, backgroundColor: c.card },
  chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { ...typography.caption, color: c.textPrimary, fontWeight: "700" as const },
  primary: { backgroundColor: c.accent, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" as const, marginTop: 16, marginBottom: 6 },
  primaryText: { color: "#fff", fontWeight: "800" as const },
});
