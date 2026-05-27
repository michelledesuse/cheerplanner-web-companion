import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function NewBooking() {
  const router = useRouter();
  const params = useLocalSearchParams<{ competition_id: string; type: string }>();
  const type = (params.type || "hotel") as "hotel" | "car" | "flight";

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
  const [departTime, setDepartTime] = useState("");
  const [arriveTime, setArriveTime] = useState("");
  const [returnFlightNumber, setReturnFlightNumber] = useState("");
  const [returnDepartTime, setReturnDepartTime] = useState("");
  const [returnArriveTime, setReturnArriveTime] = useState("");

  const [saving, setSaving] = useState(false);

  const TITLE: Record<string, string> = { hotel: "Hotel", car: "Rental car", flight: "Flight" };
  const PROVIDER_LABEL: Record<string, string> = { hotel: "Hotel name", car: "Rental company", flight: "Airline" };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/bookings", {
        competition_id: params.competition_id,
        type,
        provider: provider.trim() || null,
        confirmation: confirmation.trim() || null,
        cost: parseFloat(cost) || 0,
        amount_paid: parseFloat(amountPaid) || 0,
        balance_due_date: balanceDueDate || null,
        notes: notes.trim() || null,
        check_in: type === "hotel" ? (checkIn || null) : null,
        check_out: type === "hotel" ? (checkOut || null) : null,
        cancel_by: type === "hotel" ? (cancelBy || null) : null,
        flight_number: type === "flight" ? (flightNumber.trim() || null) : null,
        depart_time: type === "flight" ? (departTime.trim() || null) : null,
        arrive_time: type === "flight" ? (arriveTime.trim() || null) : null,
        return_flight_number: type === "flight" ? (returnFlightNumber.trim() || null) : null,
        return_depart_time: type === "flight" ? (returnDepartTime.trim() || null) : null,
        return_arrive_time: type === "flight" ? (returnArriveTime.trim() || null) : null,
      });
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New {TITLE[type]}</Text>
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
              <TextInput style={styles.input} value={checkIn} onChangeText={setCheckIn} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} testID="booking-checkin-input" />
              <Text style={styles.label}>Check-out</Text>
              <TextInput style={styles.input} value={checkOut} onChangeText={setCheckOut} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} testID="booking-checkout-input" />
              <Text style={styles.label}>Free cancellation by (optional)</Text>
              <TextInput style={styles.input} value={cancelBy} onChangeText={setCancelBy} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} />
            </>
          )}

          {type === "flight" && (
            <>
              <Text style={styles.section}>Outbound</Text>
              <Text style={styles.label}>Flight #</Text>
              <TextInput style={styles.input} value={flightNumber} onChangeText={setFlightNumber} placeholder="WN1234" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" />
              <Text style={styles.label}>Depart time</Text>
              <TextInput style={styles.input} value={departTime} onChangeText={setDepartTime} placeholder="2025-11-13 08:30" placeholderTextColor={colors.textTertiary} />
              <Text style={styles.label}>Arrive time</Text>
              <TextInput style={styles.input} value={arriveTime} onChangeText={setArriveTime} placeholder="2025-11-13 10:15" placeholderTextColor={colors.textTertiary} />

              <Text style={styles.section}>Return (optional)</Text>
              <Text style={styles.label}>Flight #</Text>
              <TextInput style={styles.input} value={returnFlightNumber} onChangeText={setReturnFlightNumber} placeholder="WN5678" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" />
              <Text style={styles.label}>Depart time</Text>
              <TextInput style={styles.input} value={returnDepartTime} onChangeText={setReturnDepartTime} placeholder="2025-11-16 16:00" placeholderTextColor={colors.textTertiary} />
              <Text style={styles.label}>Arrive time</Text>
              <TextInput style={styles.input} value={returnArriveTime} onChangeText={setReturnArriveTime} placeholder="2025-11-16 18:30" placeholderTextColor={colors.textTertiary} />
            </>
          )}

          <Text style={styles.section}>Finances</Text>
          <Text style={styles.label}>Total cost (USD)</Text>
          <TextInput style={styles.input} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="booking-cost-input" />
          <Text style={styles.label}>Amount already paid (USD)</Text>
          <TextInput style={styles.input} value={amountPaid} onChangeText={setAmountPaid} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="booking-paid-input" />
          <Text style={styles.label}>Balance due date (optional)</Text>
          <TextInput style={styles.input} value={balanceDueDate} onChangeText={setBalanceDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} testID="booking-due-input" />

          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="booking-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>Save {TITLE[type].toLowerCase()}</Text>}
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
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
