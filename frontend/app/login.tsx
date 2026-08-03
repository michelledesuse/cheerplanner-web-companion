import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Image, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

export default function LoginScreen() {
  const styles = useThemedStyles(makeStyles);
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    if (!email || !password) {
      Alert.alert("Missing info", "Please enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Login failed. Please try again.";
      Alert.alert("Login failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <Image
              source={require("../assets/images/cheerplanner-logo.png")}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityLabel="CheerPlanner — On-The-Go Season Organizer"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your parent account</Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="login-email-input"
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="parent@example.com"
              placeholderTextColor={colors.textTertiary}
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.pwWrap}>
              <TextInput
                testID="login-password-input"
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                secureTextEntry={!show}
                placeholder="••••••••"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                onPress={() => setShow((s) => !s)}
                style={styles.eye}
                testID="login-toggle-password"
              >
                <Ionicons name={show ? "eye-off" : "eye"} size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              testID="login-submit-button"
              style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
              onPress={handle}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.primaryBtnText}>Sign in</Text>
              )}
            </TouchableOpacity>

            <Link href="/forgot-password" asChild>
              <TouchableOpacity style={styles.forgotBtn} testID="login-forgot-password">
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            </Link>

            <View style={styles.footerRow}>
              <Text style={styles.footerText}>New here? </Text>
              <Link href="/signup" asChild>
                <TouchableOpacity testID="login-go-signup">
                  <Text style={styles.linkText}>Create account</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: spacing.xl },
  logoImage: { width: 200, height: 200, maxWidth: "85%" },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  brandName: { ...typography.h1, color: colors.textPrimary },
  tagline: { ...typography.body, color: colors.textSecondary, marginTop: 4, textAlign: "center" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  pwWrap: { flexDirection: "row", alignItems: "center", position: "relative" },
  eye: { position: "absolute", right: 12, height: "100%", justifyContent: "center" },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryBtnText: { color: colors.primaryText, fontSize: 16, fontWeight: "700" },
  forgotBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  forgotText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  footerText: { ...typography.body, color: colors.textSecondary },
  linkText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
});
