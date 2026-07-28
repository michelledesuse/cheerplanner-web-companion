import React, { ReactNode } from "react";
import { View, Text, ScrollView, TouchableOpacity, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

/** Shared layout for public/legal pages (privacy, SMS opt-in, contact). */
export default function StaticPage({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const goHome = () => router.replace("/" as any);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goHome} style={styles.brandRow} testID="static-home">
          <View style={styles.logoDot}><Ionicons name="sparkles" size={16} color="white" /></View>
          <Text style={styles.brand}>CheerPlanner</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} testID="static-page">
        <View style={styles.inner}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {children}
          <View style={styles.footer}>
            <TouchableOpacity onPress={() => router.push("/privacy" as any)}><Text style={styles.footerLink}>Privacy</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/text-messaging-opt-in" as any)}><Text style={styles.footerLink}>Text Messaging</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/contact" as any)}><Text style={styles.footerLink}>Contact</Text></TouchableOpacity>
          </View>
          <Text style={styles.copyright}>© {new Date().getFullYear()} CheerPlanner</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Section heading + paragraphs helper for legal copy. */
export function LegalSection({ heading, children }: { heading?: string; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginTop: spacing.lg }}>
      {heading ? <Text style={styles.h2}>{heading}</Text> : null}
      {children}
    </View>
  );
}

export function P({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.p}>{children}</Text>;
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSoft, backgroundColor: c.card },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoDot: { width: 28, height: 28, borderRadius: 9, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  brand: { ...typography.h3, color: c.textPrimary, fontWeight: "800" },
  content: { padding: spacing.lg, alignItems: "center" },
  inner: { width: "100%", maxWidth: 760 },
  title: { ...typography.display, color: c.textPrimary },
  subtitle: { ...typography.body, color: c.textSecondary, marginTop: spacing.xs },
  h2: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.xs },
  p: { ...typography.body, color: c.textSecondary, lineHeight: 22, marginBottom: spacing.sm },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, marginTop: spacing.xxl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: c.borderSoft },
  footerLink: { ...typography.bodyMedium, color: c.primary },
  copyright: { ...typography.caption, color: c.textTertiary, marginTop: spacing.md, marginBottom: spacing.xxl },
});
