import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate } from "@/src/utils/format";

export type TravelBooking = {
  id: string; type: "flight" | "hotel" | "car"; competition_id: string; provider?: string | null;
  cost?: number | null; amount_paid?: number | null; balance_due_date?: string | null;
  depart_time?: string | null; check_in?: string | null; pickup_at?: string | null;
};

export const travelDate = (b: TravelBooking) => String(b.depart_time || b.check_in || b.pickup_at || "").slice(0, 10);
export const travelBalance = (b: TravelBooking) => Math.max(0, Number(b.cost || 0) - Number(b.amount_paid || 0));

const ICON: Record<string, any> = { flight: "airplane", hotel: "bed", car: "car" };
const LABEL: Record<string, string> = { flight: "Flight", hotel: "Hotel", car: "Rental car" };

export default function TravelExpenseRow({ booking, compName, onPress }: { booking: TravelBooking; compName?: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const bal = travelBalance(booking);
  const isPaid = Number(booking.cost || 0) > 0 && bal <= 0.001;
  const d = travelDate(booking);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.row} testID={`travel-row-${booking.id}`}>
      <View style={styles.icon}><Ionicons name={ICON[booking.type] || "briefcase"} size={16} color={colors.accent} /></View>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.title} numberOfLines={1}>{booking.provider || LABEL[booking.type]}</Text>
          <View style={styles.tag}><Text style={styles.tagText}>TRAVEL · {LABEL[booking.type]?.toUpperCase()}</Text></View>
        </View>
        <Text style={styles.meta} numberOfLines={1}>{[compName, d ? formatDate(d) : null].filter(Boolean).join(" • ")}</Text>
        {!isPaid && Number(booking.amount_paid || 0) > 0 && (
          <Text style={styles.meta}>{formatCurrency(booking.amount_paid || 0)} paid of {formatCurrency(booking.cost || 0)}</Text>
        )}
      </View>
      {isPaid ? (
        <Text style={[styles.amount, { color: colors.successText, textDecorationLine: "line-through" }]}>{formatCurrency(booking.cost || 0)}</Text>
      ) : (
        <Text style={styles.amount}>{formatCurrency(bal)}</Text>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemePalette) => ({
  row: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, marginBottom: 8 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: c.accentSubtle },
  title: { ...typography.bodyMedium, color: c.textPrimary, flexShrink: 1 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: c.accentSubtle },
  tagText: { fontSize: 9, fontWeight: "800", color: c.accent, letterSpacing: 0.4 },
  meta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  amount: { ...typography.h3, color: c.textPrimary },
});
