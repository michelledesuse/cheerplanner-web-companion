import React from "react";
import { View, Text, Linking } from "react-native";
import StaticPage, { LegalSection } from "@/src/components/StaticPage";
import { spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const CONSENT = "By opting in, you agree to receive recurring automated reminder text messages from CheerPlanner at the mobile number provided (e.g. payment due dates, competitions, and travel deadlines). Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.";

export default function TextMessagingOptInScreen() {
  const s = useThemedStyles(makeStyles);
  return (
    <StaticPage title="SMS Reminder Opt-In" subtitle="How customers consent to receive text messages from CheerPlanner.">
      <LegalSection heading="How opt-in is collected">
        <Text style={s.p}>
          CheerPlanner is a mobile app for cheer parents. After signing in, a user goes to{" "}
          <Text style={s.b}>Settings → Notifications</Text>, enters their mobile number, and turns the{" "}
          <Text style={s.b}>“Send me SMS reminders”</Text> toggle ON. The toggle is OFF by default; the user must
          actively enable it. When enabled, the app records the consent timestamp and mobile number on the
          user’s account. No messages are sent unless the user opts in. Consent is not a condition of using the app.
        </Text>
      </LegalSection>

      <LegalSection heading="The opt-in screen (in-app)">
        <View style={s.phone}>
          <View style={s.phoneTop}><Text style={s.phoneTopText}>Notifications</Text></View>
          <View style={s.phoneBody}>
            <Text style={s.eyebrow}>TEXT MESSAGE (SMS) REMINDERS</Text>
            <View style={s.cardbox}>
              <Text style={s.desc}>Get a text when a payment, competition, or travel deadline is coming up.</Text>
              <Text style={s.fieldLabel}>MOBILE NUMBER</Text>
              <View style={s.field}><Text style={s.fieldText}>(555) 123-4567</Text></View>
              <View style={s.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>Send me SMS reminders</Text>
                  <Text style={s.toggleSub}>You must opt in to receive texts.</Text>
                </View>
                <View style={s.switch}><View style={s.knob} /></View>
              </View>
            </View>
            <View style={s.disclosure}><Text style={s.disclosureText}>{CONSENT}</Text></View>
          </View>
        </View>
      </LegalSection>

      <LegalSection heading="Exact consent language shown to the user">
        <View style={s.blockquote}><Text style={s.blockquoteText}>{CONSENT}</Text></View>
      </LegalSection>

      <LegalSection heading="Message types & frequency">
        <Text style={s.p}>
          Account reminders only: payment due dates, upcoming competitions, and travel/booking deadlines.
          Frequency varies with the user’s own schedule (typically a few messages per month). Message and data
          rates may apply.
        </Text>
        <Text style={s.p}>
          <Text style={s.b}>Sample message:</Text> “CheerPlanner: Tuition of $150 for Emma is due tomorrow (Jul 4). Reply STOP to opt out.”
        </Text>
      </LegalSection>

      <LegalSection heading="Opt-out">
        <Text style={s.p}>
          Users can reply STOP at any time, or turn the toggle OFF in Settings → Notifications. Reply HELP for help.
        </Text>
      </LegalSection>

      <LegalSection heading="Privacy">
        <Text style={s.p}>
          Privacy Policy:{" "}
          <Text style={s.link} onPress={() => Linking.openURL("https://cheer-planner.com/privacy")}>cheer-planner.com/privacy</Text>.
          {" "}Mobile opt-in data and phone numbers are never sold or shared with third parties for marketing.
        </Text>
      </LegalSection>
    </StaticPage>
  );
}

const makeStyles = (c: ThemePalette) => ({
  p: { ...typography.body, color: c.textSecondary, lineHeight: 22, marginBottom: spacing.sm },
  b: { fontWeight: "800", color: c.textPrimary },
  link: { color: c.primary, fontWeight: "600" },
  phone: { maxWidth: 340, width: "100%", borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: "hidden", backgroundColor: c.card, marginTop: spacing.sm },
  phoneTop: { backgroundColor: "#0F172A", paddingVertical: 12, alignItems: "center" },
  phoneTopText: { color: "#fff", fontWeight: "700" },
  phoneBody: { padding: spacing.md },
  eyebrow: { fontSize: 11, letterSpacing: 0.5, color: "#94A3B8", marginBottom: spacing.sm, fontWeight: "700" },
  cardbox: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, marginBottom: 12 },
  desc: { color: c.textSecondary, fontSize: 13, marginBottom: 12 },
  fieldLabel: { fontSize: 10, letterSpacing: 0.5, color: "#94A3B8", marginBottom: 4, fontWeight: "700" },
  field: { borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, marginBottom: 14 },
  fieldText: { color: c.textPrimary, fontSize: 14 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleLabel: { fontWeight: "600", color: c.textPrimary, fontSize: 14 },
  toggleSub: { color: c.textSecondary, fontSize: 12 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: "#CBD5E1", justifyContent: "center", alignItems: "flex-start", paddingLeft: 3 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  disclosure: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12 },
  disclosureText: { color: c.textSecondary, fontSize: 12, lineHeight: 18 },
  blockquote: { borderLeftWidth: 4, borderLeftColor: "#E11D48", backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 16, marginTop: spacing.sm },
  blockquoteText: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
});
