import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

/**
 * Reset password screen.
 *
 * This screen is the deep-link target for password reset emails. The email
 * sends users to `cheerplanner://reset?token=...` (native) or
 * `https://cheer-planner.com/reset?token=...` (web fallback). Both URLs land
 * here via expo-router's automatic /reset route.
 */
export default function ResetPasswordScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      // No token? Bounce to forgot-password so the user can request a new link.
      const t = setTimeout(() => router.replace("/forgot-password"), 100);
      return () => clearTimeout(t);
    }
  }, [token, router]);

  const submit = async () => {
    setError(null);
    if (!token) return;
    if (pw.length < 6) {
      setError("Password too short — please use at least 6 characters.");
      Alert.alert("Password too short", "Please use at least 6 characters.");
      return;
    }
    if (pw !== confirm) {
      setError("Passwords don't match — make sure both fields are identical.");
      Alert.alert("Passwords don't match", "Make sure both fields are identical.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pw });
      setDone(true);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Reset failed. The link may have expired.";
      setError(String(msg));
      Alert.alert("Reset failed", String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            {done ? (
              <>
                <View style={[styles.iconBubble, { backgroundColor: "#DCFCE7" }]}>
                  <Ionicons name="checkmark-circle" size={32} color="#16A34A" />
                </View>
                <Text style={styles.title}>Password updated</Text>
                <Text style={styles.subtitle}>
                  Your password has been changed. You can now sign in with your new password.
                </Text>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.replace("/login")}
                  testID="reset-back-to-login"
                >
                  <Text style={styles.primaryBtnText}>Sign in</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.iconBubble}>
                  <Ionicons name="lock-open-outline" size={28} color={colors.accent} />
                </View>
                <Text style={styles.title}>Set a new password</Text>
                <Text style={styles.subtitle}>
                  Pick a password you'll remember. We recommend at least 8 characters with a mix of letters and numbers.
                </Text>

                <Text style={styles.label}>New password</Text>
                <View style={styles.pwWrap}>
                  <TextInput
                    testID="reset-pw-input"
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    secureTextEntry={!show}
                    placeholder="At least 6 characters"
                    placeholderTextColor={colors.textTertiary}
                    value={pw}
                    onChangeText={setPw}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={styles.eye} onPress={() => setShow((s) => !s)}>
                    <Ionicons name={show ? "eye-off" : "eye"} size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Confirm new password</Text>
                <TextInput
                  testID="reset-confirm-input"
                  style={styles.input}
                  secureTextEntry={!show}
                  placeholder="Re-enter password"
                  placeholderTextColor={colors.textTertiary}
                  value={confirm}
                  onChangeText={setConfirm}
                  autoCapitalize="none"
                />

                {error ? (
                  <View style={styles.errorBox} testID="reset-error">
                    <Ionicons name="alert-circle" size={16} color="#B91C1C" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  testID="reset-submit"
                  style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
                  onPress={submit}
                  disabled={submitting || !token}
                >
                  {submitting ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>Update password</Text>}
                </TouchableOpacity>

                <View style={styles.footerRow}>
                  <Link href="/login" asChild>
                    <TouchableOpacity><Text style={styles.linkText}>Back to sign in</Text></TouchableOpacity>
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
  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  pwWrap: { flexDirection: "row", alignItems: "center", position: "relative", marginBottom: spacing.sm },
  eye: { position: "absolute", right: 12, height: "100%", justifyContent: "center" },
  primaryBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14,
    alignItems: "center", marginTop: spacing.md,
  },
  primaryBtnText: { color: colors.primaryText, fontSize: 16, fontWeight: "700" },
  errorBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA",
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: spacing.sm,
  },
  errorText: { color: "#B91C1C", fontSize: 13, flex: 1, lineHeight: 18 },
  footerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: spacing.lg },
  linkText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
});
