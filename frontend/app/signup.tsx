import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function SignupScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [show, setShow] = useState(false);

  const handle = async () => {
    if (!email || !password) {
      Alert.alert("Missing info", "Please enter email and password.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await signUp(email.trim(), password, name.trim() || undefined);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Could not create your account.";
      Alert.alert("Signup failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="signup-back">
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.heading}>Create your account</Text>
          <Text style={styles.sub}>Start tracking your cheer family today.</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Your name (optional)</Text>
            <TextInput
              testID="signup-name-input"
              style={styles.input}
              placeholder="e.g. Jamie"
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="signup-email-input"
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
                testID="signup-password-input"
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                secureTextEntry={!show}
                placeholder="At least 6 characters"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShow((s) => !s)} style={styles.eye} testID="signup-toggle-password">
                <Ionicons name={show ? "eye-off" : "eye"} size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              testID="signup-submit-button"
              style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
              onPress={handle}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.primaryBtnText}>Create account</Text>}
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <Link href="/login" asChild>
                <TouchableOpacity testID="signup-go-login">
                  <Text style={styles.linkText}>Sign in</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: spacing.lg },
  backBtn: {
    width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
  },
  heading: { ...typography.display, color: colors.textPrimary },
  sub: { ...typography.body, color: colors.textSecondary, marginTop: 6, marginBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  pwWrap: { flexDirection: "row", alignItems: "center", position: "relative" },
  eye: { position: "absolute", right: 12, height: "100%", justifyContent: "center" },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  primaryBtnText: { color: colors.primaryText, fontSize: 16, fontWeight: "700" },
  footerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: spacing.lg },
  footerText: { ...typography.body, color: colors.textSecondary },
  linkText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
});
