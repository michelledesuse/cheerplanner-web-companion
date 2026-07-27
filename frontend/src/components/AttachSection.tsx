import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";

import { api } from "@/src/api/client";
import FilterChipRow from "@/src/components/FilterChipRow";
import { toggleId } from "@/src/utils/filters";
import { colors, spacing, typography } from "@/src/theme";

type Comp = { id: string; name: string };
type Ev = { id: string; title: string; date?: string | null };
type Props = {
  endpoint: string;            // e.g. /team/payments/<id>
  competitionIds: string[];
  eventIds: string[];
  onChange?: (competitionIds: string[], eventIds: string[]) => void;
};

/** Attach a tool (payment tracker / sign-up sheet / attendance session) to any
 * number of competitions and schedule events. Patches the tool on every tap. */
export default function AttachSection({ endpoint, competitionIds, eventIds, onChange }: Props) {
  const [comps, setComps] = useState<Comp[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [cids, setCids] = useState<string[]>(competitionIds || []);
  const [eids, setEids] = useState<string[]>(eventIds || []);

  useEffect(() => {
    api.get<Comp[]>("/competitions").then((r) => setComps(r.data)).catch(() => {});
    api.get<Ev[]>("/schedule").then((r) => setEvents(r.data)).catch(() => {});
  }, []);

  const evLabel = (e: Ev) => e.date
    ? `${e.title} · ${new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : e.title;

  const patchC = async (next: string[]) => {
    setCids(next); onChange?.(next, eids);
    try { await api.patch(endpoint, { competition_ids: next }); } catch { /* keep optimistic */ }
  };
  const patchE = async (next: string[]) => {
    setEids(next); onChange?.(cids, next);
    try { await api.patch(endpoint, { event_ids: next }); } catch { /* keep optimistic */ }
  };

  if (comps.length === 0 && events.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Attach to</Text>
      <FilterChipRow
        label="Competitions" testIDPrefix="attach-comp" hideAll
        options={comps.map((c) => ({ id: c.id, label: c.name }))}
        selectedIds={cids} onToggle={(id) => patchC(toggleId(cids, id))} onClear={() => patchC([])}
      />
      <FilterChipRow
        label="Schedule events" testIDPrefix="attach-event" hideAll
        options={events.map((e) => ({ id: e.id, label: evLabel(e) }))}
        selectedIds={eids} onToggle={(id) => patchE(toggleId(eids, id))} onClear={() => patchE([])}
      />
      {cids.length === 0 && eids.length === 0 && <Text style={styles.hint}>Tap to attach this to one or more competitions or events.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  header: { ...typography.caption, color: colors.textSecondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  hint: { ...typography.micro, color: colors.textTertiary, marginTop: 2 },
});
