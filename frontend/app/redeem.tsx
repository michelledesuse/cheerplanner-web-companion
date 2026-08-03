import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { usePremium } from "@/src/context/PremiumContext";
import { track } from "@/src/lib/analytics";
import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

/**
 * Lifetime Premium code redemption — the Apple-compliant WEB portal.
 * Beta testers sign into CheerPlanner on the web, enter their code, and the
 * backend grants a household-bound Lifetime entitlement. On sign-in in the
 * mobile app their Premium unlocks automatically. (Not shown on iOS in-app.)
 */
export default function RedeemScreen() {
  const { user } = useAuth();
  const { refresh } = usePremium();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onRedeem = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post("/premium/redeem", { code: code.trim() });
      await refresh();
      track("code_redeemed");
      setMsg({ ok: true, text: "Success! Lifetime Premium Access is now active on your account." });
      setCode("");
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || "Invalid or already-used code." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={styles._icon.color} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Redeem Code</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }} testID="redeem-screen">
        <Ionicons name="gift" size={40} color="#F59E0B" style={{ alignSelf: "center", marginVertical: spacing.md }} />
        <Text style={styles.title}>Lifetime Premium Access</Text>
        <Text style={styles.blurb}>
          {user ? `Signed in as ${user.email}. ` : ""}Enter your Lifetime Premium Access code below. It unlocks full CheerPlanner Premium for your household — permanently, at no cost.
        </Text>

        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="ENTER CODE"
          placeholderTextColor={styles._muted.color}
          autoCapitalize="characters"
          autoCorrect={false}
          testID="redeem-input"
        />

        {msg ? (
          <View style={[styles.msg, msg.ok ? styles.msgOk : styles.msgErr]}>
            <Ionicons name={msg.ok ? "checkmark-circle" : "alert-circle"} size={18} color={msg.ok ? "#16A34A" : "#DC2626"} />
            <Text style={styles.msgText}>{msg.text}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={[styles.cta, busy && { opacity: 0.7 }]} onPress={onRedeem} disabled={busy} testID="redeem-submit">
          {busy ? <ActivityIndicator color="white" /> : <Text style={styles.ctaText}>Redeem</Text>}
        </TouchableOpacity>

        {msg?.ok ? (
          <TouchableOpacity style={styles.doneRow} onPress={() => router.replace("/premium" as any)}>
            <Text style={styles.doneText}>View my plan</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  _icon: { color: c.textPrimary },
  _muted: { color: c.textSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  headerTitle: { ...typography.h3, color: c.textPrimary },
  title: { ...typography.h2, color: c.textPrimary, textAlign: "center" },
  blurb: { ...typography.body, color: c.textSecondary, textAlign: "center", lineHeight: 20, marginTop: spacing.sm, marginBottom: spacing.lg },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 18, letterSpacing: 2, textAlign: "center", color: c.textPrimary, fontWeight: "700" },
  msg: { flexDirection: "row", gap: 8, alignItems: "center", padding: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
  msgOk: { backgroundColor: "#DCFCE7" },
  msgErr: { backgroundColor: "#FEE2E2" },
  msgText: { flex: 1, ...typography.caption, color: "#1F2937" },
  cta: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: spacing.lg },
  ctaText: { color: "white", fontWeight: "800", fontSize: 16 },
  doneRow: { alignItems: "center", padding: spacing.md, marginTop: spacing.sm },
  doneText: { ...typography.bodyMedium, color: c.primary },
});
