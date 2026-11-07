import React from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { formatCurrency } from "@/src/utils/format";
import DateField from "@/src/components/DateField";
import DateTimeField from "@/src/components/DateTimeField";

export type FlightSegment = {
  id?: string; direction: "outbound" | "return"; airline?: string; confirmation?: string; flight_number?: string;
  depart_airport?: string; depart_time?: string; arrive_airport?: string; arrive_time?: string; passengers: string[];
};
export type FareLeg = {
  passengers?: string; base_fare?: string; taxes_fees?: string; bag_fees?: string; seat_fees?: string;
  amount_paid?: string; paid_on?: string;
};
export type Fare = { outbound: FareLeg; return: FareLeg };

const n = (v?: string | number | null) => { const x = parseFloat(String(v ?? "")); return isNaN(x) ? 0 : x; };
export const legTotal = (l: FareLeg) =>
  Math.max(1, Math.round(n(l.passengers)) || 1) * (n(l.base_fare) + n(l.taxes_fees)) + n(l.bag_fees) + n(l.seat_fees);
const legHasValues = (l: FareLeg) => ["base_fare", "taxes_fees", "bag_fees", "seat_fees", "amount_paid"].some((k) => n((l as any)[k]));

/** Fare (strings, for inputs) from a stored booking. */
export function fareFromBooking(b: any): Fare {
  const f = b?.fare || {};
  const toLeg = (l: any, legacyCost?: number | null, paid?: number | null): FareLeg => {
    const s = (v: any) => (v == null || v === 0 || v === "" ? "" : String(v));
    if (l && Object.keys(l).length) {
      return { passengers: s(l.passengers), base_fare: s(l.base_fare), taxes_fees: s(l.taxes_fees), bag_fees: s(l.bag_fees),
        seat_fees: s(l.seat_fees), amount_paid: s(l.amount_paid), paid_on: l.paid_on || "" };
    }
    return { passengers: legacyCost ? "1" : "", base_fare: s(legacyCost), amount_paid: s(paid) };
  };
  if (f.outbound || f.return) return { outbound: toLeg(f.outbound), return: toLeg(f.return) };
  return { outbound: toLeg(null, b?.outbound_cost ?? (b?.return_cost == null ? b?.cost : null), b?.amount_paid), return: toLeg(null, b?.return_cost) };
}

/** Fare payload for the API (numbers), or null when nothing was entered. */
export function farePayload(f: Fare) {
  const leg = (l: FareLeg) => ({
    passengers: Math.max(1, Math.round(n(l.passengers)) || 1), base_fare: n(l.base_fare), taxes_fees: n(l.taxes_fees),
    bag_fees: n(l.bag_fees), seat_fees: n(l.seat_fees), amount_paid: n(l.amount_paid), paid_on: l.paid_on || null,
  });
  if (!legHasValues(f.outbound) && !legHasValues(f.return)) return null;
  return { outbound: legHasValues(f.outbound) ? leg(f.outbound) : {}, return: legHasValues(f.return) ? leg(f.return) : {} };
}

export function segmentsPayload(segs: FlightSegment[]) {
  return segs
    .map((s) => ({ ...s, depart_airport: s.depart_airport?.trim().toUpperCase(), arrive_airport: s.arrive_airport?.trim().toUpperCase() }))
    .filter((s) => s.airline || s.flight_number || s.depart_airport || s.arrive_airport || s.depart_time);
}

type Props = {
  segments: FlightSegment[];
  onSegments: React.Dispatch<React.SetStateAction<FlightSegment[]>>;
  fare: Fare;
  onFare: React.Dispatch<React.SetStateAction<Fare>>;
  peopleSuggestions: string[];
};

