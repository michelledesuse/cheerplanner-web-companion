import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { isoToInput, userDateToISO } from "@/src/utils/format";
import DateField from "@/src/components/DateField";
import DateTimeField from "@/src/components/DateTimeField";
import TimeField from "@/src/components/TimeField";

export default function CompetitionForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [housingRequired, setHousingRequired] = useState(false);
  const [bookingLink, setBookingLink] = useState("");
  const [bookingReleaseAt, setBookingReleaseAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const res = await api.get(`/competitions/${editingId}`);
        const c = res.data;
        setName(c.name || "");
        setLocation(c.location || "");
        setAddress(c.address || "");
        setEventDate(c.event_date || "");
        setEventTime(c.event_time || "");
        setEndDate(c.end_date || "");
        setHousingRequired(!!c.housing_required);
        setBookingLink(c.booking_link || "");
        setBookingReleaseAt(c.booking_release_at || "");
        setNotes(c.notes || "");
      } catch (_e) {
        Alert.alert("Error", "Could not load competition");
      } finally {
        setLoading(false);
      }
    })();
  }, [editingId, isEdit]);

  const save = async () => {
    if (!name.trim() || !eventDate) { Alert.alert("Missing", "Name and event date are required."); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        location: location.trim() || null,
        address: address.trim() || null,
        event_date: eventDate,
        event_time: eventTime.trim() || null,
        end_date: endDate || null,
        housing_required: housingRequired,
        booking_link: bookingLink.trim() || null,
        booking_release_at: bookingReleaseAt || null,
        notes: notes.trim() || null,
      };
      if (isEdit) {
        await api.patch(`/competitions/${editingId}`, payload);
      } else {
        await api.post("/competitions", payload);
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
          <Text style={styles.headerTitle}>{isEdit ? "Edit competition" : "New competition"}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Competition name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. NCA Senior Nationals" placeholderTextColor={colors.textTertiary} testID="comp-name-input" />

          <Text style={styles.label}>Location</Text>
          <Text style={styles.label}>Location / venue name</Text>
          <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. Houston Convention Center" placeholderTextColor={colors.textTertiary} testID="comp-location-input" />

          <Text style={styles.label}>Address (street, city, state)</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. 1001 Avenida de las Americas, Houston, TX 77010"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            testID="comp-address-input"
          />

          <Text style={styles.label}>Event date</Text>
          <DateField value={eventDate} onChange={setEventDate} testID="comp-date-input" />

          <Text style={styles.label}>Team performance time (optional)</Text>
          <TimeField value={eventTime} onChange={setEventTime} testID="comp-time-input" />

          <Text style={styles.label}>End date (optional)</Text>
          <DateField value={endDate} onChange={setEndDate} />

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bodyText}>Housing required (Stay to Play)</Text>
              <Text style={styles.subText}>Must book through official channels</Text>
            </View>
            <Switch value={housingRequired} onValueChange={setHousingRequired} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="white" />
          </View>

          <Text style={styles.label}>Booking link (optional)</Text>
          <TextInput style={styles.input} value={bookingLink} onChangeText={setBookingLink} placeholder="https://..." placeholderTextColor={colors.textTertiary} autoCapitalize="none" />

          <Text style={styles.label}>Booking release (date &amp; time)</Text>
          <DateTimeField value={bookingReleaseAt} onChange={setBookingReleaseAt} testID="comp-booking-release-input" />

          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.textTertiary} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="comp-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : "Save competition"}</Text>}
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
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  bodyText: { ...typography.bodyMedium, color: colors.textPrimary },
  subText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
