import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Switch, ActivityIndicator, Alert, Platform, TextInput, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type Frequency = "daily" | "weekly" | "off";

type CategoryKey =
  | "expense_due"
  | "booking_balance"
  | "booking_cancel_by"
  | "booking_release"
  | "competition_event"
  | "packing";

type Preferences = {
  enabled: boolean;
  frequency: Frequency;
  timezone: string;
  categories: Record<CategoryKey, boolean>;
  sms_enabled?: boolean;
  sms_phone?: string | null;
  sms_consent_at?: string | null;
};

const FREQUENCY_OPTIONS: { id: Frequency; label: string; sub: string }[] = [
  { id: "daily", label: "Daily digest", sub: "One email at 8 AM with everything due in the next 7 days" },
  { id: "weekly", label: "Weekly digest", sub: "One email on Monday morning summarizing the upcoming 2 weeks" },
  { id: "off", label: "Off", sub: "No reminder emails" },
];

const CATEGORY_LABELS: { id: CategoryKey; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "expense_due",       label: "Expense payments",   sub: "Tuition, gear, comp fees due soon",       icon: "card-outline" },
  { id: "booking_balance",   label: "Travel balances",    sub: "Hotel / flight / car balance due dates",  icon: "wallet-outline" },
  { id: "booking_cancel_by", label: "Cancel-by deadlines", sub: "Last day to cancel a hotel without fees", icon: "time-outline" },
  { id: "booking_release",   label: "Hotel booking opens", sub: "Reminders so you don't miss limited rooms", icon: "bed-outline" },
  { id: "competition_event", label: "Upcoming competitions", sub: "Comps in the next week",              icon: "trophy-outline" },
  { id: "packing",           label: "Packing list nudges", sub: "Pack-the-night-before reminders",        icon: "briefcase-outline" },
];