export default function FlightItineraryEditor({ segments, onSegments, fare, onFare, peopleSuggestions }: Props) {
  const styles = useThemedStyles(makeStyles);
  // Functional updates so quick edits to several fields never overwrite each other.
  const update = (idx: number, patch: Partial<FlightSegment>) => onSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const remove = (idx: number) => onSegments((prev) => prev.filter((_, i) => i !== idx));
  const add = (direction: "outbound" | "return") => {
    const same = segments.filter((s) => s.direction === direction);
    const prev = same[same.length - 1];
    onSegments((cur) => [...cur, {
      direction, passengers: prev?.passengers || (segments[0]?.passengers ?? []),
      airline: prev?.airline || segments[0]?.airline || "", confirmation: prev?.confirmation || "",
      depart_airport: prev?.arrive_airport || "",
    }]);
  };
  const setLeg = (d: "outbound" | "return", patch: Partial<FareLeg>) => onFare((prev) => ({ ...prev, [d]: { ...prev[d], ...patch } }));

  const renderDirection = (d: "outbound" | "return") => {
    const list = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.direction === d);
    const leg = fare[d];
    const label = d === "outbound" ? "Departing" : "Returning";
    return (
      <View key={d}>
        <Text style={styles.section}>{label} flights</Text>
        {list.length === 0 && <Text style={styles.helper}>{d === "return" ? "No return flights yet (optional)." : "Add each flight, including connections."}</Text>}
        {list.map(({ s, i }, k) => (
          <View key={i} style={styles.segCard} testID={`seg-${d}-${k}`}>
            <View style={styles.segHead}>
              <Ionicons name="airplane" size={14} color={colors.accent} style={d === "return" ? { transform: [{ scaleX: -1 }] } : undefined} />
              <Text style={styles.segTitle}>{label} flight {k + 1}</Text>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={14} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }} testID={`seg-remove-${d}-${k}`}>
                <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Airline</Text>
                <TextInput style={styles.input} value={s.airline || ""} onChangeText={(v) => update(i, { airline: v })} placeholder="Southwest" placeholderTextColor={colors.textTertiary} testID={`seg-airline-${d}-${k}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Flight #</Text>
                <TextInput style={styles.input} value={s.flight_number || ""} onChangeText={(v) => update(i, { flight_number: v })} placeholder="WN1234" autoCapitalize="characters" placeholderTextColor={colors.textTertiary} testID={`seg-flightno-${d}-${k}`} />
              </View>
            </View>
            <Text style={styles.label}>Confirmation #</Text>
            <TextInput style={styles.input} value={s.confirmation || ""} onChangeText={(v) => update(i, { confirmation: v })} autoCapitalize="characters" placeholderTextColor={colors.textTertiary} testID={`seg-conf-${d}-${k}`} />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>From (airport)</Text>
                <TextInput style={styles.input} value={s.depart_airport || ""} onChangeText={(v) => update(i, { depart_airport: v })} placeholder="LAX" autoCapitalize="characters" maxLength={5} placeholderTextColor={colors.textTertiary} testID={`seg-from-${d}-${k}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>To (airport)</Text>
                <TextInput style={styles.input} value={s.arrive_airport || ""} onChangeText={(v) => update(i, { arrive_airport: v })} placeholder="HOU" autoCapitalize="characters" maxLength={5} placeholderTextColor={colors.textTertiary} testID={`seg-to-${d}-${k}`} />
              </View>
            </View>
            <Text style={styles.label}>Departs</Text>
            <DateTimeField value={s.depart_time || ""} onChange={(v) => update(i, { depart_time: v })} testID={`seg-depart-${d}-${k}`} />
            <Text style={styles.label}>Arrives</Text>
            <DateTimeField value={s.arrive_time || ""} onChange={(v) => update(i, { arrive_time: v })} testID={`seg-arrive-${d}-${k}`} />
            <Text style={styles.label}>Passengers on this flight</Text>
            <PassengerPicker value={s.passengers} onChange={(p) => update(i, { passengers: p })} suggestions={peopleSuggestions} testID={`seg-pax-${d}-${k}`} />
          </View>
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => add(d)} testID={`seg-add-${d}`}>
          <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
          <Text style={styles.addText}>Add {label.toLowerCase()} flight</Text>
        </TouchableOpacity>

        <View style={styles.fareCard} testID={`fare-${d}`}>
          <Text style={styles.fareTitle}>{label} airfare</Text>
          <View style={styles.row2}>
            <Money label="Passengers" value={leg.passengers} onChange={(v) => setLeg(d, { passengers: v.replace(/[^0-9]/g, "") })} placeholder="1" integer testID={`fare-pax-${d}`} />
            <Money label="Base fare (each)" value={leg.base_fare} onChange={(v) => setLeg(d, { base_fare: v })} testID={`fare-base-${d}`} />
          </View>
          <View style={styles.row2}>
            <Money label="Taxes & fees (each)" value={leg.taxes_fees} onChange={(v) => setLeg(d, { taxes_fees: v })} testID={`fare-tax-${d}`} />
            <Money label="Bag fees (total)" value={leg.bag_fees} onChange={(v) => setLeg(d, { bag_fees: v })} testID={`fare-bags-${d}`} />
          </View>
          <View style={styles.row2}>
            <Money label="Seat fees (total)" value={leg.seat_fees} onChange={(v) => setLeg(d, { seat_fees: v })} testID={`fare-seats-${d}`} />
            <Money label="Amount paid" value={leg.amount_paid} onChange={(v) => setLeg(d, { amount_paid: v })} testID={`fare-paid-${d}`} />
          </View>
          <Text style={styles.label}>Paid on</Text>
          <DateField value={leg.paid_on || ""} onChange={(v) => setLeg(d, { paid_on: v })} testID={`fare-paidon-${d}`} />
          <View style={styles.fareTotalRow}>
            <Text style={styles.fareTotalLabel}>{label} total</Text>
            <Text style={styles.fareTotal} testID={`fare-total-${d}`}>{formatCurrency(legHasValues(leg) ? legTotal(leg) : 0)}</Text>
          </View>
        </View>
      </View>
    );
  };

  const total = (legHasValues(fare.outbound) ? legTotal(fare.outbound) : 0) + (legHasValues(fare.return) ? legTotal(fare.return) : 0);
  const paid = n(fare.outbound.amount_paid) + n(fare.return.amount_paid);
  return (
    <View>
      {renderDirection("outbound")}
      {renderDirection("return")}
      <View style={styles.summary} testID="fare-summary">
        <SummaryCell label="TOTAL AIRFARE" value={formatCurrency(total)} />
        <SummaryCell label="PAID" value={formatCurrency(paid)} color={colors.successText} />
        <SummaryCell label="DUE" value={formatCurrency(Math.max(0, total - paid))} color={total - paid > 0 ? colors.accent : colors.successText} />
      </View>
    </View>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function Money({ label, value, onChange, placeholder = "0.00", integer, testID }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; integer?: boolean; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value || ""} onChangeText={onChange} keyboardType={integer ? "number-pad" : "decimal-pad"} placeholder={placeholder} placeholderTextColor={colors.textTertiary} testID={testID} />
    </View>
  );
}

