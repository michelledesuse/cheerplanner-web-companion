import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate, formatDateTime12 } from "@/src/utils/format";

type Seg = { id?: string; direction: string; airline?: string; confirmation?: string; flight_number?: string; depart_airport?: string; depart_time?: string; arrive_airport?: string; arrive_time?: string; passengers?: string[] };
type Leg = { passengers?: number; base_fare?: number; taxes_fees?: number; bag_fees?: number; seat_fees?: number; amount_paid?: number; paid_on?: string };

const n = (v?: number | null) => Number(v || 0);
const legTotal = (l: Leg) => Math.max(1, n(l.passengers) || 1) * (n(l.base_fare) + n(l.taxes_fees)) + n(l.bag_fees) + n(l.seat_fees);
const hasLeg = (l?: Leg | null) => !!l && ["base_fare", "taxes_fees", "bag_fees", "seat_fees", "amount_paid"].some((k) => n((l as any)[k]));

/** Flight card body: every segment in time order with passengers, plus the airfare breakdown. */
export default function FlightCardBody({ booking, showCosts }: { booking: { segments?: Seg[]; fare?: Record<string, Leg> | null }; showCosts: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const segs = [...(booking.segments || [])].sort((a, b) => String(a.depart_time || "9999").localeCompare(String(b.depart_time || "9999")));
  const fare = booking.fare || {};
  return (
    <View style={{ marginTop: spacing.sm, gap: 8 }}>
      {segs.map((s, i) => (
        <View key={s.id || i} style={styles.seg} testID={`flight-seg-${i}`}>
          <View style={styles.segHead}>
            <Ionicons name="airplane" size={13} color={colors.accent} />
            <Text style={styles.route}>{s.depart_airport || "—"} → {s.arrive_airport || "—"}</Text>
            <Text style={styles.dir}>{s.direction === "return" ? "RETURN" : "DEPART"}</Text>
          </View>
          <Text style={styles.meta}>{[[s.airline, s.flight_number].filter(Boolean).join(" "), s.confirmation ? `Conf #${s.confirmation}` : null].filter(Boolean).join(" · ")}</Text>
          {(s.depart_time || s.arrive_time) && (
            <Text style={styles.meta}>
              {s.depart_time ? `Departs ${formatDateTime12(s.depart_time)}` : ""}{s.depart_time && s.arrive_time ? "  ·  " : ""}{s.arrive_time ? `Arrives ${formatDateTime12(s.arrive_time)}` : ""}
            </Text>
          )}
          {!!s.passengers?.length && (
            <View style={styles.paxRow}>
              <Ionicons name="people-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.pax}>{s.passengers.join(", ")}</Text>
            </View>
          )}
        </View>
      ))}
      {showCosts && (["outbound", "return"] as const).filter((d) => hasLeg(fare[d])).map((d) => {
        const l = fare[d];
        const pax = Math.max(1, n(l.passengers) || 1);
        return (
          <View key={d} style={styles.fare} testID={`flight-fare-${d}`}>
            <Text style={styles.fareTitle}>{d === "outbound" ? "Departing" : "Returning"} airfare · {formatCurrency(legTotal(l))}</Text>
            <Text style={styles.meta}>
              {[`${pax} × (${formatCurrency(n(l.base_fare))} fare + ${formatCurrency(n(l.taxes_fees))} taxes)`,
                n(l.bag_fees) ? `${formatCurrency(n(l.bag_fees))} bags` : null,
                n(l.seat_fees) ? `${formatCurrency(n(l.seat_fees))} seats` : null].filter(Boolean).join(" + ")}
            </Text>
            {n(l.amount_paid) > 0 && <Text style={styles.paid}>Paid {formatCurrency(n(l.amount_paid))}{l.paid_on ? ` on ${formatDate(l.paid_on)}` : ""}</Text>}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = () => ({
  seg: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm, paddingVertical: 2 },
  segHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  route: { ...typography.bodyMedium, fontWeight: "800" as const, color: colors.textPrimary, flex: 1 },
  dir: { fontSize: 9, fontWeight: "800" as const, color: colors.accent, letterSpacing: 0.5 },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  paxRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginTop: 2 },
  pax: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" as const },
  fare: { backgroundColor: colors.accentSubtle, borderRadius: radius.md, padding: spacing.sm },
  fareTitle: { ...typography.caption, fontWeight: "800" as const, color: colors.textPrimary },
  paid: { ...typography.caption, color: colors.successText, fontWeight: "700" as const, marginTop: 2 },
});