export default function NotificationsSettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [smsPhone, setSmsPhone] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<Preferences>("/notifications/preferences");
        setPrefs(r.data);
        setSmsPhone(r.data?.sms_phone || "");
      } catch (e: any) {
        Alert.alert("Couldn't load preferences", e?.response?.data?.detail || "Try again later.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const patch = async (updates: Partial<Preferences>) => {
    if (!prefs) return;
    // Optimistic update
    const next = {
      ...prefs,
      ...updates,
      categories: updates.categories ? { ...prefs.categories, ...updates.categories } : prefs.categories,
    };
    setPrefs(next);
    setSaving(true);
    try {
      const r = await api.patch<Preferences>("/notifications/preferences", updates);
      setPrefs(r.data);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.response?.data?.detail || "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const normalizePhone = (raw: string) => {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/[^0-9]/g, "");
    // Default US country code if a bare 10-digit number is entered.
    if (trimmed.startsWith("+")) return "+" + digits;
    if (digits.length === 10) return "+1" + digits;
    return "+" + digits;
  };

  const toggleSmsConsent = async (v: boolean) => {
    if (v) {
      const digits = smsPhone.replace(/[^0-9]/g, "");
      if (digits.length < 10) {
        Alert.alert("Add your mobile number", "Please enter a valid mobile number before opting in to SMS reminders.");
        return;
      }
      await patch({
        sms_enabled: true,
        sms_phone: normalizePhone(smsPhone),
        sms_consent_at: new Date().toISOString(),
      });
    } else {
      await patch({ sms_enabled: false });
    }
  };

  const sendTestSms = async () => {
    setSendingTest(true);
    try {
      await api.post("/notifications/sms-test");
      Alert.alert("Test text sent", "Check your phone — a confirmation text is on its way.");
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.response?.data?.detail || "Please try again shortly.");
    } finally {
      setSendingTest(false);
    }
  };

  if (loading || !prefs) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const off = prefs.frequency === "off" || !prefs.enabled;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="notif-back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 22 }}>
          {saving ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          We'll email you reminders about the things you care most about. You can change this anytime.
        </Text>

        {/* Frequency */}
        <Text style={styles.sectionHead}>Email frequency</Text>
        <View style={styles.group}>
          {FREQUENCY_OPTIONS.map((opt, idx) => {
            const selected = prefs.frequency === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.freqRow, idx === FREQUENCY_OPTIONS.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => patch({ frequency: opt.id, enabled: opt.id !== "off" })}
                activeOpacity={0.7}
                testID={`notif-freq-${opt.id}`}
              >
                <View style={styles.radioOuter}>
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.freqLabel}>{opt.label}</Text>
                  <Text style={styles.freqSub}>{opt.sub}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Categories */}
        <Text style={styles.sectionHead}>What to remind me about</Text>
        <View style={[styles.group, off && { opacity: 0.5 }]}>
          {CATEGORY_LABELS.map((cat, idx) => {
            const on = !!prefs.categories[cat.id];
            return (
              <View
                key={cat.id}
                style={[styles.catRow, idx === CATEGORY_LABELS.length - 1 && { borderBottomWidth: 0 }]}
              >
                <View style={styles.catIcon}>
                  <Ionicons name={cat.icon} size={18} color={colors.textPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.catLabel}>{cat.label}</Text>
                  <Text style={styles.catSub}>{cat.sub}</Text>
                </View>
                <Switch
                  testID={`notif-cat-${cat.id}`}
                  value={on}
                  disabled={off}
                  onValueChange={(v) => patch({ categories: { ...prefs.categories, [cat.id]: v } as any })}
                  trackColor={{ false: "#CBD5E1", true: colors.accent }}
                  thumbColor={Platform.OS === "android" ? "#fff" : undefined}
                />
              </View>
            );
          })}
        </View>

        {/* SMS reminders (opt-in) */}
        <Text style={styles.sectionHead}>Text message (SMS) reminders</Text>
        <View style={styles.group}>
          <View style={styles.smsIntroRow}>
            <View style={styles.catIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textPrimary} />
            </View>
            <Text style={styles.smsIntroText}>
              Get a text when a payment, competition, or travel deadline is coming up.
            </Text>
          </View>

          <View style={styles.smsFieldWrap}>
            <Text style={styles.smsFieldLabel}>Mobile number</Text>
            <TextInput
              testID="notif-sms-phone"
              value={smsPhone}
              onChangeText={setSmsPhone}
              editable={!prefs.sms_enabled}
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.textTertiary}
              keyboardType="phone-pad"
              style={styles.smsInput}
            />
          </View>

          <View style={[styles.catRow, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={styles.catLabel}>Send me SMS reminders</Text>
              <Text style={styles.catSub}>
                {prefs.sms_enabled ? "You're opted in. Turn off to stop texts." : "You must opt in to receive texts."}
              </Text>
            </View>
            <Switch
              testID="notif-sms-consent"
              value={!!prefs.sms_enabled}
              onValueChange={toggleSmsConsent}
              trackColor={{ false: "#CBD5E1", true: colors.accent }}
              thumbColor={Platform.OS === "android" ? "#fff" : undefined}
            />
          </View>
          {prefs.sms_enabled && (
            <TouchableOpacity
              style={styles.testSmsBtn}
              onPress={sendTestSms}
              disabled={sendingTest}
              testID="notif-sms-test"
            >
              {sendingTest ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={16} color={colors.accent} />
                  <Text style={styles.testSmsText}>Send me a test text</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.consentBox}>
          <Text style={styles.consentText}>
            By opting in, you agree to receive recurring automated reminder text messages from
            CheerPlanner at the mobile number provided (e.g. payment due dates, competitions, and
            travel deadlines). Consent is not a condition of purchase. Message frequency varies.
            Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.
          </Text>
          <View style={styles.consentLinksRow}>
            <TouchableOpacity onPress={() => router.push("/settings/privacy" as any)} testID="notif-privacy-link">
              <Text style={styles.consentLink}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={styles.consentDot}>•</Text>
            <TouchableOpacity onPress={() => Linking.openURL("https://cheer-planner.com/privacy")} testID="notif-privacy-web">
              <Text style={styles.consentLink}>cheer-planner.com/privacy</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.note}>
          Reminders are sent in your local timezone. To turn everything off, choose "Off" above.
          You can also tap the unsubscribe link at the bottom of any reminder email.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.bg,
  },
  backBtn: { width: 32, alignItems: "flex-start" },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...typography.body, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.lg },
  center: { alignItems: "center", justifyContent: "center" },

  sectionHead: { ...typography.micro, color: colors.textTertiary, marginTop: spacing.md, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },

  freqRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  freqLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  freqSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.accent, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },

  catRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  catIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  catLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  catSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  note: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.lg, lineHeight: 18 },

  smsIntroRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  smsIntroText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  smsFieldWrap: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  testSmsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: spacing.md, marginBottom: spacing.md, paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  testSmsText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
  smsFieldLabel: { ...typography.micro, color: colors.textTertiary, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.5 },
  smsInput: {
    ...typography.body, color: colors.textPrimary, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  consentBox: {
    marginTop: spacing.md, padding: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  consentText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  consentLinksRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  consentLink: { ...typography.caption, color: colors.accent, fontWeight: "600" },
  consentDot: { color: colors.textTertiary },
});
