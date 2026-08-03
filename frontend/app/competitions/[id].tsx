import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate, formatDateLong, formatDateTime12, daysBetween } from "@/src/utils/format";
import MapLink from "@/src/components/MapLink";
import PackingListSection from "@/src/components/PackingListSection";
import TodoList from "@/src/components/TodoList";
import LinkedTools from "@/src/components/LinkedTools";
import CompetitionTeamsSection, { TeamMeetTime, TeamToWatch } from "@/src/components/CompetitionTeamsSection";

type Competition = {
  id: string;
  name: string;
  location?: string;
  address?: string;
  event_date: string;
  end_date?: string;
  housing_required: boolean;
  booking_link?: string;
  booking_release_at?: string;
  notes?: string;
  team_ids?: string[];
  team_meet_times?: TeamMeetTime[];
  teams_to_watch?: TeamToWatch[];
  links?: { label: string; url: string }[];
};

type Athlete = { id: string; name: string; avatar_color?: string; competition_ids?: string[] };

type Booking = {
  id: string;
  type: string;
  provider?: string;
  address?: string;
  confirmation?: string;
  cost?: number;
  amount_paid?: number;
  balance_due_date?: string;
  check_in?: string;
  check_out?: string;
  cancel_by?: string;
  pickup_at?: string;
  pickup_location?: string;
  dropoff_at?: string;
  dropoff_location?: string;
  flight_number?: string;
  depart_airport?: string;
  arrive_airport?: string;
  depart_time?: string;
  arrive_time?: string;
  outbound_cost?: number;
  return_airline?: string;
  return_confirmation?: string;
  return_flight_number?: string;
  return_depart_airport?: string;
  return_arrive_airport?: string;
  return_depart_time?: string;
  return_arrive_time?: string;
  return_cost?: number;
  notes?: string;
};

