import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatCurrency, formatDate, formatDateLong, daysBetween } from "@/src/utils/format";

type Competition = {
  id: string;
  name: string;
  location?: string;
  event_date: string;
  end_date?: string;
  housing_required: boolean;
  booking_link?: string;
  booking_release_at?: string;
  notes?: string;
};

type Booking = {
  id: string;
  type: string;
  provider?: string;
  confirmation?: string;
  cost?: number;
  amount_paid?: number;
  balance_due_date?: string;
  check_in?: string;
  check_out?: string;
  cancel_by?: string;
  flight_number?: string;
  depart_time?: string;
  arrive_time?: string;
  return_flight_number?: string;
  return_depart_time?: string;
  return_arrive_time?: string;
  notes?: string;
};

export default function CompetitionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [comp, setComp] = useState<Competition | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, b] = await Promise.all([
        api.get<Competition>(`/competitions/${id}`),
        api.get<Booking[]>(`/bookings?competition_id=${id}`),
      ]);
      setComp(c.data); setBookings(b.data);
    } catch (e) {}
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = () => {
    Alert.alert("Delete competition?", "All bookings will be removed too.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await api.delete(`/competitions/${id}`); router.back();
      }},
    ]);
  };
  const deleteBooking = async (bid: string) => {
    await api.delete(`/bookings/${bid}`); load();
  };

  if (loading || !comp) {
    return <SafeAreaView style={styles.safe}><View style={styles.centered}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  const days = daysBetween(comp.event_date);
  const totalCost = bookings.reduce((s, b) => s + Number(b.cost || 0), 0);
  const totalPaid = bookings.reduce((s, b) => s + Number(b.amount_paid || 0), 0);
  const balance = totalCost - totalPaid;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="comp-detail-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{comp.name}</Text>
        <TouchableOpacity onPress={remove} style={styles.iconBtn} testID="comp-delete-btn">
          <Ionicons name="trash-outline" size={20} color={colors.dangerText} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroDays}>{days !== null && days >= 0 ? days : "—"}</Text>
          <Text style={styles.heroDaysLabel}>{days !== null && days >= 0 ? "days to go" : "Past event"}</Text>
          <Text style={styles.heroDate}>{formatDateLong(comp.event_date)}</Text>
          {!!comp.location && (
            <View style={styles.row}><Ionicons name="location" size={14} color="rgba(255,255,255,0.7)" />
              <Text style={styles.heroMeta}>{comp.location}</Text></View>
          )}
          <View style={styles.heroPills}>
            {comp.housing_required && (
              <View style={styles.heroPill}><Text style={styles.heroPillText}>Stay to Play</Text></View>
            )}
            {comp.booking_release_at && (
              <View style={[styles.heroPill, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                <Text style={styles.heroPillText}>Booking opens {formatDate(comp.booking_release_at)}</Text>
              </View>
            )}
          </View>
          {!!comp.booking_link && (
            <TouchableOpacity style={styles.linkBtn} onPress={() => Linking.openURL(comp.booking_link!)} testID="comp-booking-link">
              <Ionicons name="link" size={14} color="white" />
              <Text style={styles.linkBtnText}>Open booking link</Text>
            </TouchableOpacity>
          )}
        </View>

        {bookings.length > 0 && (
          <View style={styles.balanceCard}>
            <View>
              <Text style={styles.smallLabel}>TRAVEL BUDGET</Text>
              <Text style={styles.balanceMain}>{formatCurrency(totalCost)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.smallLabel}>BALANCE DUE</Text>
              <Text style={[styles.balanceMain, { color: balance > 0 ? colors.accent : colors.successText }]}>{formatCurrency(Math.max(balance, 0))}</Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionHead}>Travel & accommodations</Text>

        <View style={styles.addTypes}>
          <AddTypeBtn icon="bed" label="Hotel" onPress={() => router.push({ pathname: "/bookings/new", params: { competition_id: id!, type: "hotel" } })} testID="add-hotel-btn" />
          <AddTypeBtn icon="car" label="Car" onPress={() => router.push({ pathname: "/bookings/new", params: { competition_id: id!, type: "car" } })} testID="add-car-btn" />
          <AddTypeBtn icon="airplane" label="Flight" onPress={() => router.push({ pathname: "/bookings/new", params: { competition_id: id!, type: "flight" } })} testID="add-flight-btn" />
        </View>

        {bookings.length === 0 ? (
          <Text style={styles.emptyHint}>No bookings yet. Add a hotel, car or flight above.</Text>
        ) : bookings.map((b) => (
          <BookingCard key={b.id} booking={b} onDelete={() => deleteBooking(b.id)} />
        ))}

        {!!comp.notes && (
          <>
            <Text style={styles.sectionHead}>Notes</Text>
            <View style={styles.notesCard}><Text style={styles.notesText}>{comp.notes}</Text></View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AddTypeBtn({ icon, label, onPress, testID }: any) {
  return (
    <TouchableOpacity style={styles.typeBtn} onPress={onPress} testID={testID} activeOpacity={0.85}>
      <View style={styles.typeIcon}><Ionicons name={icon} size={20} color={colors.accent} /></View>
      <Text style={styles.typeLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function BookingCard({ booking, onDelete }: { booking: Booking; onDelete: () => void }) {
  const balance = Number(booking.cost || 0) - Number(booking.amount_paid || 0);
  const icon = booking.type === "hotel" ? "bed" : booking.type === "car" ? "car" : "airplane";
  return (
    <View style={styles.bookingCard} testID={`booking-card-${booking.id}`}>
      <View style={styles.bookingHead}>
        <View style={styles.bookingIcon}><Ionicons name={icon as any} size={18} color={colors.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bookingTitle}>{booking.provider || booking.type.charAt(0).toUpperCase() + booking.type.slice(1)}</Text>
          {booking.confirmation && <Text style={styles.bookingMeta}>Conf #{booking.confirmation}</Text>}
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={10}>
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>

      {booking.type === "hotel" && (
        <View style={styles.bookingGrid}>
          <Field label="Check-in" value={formatDate(booking.check_in)} />
          <Field label="Check-out" value={formatDate(booking.check_out)} />
          {booking.cancel_by && <Field label="Free cancel by" value={formatDate(booking.cancel_by)} />}
        </View>
      )}
      {booking.type === "flight" && (
        <View style={styles.bookingGrid}>
          {booking.flight_number && <Field label="Flight #" value={booking.flight_number} />}
          {booking.depart_time && <Field label="Depart" value={booking.depart_time} />}
          {booking.arrive_time && <Field label="Arrive" value={booking.arrive_time} />}
          {booking.return_flight_number && <Field label="Return #" value={booking.return_flight_number} />}
        </View>
      )}

      <View style={styles.bookingFinances}>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallLabel}>COST</Text>
          <Text style={styles.bookingAmount}>{formatCurrency(booking.cost || 0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallLabel}>PAID</Text>
          <Text style={[styles.bookingAmount, { color: colors.successText }]}>{formatCurrency(booking.amount_paid || 0)}</Text>
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={styles.smallLabel}>BALANCE</Text>
          <Text style={[styles.bookingAmount, { color: balance > 0 ? colors.accent : colors.successText }]}>{formatCurrency(Math.max(balance, 0))}</Text>
        </View>
      </View>
      {booking.balance_due_date && balance > 0 && (
        <View style={styles.dueRow}>
          <Ionicons name="time-outline" size={12} color={colors.warningText} />
          <Text style={styles.dueText}>Balance due {formatDate(booking.balance_due_date, { withYear: true })}</Text>
        </View>
      )}
      {booking.notes && <Text style={styles.bookingNotes}>{booking.notes}</Text>}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.smallLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: "center", marginHorizontal: spacing.md },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.xl, alignItems: "flex-start" },
  heroDays: { color: colors.accent, fontSize: 64, fontWeight: "800", letterSpacing: -2, lineHeight: 64 },
  heroDaysLabel: { color: "rgba(255,255,255,0.65)", ...typography.caption, marginTop: 2, marginBottom: spacing.md },
  heroDate: { color: "white", ...typography.h3 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  heroMeta: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  heroPills: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: spacing.md },
  heroPill: { backgroundColor: colors.accent, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  heroPillText: { color: "white", fontWeight: "700", fontSize: 11, letterSpacing: 0.3 },
  linkBtn: { marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  linkBtnText: { color: "white", fontWeight: "700" },
  balanceCard: { marginTop: spacing.md, flexDirection: "row", justifyContent: "space-between", padding: spacing.lg, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  smallLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  balanceMain: { ...typography.h2, color: colors.textPrimary, marginTop: 2 },
  sectionHead: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.md },
  addTypes: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  typeBtn: { flex: 1, paddingVertical: spacing.lg, alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  typeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSubtle, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  typeLabel: { ...typography.caption, color: colors.textPrimary, fontWeight: "700" },
  emptyHint: { ...typography.body, color: colors.textTertiary, textAlign: "center", marginTop: spacing.lg },
  bookingCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  bookingHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  bookingIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSubtle, alignItems: "center", justifyContent: "center" },
  bookingTitle: { ...typography.h3, color: colors.textPrimary },
  bookingMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  bookingGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.md },
  field: { minWidth: 100 },
  fieldValue: { ...typography.bodyMedium, color: colors.textPrimary, marginTop: 2 },
  bookingFinances: { flexDirection: "row", paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft, gap: spacing.md },
  bookingAmount: { ...typography.h3, marginTop: 2 },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.md, backgroundColor: colors.warningBg, padding: 8, borderRadius: 8, alignSelf: "flex-start" },
  dueText: { color: colors.warningText, fontWeight: "700", fontSize: 12 },
  bookingNotes: { marginTop: spacing.md, ...typography.caption, color: colors.textSecondary },
  notesCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  notesText: { ...typography.body, color: colors.textPrimary },
});
