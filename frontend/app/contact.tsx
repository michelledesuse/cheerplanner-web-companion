import React from "react";
import { View, Text, TouchableOpacity, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import StaticPage, { LegalSection, P } from "@/src/components/StaticPage";
import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const SUPPORT_EMAIL = "info@cheer-planner.com";

export default function ContactScreen() {
  const styles = useThemedStyles(makeStyles);
  return (
    <StaticPage title="Contact Us" subtitle="We'd love to hear from you">
      <LegalSection>
        <P>Questions, feedback, or need a hand? Reach the CheerPlanner team by email and we'll get back to you as soon as we can.</P>
      </LegalSection>

      <TouchableOpacity
        style={styles.emailCard}
        onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        testID="contact-email"
      >
        <View style={styles.iconWrap}><Ionicons name="mail" size={22} color="white" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.emailLabel}>Email support</Text>
          <Text style={styles.email}>{SUPPORT_EMAIL}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={styles._muted.color} />
      </TouchableOpacity>

      <LegalSection heading="Account & data requests">
        <P>To request access to or deletion of your data, email us from the address on your account. You can also delete your account and all associated data anytime from Settings → Delete Account in the app.</P>
      </LegalSection>
    </StaticPage>
  );
}

const makeStyles = (c: ThemePalette) => ({
  _muted: { color: c.textSecondary },
  emailCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border, marginTop: spacing.lg },
  iconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  emailLabel: { ...typography.caption, color: c.textSecondary },
  email: { ...typography.h3, color: c.textPrimary },
});
