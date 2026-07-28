import React from "react";
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }[] = [
  { icon: "people", title: "Athletes & Household", desc: "Keep every athlete's details in one place and share with your household." },
  { icon: "wallet", title: "Expenses & Payments", desc: "Track cheer costs, dues, and who's paid — no more spreadsheets." },
  { icon: "trophy", title: "Competitions & Travel", desc: "Comp dates, locations, and travel deadlines, organized." },
  { icon: "calendar", title: "Schedule & Calendar", desc: "Practices, events, and reminders so nothing slips." },
  { icon: "ribbon", title: "Team Hub", desc: "Coaches & reps manage roster, sizes, paperwork, sign-ups & payments." },
  { icon: "notifications", title: "Smart Reminders", desc: "In-app and optional SMS reminders for the deadlines that matter." },
];

/** Public marketing homepage shown to logged-out web visitors. */
export default function MarketingHome() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Top bar */}
      <View style={styles.nav}>
        <View style={styles.brandRow}>
          <View style={styles.logoDot}><Ionicons name="sparkles" size={18} color="white" /></View>
          <Text style={styles.brand}>CheerPlanner</Text>
        </View>
        <View style={styles.navRight}>
          <TouchableOpacity onPress={() => router.push("/login" as any)} testID="home-signin"><Text style={styles.navLink}>Sign in</Text></TouchableOpacity>
          <TouchableOpacity style={styles.navCta} onPress={() => router.push("/signup" as any)} testID="home-signup"><Text style={styles.navCtaText}>Get started</Text></TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ alignItems: "center", paddingBottom: 60 }} testID="marketing-home">
        {/* Hero */}
        <View style={[styles.hero, { maxWidth: 900 }]}>
          <Text style={styles.heroTitle}>Cheer life, finally organized.</Text>
          <Text style={styles.heroSub}>CheerPlanner keeps your athletes, expenses, competitions, schedules, and team details in one place — for cheer parents and coaches alike.</Text>
          <View style={[styles.heroBtns, wide && { flexDirection: "row" }]}>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/signup" as any)} testID="hero-signup">
              <Text style={styles.primaryBtnText}>Create free account</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => Linking.openURL("https://apps.apple.com/")} testID="hero-appstore">
              <Ionicons name="logo-apple" size={18} color={styles._text.color} />
              <Text style={styles.secondaryBtnText}>Download on the App Store</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Features */}
        <View style={[styles.featuresWrap, { maxWidth: 1000 }]}>
          {FEATURES.map((f) => (
            <View key={f.title} style={[styles.featureCard, wide && { width: "31%" }]}>
              <View style={styles.featIcon}><Ionicons name={f.icon} size={22} color={styles._accent.color} /></View>
              <Text style={styles.featTitle}>{f.title}</Text>
              <Text style={styles.featDesc}>{f.desc}</Text>
            </View>
          ))}
        </View>

        {/* Secondary CTA */}
        <View style={[styles.ctaBand, { maxWidth: 900 }]}>
          <Text style={styles.ctaTitle}>Ready to get organized?</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/signup" as any)}>
            <Text style={styles.primaryBtnText}>Start free</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/redeem" as any)} style={{ marginTop: spacing.md }} testID="home-redeem">
            <Text style={styles.redeemLink}>Have a Lifetime Premium code? Redeem it</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={[styles.footer, { maxWidth: 1000 }]}>
          <TouchableOpacity onPress={() => router.push("/privacy" as any)}><Text style={styles.footerLink}>Privacy Policy</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/text-messaging-opt-in" as any)}><Text style={styles.footerLink}>Text Messaging Opt-In</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/contact" as any)}><Text style={styles.footerLink}>Contact Us</Text></TouchableOpacity>
        </View>
        <Text style={styles.copyright}>© {new Date().getFullYear()} CheerPlanner. All rights reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  _text: { color: c.textPrimary },
  _accent: { color: c.primary },
  safe: { flex: 1, backgroundColor: c.bg },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSoft, backgroundColor: c.card },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoDot: { width: 30, height: 30, borderRadius: 9, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  brand: { ...typography.h3, color: c.textPrimary, fontWeight: "800" },
  navRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  navLink: { ...typography.bodyMedium, color: c.textPrimary },
  navCta: { backgroundColor: c.primary, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 9 },
  navCtaText: { color: "white", fontWeight: "700" },
  hero: { width: "100%", paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xl, alignItems: "center" },
  heroTitle: { fontSize: 40, lineHeight: 46, fontWeight: "800", color: c.textPrimary, textAlign: "center" },
  heroSub: { ...typography.body, fontSize: 17, lineHeight: 25, color: c.textSecondary, textAlign: "center", marginTop: spacing.md, maxWidth: 620 },
  heroBtns: { marginTop: spacing.xl, gap: spacing.md, alignItems: "center" },
  primaryBtn: { backgroundColor: c.primary, borderRadius: radius.md, paddingHorizontal: 26, paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { color: "white", fontWeight: "800", fontSize: 16 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 22, paddingVertical: 13 },
  secondaryBtnText: { color: c.textPrimary, fontWeight: "700" },
  featuresWrap: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  featureCard: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, width: "100%", minWidth: 240 },
  featIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.primarySoft || c.bg, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  featTitle: { ...typography.h3, color: c.textPrimary },
  featDesc: { ...typography.body, color: c.textSecondary, marginTop: 4, lineHeight: 20 },
  ctaBand: { width: "100%", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.xxl, marginTop: spacing.xl },
  ctaTitle: { ...typography.h1, color: c.textPrimary, textAlign: "center", marginBottom: spacing.lg },
  redeemLink: { ...typography.bodyMedium, color: c.primary },
  footer: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: c.borderSoft },
  footerLink: { ...typography.bodyMedium, color: c.primary },
  copyright: { ...typography.caption, color: c.textTertiary, marginTop: spacing.md },
});