function PassengerPicker({ value, onChange, suggestions, testID }: { value: string[]; onChange: (p: string[]) => void; suggestions: string[]; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  const [draft, setDraft] = React.useState("");
  const addName = (name: string) => {
    const t = name.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const remaining = suggestions.filter((s) => !value.includes(s));
  return (
    <View>
      <View style={styles.chips}>
        {value.map((p) => (
          <TouchableOpacity key={p} style={[styles.chip, styles.chipOn]} onPress={() => onChange(value.filter((x) => x !== p))} testID={`${testID}-on-${p}`}>
            <Text style={styles.chipTextOn}>{p}</Text>
            <Ionicons name="close" size={12} color="white" />
          </TouchableOpacity>
        ))}
        {remaining.map((p) => (
          <TouchableOpacity key={p} style={styles.chip} onPress={() => addName(p)} testID={`${testID}-add-${p}`}>
            <Ionicons name="add" size={12} color={colors.textSecondary} />
            <Text style={styles.chipText}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={[styles.input, { marginTop: 6 }]}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => addName(draft)}
        onBlur={() => draft.trim() && addName(draft)}
        placeholder="Add another name"
        placeholderTextColor={colors.textTertiary}
        returnKeyType="done"
        testID={`${testID}-input`}
      />
    </View>
  );
}

const makeStyles = () => ({
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  helper: { ...typography.caption, color: colors.textTertiary, fontStyle: "italic" as const },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  row2: { flexDirection: "row" as const, gap: spacing.md },
  segCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm, backgroundColor: colors.bg },
  segHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  segTitle: { ...typography.bodyMedium, fontWeight: "800" as const, color: colors.textPrimary, flex: 1 },
  addBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingVertical: 12, minHeight: 44 },
  addText: { color: colors.accent, fontWeight: "700" as const },
  fareCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  fareTitle: { ...typography.bodyMedium, fontWeight: "800" as const, color: colors.textPrimary },
  fareTotalRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  fareTotalLabel: { ...typography.caption, fontWeight: "700" as const, color: colors.textSecondary },
  fareTotal: { ...typography.bodyMedium, fontWeight: "800" as const, color: colors.textPrimary },
  summary: { flexDirection: "row" as const, marginTop: spacing.lg, backgroundColor: colors.accentSubtle, borderRadius: radius.lg, padding: spacing.md },
  sumLabel: { ...typography.micro, color: colors.textSecondary, marginBottom: 4 },
  sumValue: { ...typography.bodyMedium, fontWeight: "800" as const, color: colors.textPrimary },
  chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
  chip: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, fontWeight: "700" as const, color: colors.textSecondary },
  chipTextOn: { ...typography.caption, fontWeight: "700" as const, color: "white" },
});
