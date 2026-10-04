import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { useSeason } from "@/src/context/SeasonContext";
import SeasonPicker from "@/src/components/SeasonPicker";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { isoToInput, userDateToISO } from "@/src/utils/format";
import DateField from "@/src/components/DateField";
import DateTimeField from "@/src/components/DateTimeField";
import TimeField from "@/src/components/TimeField";
import LinksEditor, { cleanLinks, type ExternalLink } from "@/src/components/LinksEditor";
import PhotoGallery from "@/src/components/PhotoGallery";
import SmsReminderPicker from "@/src/components/SmsReminderPicker";

export default function CompetitionForm() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();
  const { filterSeasonId } = useSeason();
  const params = useLocalSearchParams<{ id?: string; date?: string }>();
  const editingId = params.id;
  const isEdit = !!editingId;

  // Coaches/reps/staff can push this competition onto the TeamHub calendar,
  // optionally pulling in its hotel/flight/car bookings and other details.
  const canHub = !!user?.team_access;
  const [addToHub, setAddToHub] = useState(false);
  const [hubInc, setHubInc] = useState({
    hotel: true, flight: true, car: true, teams_to_watch: true, packing_list: true, links: true,
  });
  const toggleInc = (k: keyof typeof hubInc) => setHubInc((p) => ({ ...p, [k]: !p[k] }));
  const [keepNotes, setKeepNotes] = useState(false);
  const [hubToast, setHubToast] = useState<{ teamEventId?: string; updated: boolean } | null>(null);
  const hubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [eventDate, setEventDate] = useState(params.date || "");
  const [eventTime, setEventTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [housingRequired, setHousingRequired] = useState(false);
  const [bookingLink, setBookingLink] = useState("");
  const [bookingReleaseAt, setBookingReleaseAt] = useState("");
  const [smsOffsets, setSmsOffsets] = useState<number[]>([]);
  const [eventOffsets, setEventOffsets] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [seasonIds, setSeasonIds] = useState<string[]>([]);
  const [origSeasonIds, setOrigSeasonIds] = useState<string[]>([]);
  const [scope, setScope] = useState<"this" | "forward" | "all">("all");
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
        setSmsOffsets(Array.isArray(c.sms_reminder_offsets) ? c.sms_reminder_offsets : []);
        setEventOffsets(Array.isArray(c.event_reminder_offsets) ? c.event_reminder_offsets : []);
        setNotes(c.notes || "");
        setLinks(Array.isArray(c.links) ? c.links : []);
        setPhotos(Array.isArray(c.photos) ? c.photos : []);
        setSeasonIds(Array.isArray(c.season_ids) ? c.season_ids : []);
        setOrigSeasonIds(Array.isArray(c.season_ids) ? c.season_ids : []);
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
        sms_reminder_offsets: bookingReleaseAt ? smsOffsets : [],
        event_reminder_offsets: eventOffsets,
        notes: notes.trim() || null,
        links: cleanLinks(links),
        photos,
      };
      let pushId: string | undefined = editingId;
      if (isEdit) {
        if (origSeasonIds.length > 1 && scope !== "all") {
          await api.patch(`/competitions/${editingId}`, { ...payload, edit_scope: scope });
        } else {
          await api.patch(`/competitions/${editingId}`, { ...payload, season_ids: seasonIds });
        }
      } else {
        const res = await api.post("/competitions", { ...payload, season_ids: seasonIds.length ? seasonIds : (filterSeasonId ? [filterSeasonId] : []) });
        pushId = res.data?.id || undefined;
      }
      await finishAfterSave(pushId);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || e?.message || "Could not save");
    } finally { setSaving(false); }
  };

  // Push the competition to the TeamHub calendar with the chosen details. A
  // brand-new team event gets an "Added to TeamHub" toast with Undo; a re-push
  // that refreshed an existing event shows "Updated on TeamHub".
  const finishAfterSave = async (pushId?: string) => {
    if (addToHub && canHub && pushId) {
      try {
        const r = await api.post<{ event_id?: string; updated?: boolean; already?: boolean }>(
          "/team/calendar/import-from-personal",
          { source: "competition", id: pushId, include: { ...hubInc, preserve_notes: keepNotes } },
        );
        if (r.data?.updated) {
          setHubToast({ teamEventId: r.data.event_id, updated: true });
          hubTimer.current = setTimeout(() => router.back(), 2500);
          return;
        }
        if (r.data?.event_id && !r.data?.already) {
          setHubToast({ teamEventId: r.data.event_id, updated: false });
          hubTimer.current = setTimeout(() => router.back(), 3800);
          return;
        }
      } catch (_e) { /* non-blocking: the competition still saved */ }
    }
    router.back();
  };

  const undoHubPush = async () => {
    if (hubTimer.current) clearTimeout(hubTimer.current);
    const id = hubToast?.teamEventId;
    const wasUpdate = hubToast?.updated;
    setHubToast(null);
    // Only delete when we created a new team event; an updated one existed before.
    if (id && !wasUpdate) { try { await api.delete(`/team/calendar/events/${id}`); } catch (_e) { /* ignore */ } }
    router.back();
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

          <SmsReminderPicker
            value={eventOffsets}
            onChange={setEventOffsets}
            title="Text me before this competition"
            testIDPrefix="comp-event-sms-offset"
          />

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

          <Text style={styles.label}>Links (optional)</Text>
          <LinksEditor value={links} onChange={setLinks} testIDPrefix="comp-link" />
          <PhotoGallery photos={photos} onChange={setPhotos} testIDPrefix="comp-photo" />

          <Text style={styles.label}>Booking release (date &amp; time)</Text>
          <DateTimeField value={bookingReleaseAt} onChange={setBookingReleaseAt} testID="comp-booking-release-input" />
          {!!bookingReleaseAt && (
            <SmsReminderPicker
              value={smsOffsets}
              onChange={setSmsOffsets}
              title="Text me before booking opens"
              testIDPrefix="comp-sms-offset"
            />
          )}

          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, { minHeight: 60, maxHeight: 140, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.textTertiary} />

          <SeasonPicker
            selectedIds={seasonIds}
            onToggle={(id) => setSeasonIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            showScope={isEdit && origSeasonIds.length > 1}
            scope={scope}
            onScopeChange={setScope}
          />

          {canHub && (
            <View style={styles.hubBlock}>
              <View style={styles.hubHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <Ionicons name="people" size={18} color={colors.accent} />
                  <Text style={styles.bodyText}>Add to TeamHub Calendar</Text>
                </View>
                <Switch
                  value={addToHub}
                  onValueChange={setAddToHub}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor="white"
                  testID="comp-add-to-hub"
                />
              </View>
              {addToHub ? (
                <>
                  <Text style={styles.hubHint}>Choose what to include on the shared TeamHub event:</Text>
                  <View style={styles.incWrap}>
                    {([
                      ["hotel", "Hotel"], ["flight", "Flight"], ["car", "Car"],
                      ["teams_to_watch", "Teams to watch"], ["packing_list", "Packing list"], ["links", "Links"],
                    ] as [keyof typeof hubInc, string][]).map(([k, lbl]) => {
                      const on = hubInc[k];
                      return (
                        <TouchableOpacity key={k} onPress={() => toggleInc(k)} style={[styles.incChip, on && styles.incChipOn]} testID={`comp-hub-inc-${k}`}>
                          <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={on ? "white" : colors.textSecondary} />
                          <Text style={[styles.incChipText, on && { color: "white" }]}>{lbl}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity onPress={() => setKeepNotes((v) => !v)} style={styles.keepNotesRow} testID="comp-hub-keep-notes">
                    <Ionicons name={keepNotes ? "checkbox" : "square-outline"} size={18} color={keepNotes ? colors.accent : colors.textSecondary} />
                    <Text style={styles.keepNotesText}>Keep my existing TeamHub notes (don&apos;t overwrite)</Text>
                  </TouchableOpacity>
                  <Text style={styles.hubHint}>Hotel, flight &amp; car details come from this competition&apos;s bookings. Added some after saving? Just re-save with this on to refresh the team event.</Text>
                </>
              ) : (
                <Text style={styles.hubHint}>Coaches, reps &amp; staff can share this competition (and its travel) with the team.</Text>
              )}
            </View>
          )}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} testID="comp-save-btn">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>{isEdit ? "Save changes" : "Save competition"}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {hubToast && (
        <View style={styles.hubToast} testID="comp-hub-toast" pointerEvents="box-none">
          <View style={styles.hubToastInner}>
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={styles.hubToastText}>{hubToast.updated ? "Updated on TeamHub" : "Added to TeamHub"}</Text>
            {!hubToast.updated && (
              <TouchableOpacity onPress={undoHubPush} hitSlop={10} testID="comp-hub-toast-undo">
                <Text style={styles.hubToastUndo}>Undo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  bodyText: { ...typography.bodyMedium, color: colors.textPrimary },
  subText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  hubBlock: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.accentSubtle, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentBorder },
  hubHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  hubHint: { ...typography.caption, color: colors.textSecondary, marginTop: 8 },
  incWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  incChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  incChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  incChipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "700" },
  keepNotesRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  keepNotesText: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  hubToast: { position: "absolute", left: 0, right: 0, bottom: 24, alignItems: "center" },
  hubToastInner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#0F172A", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 },
  hubToastText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  hubToastUndo: { color: "#60A5FA", fontWeight: "800", fontSize: 14, marginLeft: 4 },
  saveBtn: { marginTop: spacing.xxl, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
});
