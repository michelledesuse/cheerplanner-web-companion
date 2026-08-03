import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

export default function ForgotPasswordScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      Alert.alert("Enter your email", "Please enter the email you signed up with.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (e: any) {
      // We intentionally don't surface 404s; backend always returns 200.
      const msg = e?.response?.data?.detail || "Something went wrong. Try again.";
      Alert.alert("Couldn't send email", String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="forgot-back">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            {sent ? (
              <>
                <View style={styles.iconBubble}>
                  <Ionicons name="mail-outline" size={28} color={colors.accent} />
                </View>
                <Text style={styles.title}>Check your email</Text>
                <Text style={styles.subtitle}>
                  If an account exists for {email.trim().toLowerCase()}, we just sent a password reset link.
                  Open it on your phone to reset your password. The link expires in 30 minutes.
                </Text>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.replace("/login")}
                  testID="forgot-back-to-login"
                >
                  <Text style={styles.primaryBtnText}>Back to sign in</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() => { setSent(false); }}
                >
                  <Text style={styles.linkBtnText}>Use a different email</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.iconBubble}>
                  <Ionicons name="lock-closed-outline" size={28} color={colors.accent} />
                </View>
                <Text style={styles.title}>Forgot password?</Text>
                <Text style={styles.subtitle}>
                  Enter the email you used to sign up. We'll email you a secure link to reset your password.
                </Text>

                <Text style={styles.label}>Email</Text>
                <TextInput
                  testID="forgot-email-input"
                  style={styles.input}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  placeholder="parent@example.com"
                  placeholderTextColor={colors.textTertiary}
                  value={email}
                  onChangeText={setEmail}
                />

                <TouchableOpacity
                  testID="forgot-submit"
                  style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
                  onPress={submit}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  {submitting ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>Send reset link</Text>}
                </TouchableOpacity>

                <View style={styles.footerRow}>
                  <Text style={styles.footerText}>Remember it? </Text>
                  <Link href="/login" asChild>
                    <TouchableOpacity testID="forgot-go-login">
                      <Text style={styles.linkText}>Sign in</Text>
                    </TouchableOpacity>
                  </Link>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: "center" },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: spacing.lg, alignSelf: "flex-start" },
  backText: { ...typography.body, color: colors.textPrimary, marginLeft: 4 },
  card: {
    backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border,
  },
  iconBubble: {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: colors.accentSubtle, alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg, alignSelf: "flex-start",
  },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 6, marginBottom: spacing.lg, lineHeight: 21 },
  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: colors.textPrimary, marginBottom: spacing.md,
  },
  primaryBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14,
    alignItems: "center", marginTop: spacing.sm,
  },
  primaryBtnText: { color: colors.primaryText, fontSize: 16, fontWeight: "700" },
  linkBtn: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  linkBtnText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  footerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: spacing.lg },
  footerText: { ...typography.body, color: colors.textSecondary },
  linkText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
});
