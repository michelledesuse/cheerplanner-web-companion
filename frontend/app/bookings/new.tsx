import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import DateField from "@/src/components/DateField";
import DateTimeField from "@/src/components/DateTimeField";
import SmsReminderPicker from "@/src/components/SmsReminderPicker";
import TimeField from "@/src/components/TimeField";

export default function BookingForm() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ competition_id?: string; type?: string; id?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  const [type, setType] = useState<"hotel" | "car" | "flight">(((params.type as any) || "hotel"));
  const [competitionId, setCompetitionId] = useState(params.competition_id || "");

  const [provider, setProvider] = useState("");
  const [address, setAddress] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [cost, setCost] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [balanceDueDate, setBalanceDueDate] = useState("");
  const [notes, setNotes] = useState("");
  // hotel
  const [checkIn, setCheckIn] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [cancelBy, setCancelBy] = useState("");
  // car
  const [pickupAt, setPickupAt] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [dropoffAt, setDropoffAt] = useState("");
  const [dropoffLocation, setDropoffLocation] = useState("");
  // flight - outbound
  const [flightNumber, setFlightNumber] = useState("");
  const [departAirport, setDepartAirport] = useState("");
  const [arriveAirport, setArriveAirport] = useState("");
  const [departTime, setDepartTime] = useState("");
  const [arriveTime, setArriveTime] = useState("");
  const [outboundCost, setOutboundCost] = useState("");
  // flight - return
  const [returnAirline, setReturnAirline] = useState("");
  const [returnConfirmation, setReturnConfirmation] = useState("");
  const [returnFlightNumber, setReturnFlightNumber] = useState("");
  const [returnDepartAirport, setReturnDepartAirport] = useState("");
  const [returnArriveAirport, setReturnArriveAirport] = useState("");
  const [returnDepartTime, setReturnDepartTime] = useState("");
  const [returnArriveTime, setReturnArriveTime] = useState("");
  const [returnCost, setReturnCost] = useState("");
  const [smsOffsets, setSmsOffsets] = useState<number[]>([]);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const TITLE: Record<string, string> = { hotel: "Hotel", car: "Rental car", flight: "Flight" };
  const PROVIDER_LABEL: Record<string, string> = { hotel: "Hotel name", car: "Rental company", flight: "Outbound airline" };

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const res = await api.get("/bookings");
        const list: any[] = res.data;
        const b = list.find((x) => x.id === editingId);
        if (!b) {
          Alert.alert("Not found", "This booking no longer exists.");
          router.back();
          return;
        }
        setType(b.type);
        setCompetitionId(b.competition_id);
        setProvider(b.provider || "");
        setAddress(b.address || "");
        setConfirmation(b.confirmation || "");
        setCost(b.cost != null ? String(b.cost) : "");
        setAmountPaid(b.amount_paid != null ? String(b.amount_paid) : "");
        setBalanceDueDate(b.balance_due_date || "");
        setNotes(b.notes || "");
        setCheckIn(b.check_in || "");
        setCheckInTime(b.check_in_time || "");
        setCheckOut(b.check_out || "");
        setCheckOutTime(b.check_out_time || "");
        setCancelBy(b.cancel_by || "");
        setPickupAt(b.pickup_at || "");
        setPickupLocation(b.pickup_location || "");
        setDropoffAt(b.dropoff_at || "");
        setDropoffLocation(b.dropoff_location || "");
        setFlightNumber(b.flight_number || "");
        setDepartAirport(b.depart_airport || "");
        setArriveAirport(b.arrive_airport || "");
        setDepartTime(b.depart_time || "");
        setArriveTime(b.arrive_time || "");
        setOutboundCost(b.outbound_cost != null ? String(b.outbound_cost) : "");
        setReturnAirline(b.return_airline || "");
        setReturnConfirmation(b.return_confirmation || "");
        setReturnFlightNumber(b.return_flight_number || "");
        setReturnDepartAirport(b.return_depart_airport || "");
        setReturnArriveAirport(b.return_arrive_airport || "");
        setReturnDepartTime(b.return_depart_time || "");
        setReturnArriveTime(b.return_arrive_time || "");
        setReturnCost(b.return_cost != null ? String(b.return_cost) : "");
        setSmsOffsets(Array.isArray(b.sms_reminder_offsets) ? b.sms_reminder_offsets : []);
      } catch (_e) {
        Alert.alert("Error", "Could not load booking");
      } finally {
        setLoading(false);
      }
    })();
  }, [editingId, isEdit, router]);

  const save = async () => {
    setSaving(true);
    try {
      // For flights, the total cost is computed from the two legs (so the
      // existing balance/total displays continue to work). For other types
      // the user still enters a single cost.
      const flightOb = parseFloat(outboundCost) || 0;
      const flightRt = parseFloat(returnCost) || 0;
      const flightTotal = flightOb + flightRt;

      const payload: any = {
        provider: provider.trim() || null,
        address: address.trim() || null,
        confirmation: confirmation.trim() || null,
        cost: type === "flight" ? (flightTotal || parseFloat(cost) || 0) : (parseFloat(cost) || 0),
        amount_paid: parseFloat(amountPaid) || 0,
        balance_due_date: balanceDueDate || null,
        notes: notes.trim() || null,
        check_in: type === "hotel" ? (checkIn || null) : null,
        check_in_time: type === "hotel" ? (checkInTime || null) : null,
        check_out: type === "hotel" ? (checkOut || null) : null,
        check_out_time: type === "hotel" ? (checkOutTime || null) : null,
        cancel_by: type === "hotel" ? (cancelBy || null) : null,
        pickup_at: type === "car" ? (pickupAt || null) : null,
        pickup_location: type === "car" ? (pickupLocation.trim() || null) : null,
        dropoff_at: type === "car" ? (dropoffAt || null) : null,
        dropoff_location: type === "car" ? (dropoffLocation.trim() || null) : null,
        flight_number: type === "flight" ? (flightNumber.trim() || null) : null,
        depart_airport: type === "flight" ? (departAirport.trim().toUpperCase() || null) : null,
        arrive_airport: type === "flight" ? (arriveAirport.trim().toUpperCase() || null) : null,
        depart_time: type === "flight" ? (departTime.trim() || null) : null,
        arrive_time: type === "flight" ? (arriveTime.trim() || null) : null,
        outbound_cost: type === "flight" ? (outboundCost === "" ? null : flightOb) : null,
        return_airline: type === "flight" ? (returnAirline.trim() || null) : null,
        return_confirmation: type === "flight" ? (returnConfirmation.trim() || null) : null,
        return_flight_number: type === "flight" ? (returnFlightNumber.trim() || null) : null,
        return_depart_airport: type === "flight" ? (returnDepartAirport.trim().toUpperCase() || null) : null,
        return_arrive_airport: type === "flight" ? (returnArriveAirport.trim().toUpperCase() || null) : null,
        return_depart_time: type === "flight" ? (returnDepartTime.trim() || null) : null,
        return_arrive_time: type === "flight" ? (returnArriveTime.trim() || null) : null,
        return_cost: type === "flight" ? (returnCost === "" ? null : flightRt) : null,
        sms_reminder_offsets: type === "flight" ? smsOffsets : [],
      };

      if (isEdit) {
        await api.patch(`/bookings/${editingId}`, payload);
      } else {
        await api.post("/bookings", { competition_id: competitionId, type, ...payload });
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || e?.message || "Could not save");
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? "Edit" : "New"} {TITLE[type]}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{PROVIDER_LABEL[type]}</Text>
          <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder={type === "hotel" ? "e.g. Hyatt Regency" : type === "car" ? "e.g. Enterprise" : "e.g. Southwest"} placeholderTextColor={colors.textTertiary} testID="booking-provider-input" />

          {type !== "car" && (
            <>
              <Text style={styles.label}>{type === "hotel" ? "Hotel address (optional, for maps)" : "Airport address (optional, for maps)"}</Text>
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={setAddress}
                placeholder={type === "hotel" ? "e.g. 1209 Texas Ave, Houston, TX 77002" : "e.g. 2800 N Terminal Rd, Houston, TX 77032"}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                testID="booking-address-input"
              />
            </>
          )}

          <Text style={styles.label}>{type === "flight" ? "Outbound confirmation #" : "Confirmation #"}</Text>
          <TextInput style={styles.input} value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" placeholderTextColor={colors.textTertiary} testID="booking-conf-input" />

          {type === "hotel" && (
            <>
              <Text style={styles.label}>Check-in</Text>
              <DateField value={checkIn} onChange={setCheckIn} testID="booking-checkin-input" />
              <Text style={styles.label}>Check-in time (optional)</Text>
              <TimeField value={checkInTime} onChange={setCheckInTime} testID="booking-checkin-time-input" />
              <Text style={styles.label}>Check-out</Text>
              <DateField value={checkOut} onChange={setCheckOut} testID="booking-checkout-input" />
              <Text style={styles.label}>Check-out time (optional)</Text>
              <TimeField value={checkOutTime} onChange={setCheckOutTime} testID="booking-checkout-time-input" />
              <Text style={styles.label}>Free cancellation by (optional)</Text>
              <DateField value={cancelBy} onChange={setCancelBy} />
            </>
          )}

          {type === "car" && (
            <>
              <Text style={styles.section}>Pick-up</Text>
              <Text style={styles.label}>Pick-up date &amp; time</Text>
              <DateTimeField value={pickupAt} onChange={setPickupAt} testID="car-pickup-input" />
              <Text style={styles.label}>Pick-up location</Text>
              <TextInput style={styles.input} value={pickupLocation} onChangeText={setPickupLocation} placeholder="e.g. Houston Airport (IAH)" placeholderTextColor={colors.textTertiary} testID="car-pickup-location-input" />

              <Text style={styles.section}>Drop-off</Text>
              <Text style={styles.label}>Drop-off date &amp; time</Text>
              <DateTimeField value={dropoffAt} onChange={setDropoffAt} testID="car-dropoff-input" />
              <Text style={styles.label}>Drop-off location</Text>
              <TextInput style={styles.input} value={dropoffLocation} onChangeText={setDropoffLocation} placeholder="e.g. Houston Airport (IAH)" placeholderTextColor={colors.textTertiary} testID="car-dropoff-location-input" />
            </>
          )}

          {type === "flight" && (
            <>
              <Text style={styles.section}>Outbound</Text>
              <Text style={styles.label}>Flight #</Text>
              <TextInput style={styles.input} value={flightNumber} onChangeText={setFlightNumber} placeholder="WN1234" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" />

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Departure airport</Text>
                  <TextInput style={styles.input} value={departAirport} onChangeText={setDepartAirport} placeholder="LAX" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" maxLength={5} testID="depart-airport-input" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Arrival airport</Text>
                  <TextInput style={styles.input} value={arriveAirport} onChangeText={setArriveAirport} placeholder="HOU" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" maxLength={5} testID="arrive-airport-input" />
                </View>
              </View>

              <Text style={styles.label}>Depart</Text>
              <DateTimeField value={departTime} onChange={setDepartTime} testID="depart-time-input" />
              <Text style={styles.label}>Arrive</Text>
              <DateTimeField value={arriveTime} onChange={setArriveTime} testID="arrive-time-input" />
              <Text style={styles.label}>Outbound cost (USD)</Text>
              <TextInput style={styles.input} value={outboundCost} onChangeText={setOutboundCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="outbound-cost-input" />

              <Text style={styles.section}>Return (optional)</Text>
              <Text style={styles.label}>Return airline (if different)</Text>
              <TextInput style={styles.input} value={returnAirline} onChangeText={setReturnAirline} placeholder="e.g. Delta" placeholderTextColor={colors.textTertiary} testID="return-airline-input" />
              <Text style={styles.label}>Return confirmation #</Text>
              <TextInput style={styles.input} value={returnConfirmation} onChangeText={setReturnConfirmation} autoCapitalize="characters" placeholderTextColor={colors.textTertiary} testID="return-conf-input" />
              <Text style={styles.label}>Flight #</Text>
              <TextInput style={styles.input} value={returnFlightNumber} onChangeText={setReturnFlightNumber} placeholder="WN5678" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" />

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Departure airport</Text>
                  <TextInput style={styles.input} value={returnDepartAirport} onChangeText={setReturnDepartAirport} placeholder="HOU" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" maxLength={5} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Arrival airport</Text>
                  <TextInput style={styles.input} value={returnArriveAirport} onChangeText={setReturnArriveAirport} placeholder="LAX" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" maxLength={5} />
                </View>
              </View>

              <Text style={styles.label}>Depart</Text>
              <DateTimeField value={returnDepartTime} onChange={setReturnDepartTime} testID="return-depart-time-input" />
              <Text style={styles.label}>Arrive</Text>
              <DateTimeField value={returnArriveTime} onChange={setReturnArriveTime} testID="return-arrive-time-input" />
              <Text style={styles.label}>Return cost (USD)</Text>
              <TextInput style={styles.input} value={returnCost} onChangeText={setReturnCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="return-cost-input" />
            </>
          )}

          <Text style={styles.section}>Finances</Text>
          {type !== "flight" && (
            <>
              <Text style={styles.label}>Total cost (USD)</Text>
              <TextInput style={styles.input} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="booking-cost-input" />
            </>
          )}
          {type === "flight" && (
            <Text style={styles.helperText}>Total flight cost is calculated from the outbound + return amounts above.</Text>
          )}
          {type === "flight" && (
            <SmsReminderPicker
              value={smsOffsets}
              onChange={setSmsOffsets}
              title="Text me before check-in opens"
              note="Check-in opens 24h before each flight. SMS-only — turn on SMS reminders in Settings → Notifications."
              testIDPrefix="flight-sms-offset"
            />
          )}
          <Text style={styles.label}>Amount already paid (USD)</Text>
          <TextInput style={styles.input} value={amountPaid} onChangeText={setAmountPaid} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="booking-paid-input" />
          <Text style={styles.label}>Balance due date (optional)</Text>
          <DateField value={balanceDueDate} onChange={setBalanceDueDate} testID="booking-due-input" />

          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="booking-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : `Save ${TITLE[type].toLowerCase()}`}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  row2: { flexDirection: "row", gap: spacing.md },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  helperText: { ...typography.caption, color: colors.textTertiary, marginTop: 4, marginBottom: 4, fontStyle: "italic" },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