export default function CompetitionDetail() {
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [comp, setComp] = useState<Competition | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingAthlete, setTogglingAthlete] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, b, a] = await Promise.all([
        api.get<Competition>(`/competitions/${id}`),
        api.get<Booking[]>(`/bookings?competition_id=${id}`),
        api.get<Athlete[]>("/athletes"),
      ]);
      setComp(c.data); setBookings(b.data); setAthletes(a.data);
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

  const toggleAthlete = async (a: Athlete) => {
    if (!id) return;
    const current = new Set(a.competition_ids || []);
    if (current.has(id)) current.delete(id); else current.add(id);
    const next = Array.from(current);
    // optimistic
    setAthletes((list) => list.map((x) => x.id === a.id ? { ...x, competition_ids: next } : x));
    setTogglingAthlete(true);
    try {
      await api.patch(`/athletes/${a.id}`, { competition_ids: next });
    } catch (_e) {
      Alert.alert("Error", "Could not update athlete.");
      load();
    } finally {
      setTogglingAthlete(false);
    }
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
        <TouchableOpacity
          onPress={() => router.push({ pathname: "/competitions/new", params: { id: id! } })}
          style={styles.iconBtn}
          testID="comp-edit-btn"
        >
          <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={remove} style={[styles.iconBtn, { marginLeft: 8 }]} testID="comp-delete-btn">
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
            <View style={styles.row}>
              <MapLink
                address={comp.address || comp.location}
                hint={comp.address && comp.location ? comp.location : undefined}
                variant="hero"
                testID="comp-hero-map"
              />
            </View>
          )}
          {!!(comp.address && comp.location) && (
            <View style={[styles.row, { marginTop: -2 }]}>
              <Text style={[styles.heroMeta, { fontSize: 12, opacity: 0.8 }]} numberOfLines={2}>{comp.address}</Text>
            </View>
          )}
          <View style={styles.heroPills}>
            {comp.housing_required && (
              <View style={styles.heroPill}><Text style={styles.heroPillText}>Stay to Play</Text></View>
            )}
            {comp.booking_release_at && (
              <View style={[styles.heroPill, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                <Text style={styles.heroPillText}>Booking opens {formatDateTime12(comp.booking_release_at)}</Text>
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

        <Text style={styles.sectionHead}>Athletes attending</Text>
        {athletes.length === 0 ? (
          <Text style={styles.emptyHint}>No athletes yet. Add one from the Athletes tab.</Text>
        ) : (
          <View style={styles.athleteChips}>
            {athletes.map((a) => {
              const on = (a.competition_ids || []).includes(id!);
              return (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => toggleAthlete(a)}
                  style={[styles.athleteChip, on && styles.athleteChipOn]}
                  testID={`comp-attend-${a.id}`}
                  disabled={togglingAthlete}
                >
                  <View style={[styles.athleteDot, { backgroundColor: a.avatar_color || colors.accent }]}>
                    <Text style={styles.athleteDotText}>{a.name[0]?.toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.athleteChipText, on && styles.athleteChipTextOn]} numberOfLines={1}>
                    {a.name}
                  </Text>
                  {on && <Ionicons name="checkmark-circle" size={16} color="white" />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <CompetitionTeamsSection
          competitionId={id!}
          teamIds={comp.team_ids || []}
          teamMeetTimes={comp.team_meet_times || []}
          teamsToWatch={comp.teams_to_watch || []}
          onChanged={load}
        />

        <Text style={styles.sectionHead}>Travel & accommodations</Text>

        <View style={styles.addTypes}>
          <AddTypeBtn icon="bed" label="Hotel" onPress={() => router.push({ pathname: "/bookings/new", params: { competition_id: id!, type: "hotel" } })} testID="add-hotel-btn" />
          <AddTypeBtn icon="car" label="Car" onPress={() => router.push({ pathname: "/bookings/new", params: { competition_id: id!, type: "car" } })} testID="add-car-btn" />
          <AddTypeBtn icon="airplane" label="Flight" onPress={() => router.push({ pathname: "/bookings/new", params: { competition_id: id!, type: "flight" } })} testID="add-flight-btn" />
        </View>

        {bookings.length === 0 ? (
          <Text style={styles.emptyHint}>No bookings yet. Add a hotel, car or flight above.</Text>
        ) : bookings.map((b) => (
          <BookingCard
            key={b.id}
            booking={b}
            onDelete={() => deleteBooking(b.id)}
            onEdit={() => router.push({ pathname: "/bookings/new", params: { id: b.id } })}
          />
        ))}

        {Array.isArray(comp.links) && comp.links.length > 0 && (
          <>
            <Text style={styles.sectionHead}>Links</Text>
            <View style={styles.linksCard}>
              {comp.links.map((lnk, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.linkRow, i === comp.links!.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => Linking.openURL(lnk.url)}
                  testID={`comp-detail-link-${i}`}
                >
                  <Ionicons name="link-outline" size={18} color={colors.accent} />
                  <Text style={styles.linkRowText} numberOfLines={1}>{lnk.label || lnk.url}</Text>
                  <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {!!comp.notes && (
          <>
            <Text style={styles.sectionHead}>Notes</Text>
            <View style={styles.notesCard}><Text style={styles.notesText}>{comp.notes}</Text></View>
          </>
        )}

        <Text style={styles.sectionHead}>Packing list</Text>
        <PackingListSection competitionId={comp.id} athletes={athletes} />

        <Text style={styles.sectionHead}>To-do list</Text>
        <TodoList scope="competition" refId={comp.id} />
        <LinkedTools competitionId={comp.id} />
      </ScrollView>
    </SafeAreaView>
  );
}

function AddTypeBtn({ icon, label, onPress, testID }: any) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.typeBtn} onPress={onPress} testID={testID} activeOpacity={0.85}>
      <View style={styles.typeIcon}><Ionicons name={icon} size={20} color={colors.accent} /></View>
      <Text style={styles.typeLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function BookingCard({ booking, onDelete, onEdit }: { booking: Booking; onDelete: () => void; onEdit: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const balance = Number(booking.cost || 0) - Number(booking.amount_paid || 0);
  const icon = booking.type === "hotel" ? "bed" : booking.type === "car" ? "car" : "airplane";
  return (
    <View style={styles.bookingCard} testID={`booking-card-${booking.id}`}>
      <View style={styles.bookingHead}>
        <View style={styles.bookingIcon}><Ionicons name={icon as any} size={18} color={colors.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bookingTitle}>{booking.provider || booking.type.charAt(0).toUpperCase() + booking.type.slice(1)}</Text>
          {booking.confirmation && <Text style={styles.bookingMeta}>Conf #{booking.confirmation}</Text>}
          {!!booking.address && (
            <View style={{ marginTop: 4 }}>
              <MapLink
                address={booking.address}
                hint={booking.provider || undefined}
                numberOfLines={2}
                testID={`booking-address-map-${booking.id}`}
              />
            </View>
          )}
        </View>
        <TouchableOpacity onPress={onEdit} hitSlop={10} style={{ marginRight: 12 }} testID={`booking-edit-${booking.id}`}>
          <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
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
      {booking.type === "car" && (booking.pickup_at || booking.pickup_location || booking.dropoff_at || booking.dropoff_location) && (
        <View style={styles.bookingGrid}>
          {booking.pickup_at && <Field label="Pick-up" value={formatDateTime12(booking.pickup_at)} />}
          {booking.pickup_location && (
            <View style={{ width: "100%", marginTop: 8 }}>
              <Text style={{ ...typography.micro, color: colors.textTertiary, letterSpacing: 0.5 }}>PICK-UP LOCATION</Text>
              <View style={{ marginTop: 2 }}>
                <MapLink address={booking.pickup_location} testID={`car-pickup-map-${booking.id}`} />
              </View>
            </View>
          )}
          {booking.dropoff_at && <Field label="Drop-off" value={formatDateTime12(booking.dropoff_at)} />}
          {booking.dropoff_location && (
            <View style={{ width: "100%", marginTop: 8 }}>
              <Text style={{ ...typography.micro, color: colors.textTertiary, letterSpacing: 0.5 }}>DROP-OFF LOCATION</Text>
              <View style={{ marginTop: 2 }}>
                <MapLink address={booking.dropoff_location} testID={`car-dropoff-map-${booking.id}`} />
              </View>
            </View>
          )}
        </View>
      )}
      {booking.type === "flight" && (
        <View style={styles.bookingGrid}>
          {(booking.depart_airport || booking.arrive_airport) && (
            <Field label="Outbound route" value={`${booking.depart_airport || "—"} → ${booking.arrive_airport || "—"}`} />
          )}
          {booking.flight_number && <Field label="Outbound flight #" value={booking.flight_number} />}
          {booking.depart_time && <Field label="Depart" value={formatDateTime12(booking.depart_time)} />}
          {booking.arrive_time && <Field label="Arrive" value={formatDateTime12(booking.arrive_time)} />}
          {booking.outbound_cost != null && <Field label="Outbound cost" value={formatCurrency(booking.outbound_cost)} />}
          {(booking.return_depart_airport || booking.return_arrive_airport || booking.return_airline || booking.return_confirmation || booking.return_flight_number || booking.return_depart_time || booking.return_arrive_time || booking.return_cost != null) && (
            <Field label="—" value="Return" />
          )}
          {booking.return_airline && <Field label="Return airline" value={booking.return_airline} />}
          {booking.return_confirmation && <Field label="Return conf #" value={booking.return_confirmation} />}
          {(booking.return_depart_airport || booking.return_arrive_airport) && (
            <Field label="Return route" value={`${booking.return_depart_airport || "—"} → ${booking.return_arrive_airport || "—"}`} />
          )}
          {booking.return_flight_number && <Field label="Return flight #" value={booking.return_flight_number} />}
          {booking.return_depart_time && <Field label="Return depart" value={formatDateTime12(booking.return_depart_time)} />}
          {booking.return_arrive_time && <Field label="Return arrive" value={formatDateTime12(booking.return_arrive_time)} />}
          {booking.return_cost != null && <Field label="Return cost" value={formatCurrency(booking.return_cost)} />}
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
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.smallLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: "center", marginHorizontal: spacing.md },
  heroCard: { backgroundColor: colors.accent, borderRadius: radius.xl, padding: spacing.xl, alignItems: "flex-start" },
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
  athleteChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  athleteChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.card, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  athleteChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  athleteChipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  athleteChipTextOn: { color: "white" },
  athleteDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  athleteDotText: { color: "white", fontWeight: "800", fontSize: 11 },
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
  linksCard: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  linkRowText: { ...typography.body, color: colors.textPrimary, flex: 1 },
});
