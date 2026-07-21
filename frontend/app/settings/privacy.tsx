import React from "react";
import { View, Text, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

const LAST_UPDATED = "July 21, 2026";
const SUPPORT_EMAIL = "info@cheer-planner.com";
const WEBSITE = "https://cheer-planner.com/privacy";

export default function PrivacyPolicyScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="privacy-back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} testID="privacy-screen">
        <Text style={styles.brand}>CheerPlanner</Text>
        <Text style={styles.updated}>Last updated: {LAST_UPDATED}</Text>

        <Text style={styles.p}>
          This Privacy Policy explains how CheerPlanner (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, and
          protects your information when you use the CheerPlanner mobile application and related
          services (the &quot;Service&quot;).
        </Text>

        <Text style={styles.h}>Information we collect</Text>
        <Text style={styles.p}>
          We collect information you provide directly, including your name, email address, mobile
          phone number (if you opt in to SMS), and the household, athlete, competition, expense,
          payment, travel, and schedule details you enter into the app. We also collect basic
          technical data such as device type and app usage needed to operate the Service.
        </Text>
        <Text style={styles.p}>
          If you use Team Hub (see below), you may also provide information about other people —
          such as team members, athletes, and their parents/guardians — including names, contact
          details, uniform/apparel sizes, paperwork completion status, and payment tracking notes.
          You may enter this manually or upload it by importing a spreadsheet (CSV or Excel) file.
        </Text>

        <Text style={styles.h}>Team Hub (for coaches &amp; team staff)</Text>
        <Text style={styles.p}>
          Team Hub is an optional workspace for coaches, team reps, and staff to organize a team
          roster, sizes, paperwork, payment tracking, and volunteer sign-ups. Access is controlled
          by the account owner, who grants Team Hub access to specific people and can invite others
          by email.
        </Text>
        <Text style={styles.p}>
          If you enter or upload information about other individuals, you are responsible for having
          the appropriate authority or consent to do so, and for using that information solely for
          legitimate team-management purposes. This data is visible only to household logins you
          have granted Team Hub access. If a person listed in your roster asks you to remove their
          information, you can delete it within the app.
        </Text>

        <Text style={styles.h}>Uploaded files</Text>
        <Text style={styles.p}>
          When you import a spreadsheet, we process the file only to extract the rows you choose to
          import and to create the corresponding records in your account. We do not use uploaded
          files for any other purpose.
        </Text>

        <Text style={styles.h}>How we use your information</Text>
        <Text style={styles.p}>
          We use your information to provide and improve the Service, sync your data across your
          devices and household members you invite, and to send you the reminders and notifications
          you have enabled (email and, if you opt in, SMS).
        </Text>

        <Text style={styles.h}>SMS / text message reminders</Text>
        <Text style={styles.p}>
          If you opt in, we use your mobile number solely to send you account-related reminder text
          messages (such as payment due dates, upcoming competitions, and travel deadlines). Message
          frequency varies based on your activity and preferences. Message and data rates may apply.
        </Text>
        <Text style={styles.p}>
          You can opt out at any time by replying STOP to any message or by turning off SMS
          reminders in Settings → Notifications. Reply HELP for help. Consent to receive text
          messages is not a condition of using the Service.
        </Text>
        <Text style={styles.p}>
          Mobile information (including your phone number) is used only to deliver the reminders you
          request. We do not sell, rent, or share your mobile opt-in data or phone number with third
          parties or affiliates for their own marketing purposes. Message delivery is handled by our
          SMS provider (Twilio) strictly to transmit your reminders.
        </Text>

        <Text style={styles.h}>How we share information</Text>
        <Text style={styles.p}>
          We do not sell your personal information. We share data only with service providers that
          help us operate the Service (such as cloud hosting, email delivery, and SMS delivery),
          with household members you explicitly invite or people you grant Team Hub access, or when
          required by law.
        </Text>

        <Text style={styles.h}>Data retention & security</Text>
        <Text style={styles.p}>
          We retain your information for as long as your account is active. You can delete your
          account and associated data at any time from Settings → Delete account. We use industry
          standard measures to protect your data, though no method of transmission or storage is
          completely secure.
        </Text>

        <Text style={styles.h}>Your choices</Text>
        <Text style={styles.p}>
          You may update your notification preferences, opt out of SMS, or delete your account at any
          time within the app. To request access to or deletion of your data, contact us using the
          details below.
        </Text>

        <Text style={styles.h}>Children&apos;s privacy</Text>
        <Text style={styles.p}>
          CheerPlanner is intended for use by parents and guardians. It is not directed to children
          under 13, and we do not knowingly collect personal information directly from children.
        </Text>

        <Text style={styles.h}>Changes to this policy</Text>
        <Text style={styles.p}>
          We may update this Privacy Policy from time to time. Material changes will be reflected by
          updating the &quot;Last updated&quot; date above.
        </Text>

        <Text style={styles.h}>Contact us</Text>
        <TouchableOpacity onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} testID="privacy-email">
          <Text style={styles.link}>{SUPPORT_EMAIL}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL(WEBSITE)} testID="privacy-web">
          <Text style={styles.link}>cheer-planner.com/privacy</Text>
        </TouchableOpacity>
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
  brand: { ...typography.h2, color: colors.accent, fontWeight: "800" },
  updated: { ...typography.caption, color: colors.textTertiary, marginTop: 4, marginBottom: spacing.lg },
  h: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.xs },
  p: { ...typography.body, color: colors.textSecondary, lineHeight: 21, marginBottom: spacing.sm },
  link: { ...typography.body, color: colors.accent, fontWeight: "600", marginTop: spacing.xs, borderRadius: radius.sm },
});
