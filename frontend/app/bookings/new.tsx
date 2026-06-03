import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { isoToInput, userDateToISO } from "@/src/utils/format";

export default function BookingForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ competition_id?: string; type?: string; id?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  const [type, setType] = useState<"hotel" | "car" | "flight">(((params.type as any) || "hotel"));
  const [competitionId, setCompetitionId] = useState(params.competition_id || "");

  const [provider, setProvider] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [cost, setCost] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [balanceDueDate, setBalanceDueDate] = useState("");
  const [notes, setNotes] = useState("");
  // hotel
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [cancelBy, setCancelBy] = useState("");
  // flight
  const [flightNumber, setFlightNumber] = useState("");
  const [departAirport, setDepartAirport] = useState("");
  const [arriveAirport, setArriveAirport] = useState("");
  const [departTime, setDepartTime] = useState("");
  const [arriveTime, setArriveTime] = useState("");
  const [returnFlightNumber, setReturnFlightNumber] = useState("");
  const [returnDepartAirport, setReturnDepartAirport] = useState("");
  const [returnArriveAirport, setReturnArriveAirport] = useState("");
  const [returnDepartTime, setReturnDepartTime] = useState("");
  const [returnArriveTime, setReturnArriveTime] = useState("");

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const TITLE: Record<string, string> = { hotel: "Hotel", car: "Rental car", flight: "Flight" };
  const PROVIDER_LABEL: Record<string, string> = { hotel: "Hotel name", car: "Rental company", flight: "Airline" };

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
        setConfirmation(b.confirmation || "");
        setCost(b.cost != null ? String(b.cost) : "");
        setAmountPaid(b.amount_paid != null ? String(b.amount_paid) : "");
        setBalanceDueDate(isoToInput(b.balance_due_date));
        setNotes(b.notes || "");
        setCheckIn(isoToInput(b.check_in));
        setCheckOut(isoToInput(b.check_out));
        setCancelBy(isoToInput(b.cancel_by));
        setFlightNumber(b.flight_number || "");
        setDepartAirport(b.depart_airport || "");
        setArriveAirport(b.arrive_airport || "");
        setDepartTime(b.depart_time || "");
        setArriveTime(b.arrive_time || "");
        setReturnFlightNumber(b.return_flight_number || "");
        setReturnDepartAirport(b.return_depart_airport || "");
        setReturnArriveAirport(b.return_arrive_airport || "");
        setReturnDepartTime(b.return_depart_time || "");
        setReturnArriveTime(b.return_arrive_time || "");
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
      const payload: any = {
        provider: provider.trim() || null,
        confirmation: confirmation.trim() || null,
        cost: parseFloat(cost) || 0,
        amount_paid: parseFloat(amountPaid) || 0,
        balance_due_date: userDateToISO(balanceDueDate),
        notes: notes.trim() || null,
        check_in: type === "hotel" ? userDateToISO(checkIn) : null,
        check_out: type === "hotel" ? userDateToISO(checkOut) : null,
        cancel_by: type === "hotel" ? userDateToISO(cancelBy) : null,
        flight_number: type === "flight" ? (flightNumber.trim() || null) : null,
        depart_airport: type === "flight" ? (departAirport.trim().toUpperCase() || null) : null,
        arrive_airport: type === "flight" ? (arriveAirport.trim().toUpperCase() || null) : null,
        depart_time: type === "flight" ? (departTime.trim() || null) : null,
        arrive_time: type === "flight" ? (arriveTime.trim() || null) : null,
        return_flight_number: type === "flight" ? (returnFlightNumber.trim() || null) : null,
        return_depart_airport: type === "flight" ? (returnDepartAirport.trim().toUpperCase() || null) : null,
        return_arrive_airport: type === "flight" ? (returnArriveAirport.trim().toUpperCase() || null) : null,
        return_depart_time: type === "flight" ? (returnDepartTime.trim() || null) : null,
        return_arrive_time: type === "flight" ? (returnArriveTime.trim() || null) : null,
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

          <Text style={styles.label}>Confirmation #</Text>
          <TextInput style={styles.input} value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" placeholderTextColor={colors.textTertiary} testID="booking-conf-input" />

          {type === "hotel" && (
            <>
              <Text style={styles.label}>Check-in</Text>
              <TextInput style={styles.input} value={checkIn} onChangeText={setCheckIn} placeholder="DD-MM-YYYY" placeholderTextColor={colors.textTertiary} testID="booking-checkin-input" />
              <Text style={styles.label}>Check-out</Text>
              <TextInput style={styles.input} value={checkOut} onChangeText={setCheckOut} placeholder="DD-MM-YYYY" placeholderTextColor={colors.textTertiary} testID="booking-checkout-input" />
              <Text style={styles.label}>Free cancellation by (optional)</Text>
              <TextInput style={styles.input} value={cancelBy} onChangeText={setCancelBy} placeholder="DD-MM-YYYY" placeholderTextColor={colors.textTertiary} />
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

              <Text style={styles.label}>Depart time</Text>
              <TextInput style={styles.input} value={departTime} onChangeText={setDepartTime} placeholder="DD-MM-YYYY 08:30" placeholderTextColor={colors.textTertiary} />
              <Text style={styles.label}>Arrive time</Text>
              <TextInput style={styles.input} value={arriveTime} onChangeText={setArriveTime} placeholder="DD-MM-YYYY 10:15" placeholderTextColor={colors.textTertiary} />

              <Text style={styles.section}>Return (optional)</Text>
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

              <Text style={styles.label}>Depart time</Text>
              <TextInput style={styles.input} value={returnDepartTime} onChangeText={setReturnDepartTime} placeholder="DD-MM-YYYY 16:00" placeholderTextColor={colors.textTertiary} />
              <Text style={styles.label}>Arrive time</Text>
              <TextInput style={styles.input} value={returnArriveTime} onChangeText={setReturnArriveTime} placeholder="DD-MM-YYYY 18:30" placeholderTextColor={colors.textTertiary} />
            </>
          )}

          <Text style={styles.section}>Finances</Text>
          <Text style={styles.label}>Total cost (USD)</Text>
          <TextInput style={styles.input} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="booking-cost-input" />
          <Text style={styles.label}>Amount already paid (USD)</Text>
          <TextInput style={styles.input} value={amountPaid} onChangeText={setAmountPaid} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="booking-paid-input" />
          <Text style={styles.label}>Balance due date (optional)</Text>
          <TextInput style={styles.input} value={balanceDueDate} onChangeText={setBalanceDueDate} placeholder="DD-MM-YYYY" placeholderTextColor={colors.textTertiary} testID="booking-due-input" />

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  row2: { flexDirection: "row", gap: spacing.md },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
