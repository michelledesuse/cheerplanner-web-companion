import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { usePremium } from "@/src/context/PremiumContext";
import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

function Stat({ label, value, styles }: { label: string; value: number; styles: any }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value ?? 0}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AdminScreen() {
  const { user } = useAuth();
  const { refresh: refreshPremium } = usePremium();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [genCount, setGenCount] = useState("5");
  const [genLabel, setGenLabel] = useState("Beta Tester 2026");
  const [generated, setGenerated] = useState<any[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [selfPremium, setSelfPremium] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<any>(null);

  const loadCodes = useCallback(async () => {
    try { const r = await api.get("/admin/codes"); setCodes(r.data.codes || []); } catch {}
  }, []);
  const loadSelf = useCallback(async () => {
    try { const r = await api.get("/premium/status"); setSelfPremium(!!r.data.is_premium); } catch {}
  }, []);
  const loadSummary = useCallback(async () => {
    try { const r = await api.get("/analytics/summary"); setSummary(r.data); } catch {}
  }, []);

  useFocusEffect(useCallback(() => { if (user?.is_admin) { loadCodes(); loadSelf(); loadSummary(); } }, [user, loadCodes, loadSelf, loadSummary]));

  if (!user?.is_admin) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><Text style={styles.muted}>Not authorized.</Text></View>
      </SafeAreaView>
    );
  }

  const doSearch = async () => {
    setSearching(true);
    try { const r = await api.get(`/admin/users/search?q=${encodeURIComponent(q)}`); setResults(r.data.results || []); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Search failed"); }
    finally { setSearching(false); }
  };

  const grantLifetime = async (row: any) => {
    try {
      await api.post("/admin/lifetime/grant", { user_id: row.user_id, reason: genLabel, label: genLabel });
      Alert.alert("Granted", `Lifetime Premium granted to ${row.email}`);
      doSearch();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Grant failed"); }
  };

  const generate = async () => {
    try {
      const r = await api.post("/admin/codes/generate", { count: parseInt(genCount) || 1, label: genLabel });
      setGenerated(r.data.created || []);
      loadCodes();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Generate failed"); }
  };

  const copyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    if (Platform.OS !== "web") Alert.alert("Copied", code);
  };

  const disableCode = async (id: string) => {
    try { await api.post(`/admin/codes/${id}/disable`); loadCodes(); } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Failed"); }
  };

  const toggleSelf = async () => {
    try {
      await api.post("/admin/self-premium-toggle", { enabled: !selfPremium });
      await loadSelf();
      await refreshPremium();
    } catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Failed"); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={styles._icon.color} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Admin</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} testID="admin-screen">
        {/* Analytics snapshot */}
        {summary ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Premium analytics</Text>
            <View style={styles.statGrid}>
              <Stat label="Premium households" value={summary.premium_households} styles={styles} />
              <Stat label="Lifetime active" value={summary.lifetime_active} styles={styles} />
              <Stat label="Subs active" value={summary.subscriptions_active} styles={styles} />
              <Stat label="Codes redeemed" value={summary.codes_redeemed} styles={styles} />
              <Stat label="Paywall views" value={summary.events?.paywall_view || 0} styles={styles} />
              <Stat label="Upgrade taps" value={summary.events?.upgrade_tap || 0} styles={styles} />
            </View>
            {summary.feature_gate_hits && Object.keys(summary.feature_gate_hits).length > 0 ? (
              <>
                <Text style={[styles.muted, { marginTop: spacing.sm }]}>Top locked features tapped:</Text>
                {Object.entries(summary.feature_gate_hits).slice(0, 5).map(([f, n]: any) => (
                  <Text key={f} style={styles.body}>• {f}: {n}</Text>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        {/* Self premium test toggle */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Testing</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.body}>My household Premium: <Text style={styles.bold}>{selfPremium == null ? "…" : selfPremium ? "ON" : "OFF"}</Text></Text>
            <TouchableOpacity style={styles.smallBtn} onPress={toggleSelf} testID="admin-self-toggle">
              <Text style={styles.smallBtnText}>{selfPremium ? "Turn off" : "Turn on"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Generate codes */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Generate Lifetime codes</Text>
          <View style={styles.inlineRow}>
            <TextInput style={[styles.input, { width: 70 }]} value={genCount} onChangeText={setGenCount} keyboardType="number-pad" placeholder="#" placeholderTextColor={styles._muted.color} />
            <TextInput style={[styles.input, { flex: 1 }]} value={genLabel} onChangeText={setGenLabel} placeholder="Label (e.g. Beta Tester 2026)" placeholderTextColor={styles._muted.color} />
          </View>
          <TouchableOpacity style={styles.cta} onPress={generate} testID="admin-generate"><Text style={styles.ctaText}>Generate</Text></TouchableOpacity>
          {generated.length > 0 ? (
            <View style={styles.genBox}>
              <Text style={styles.genHint}>Copy these now — codes are stored hashed and can't be shown again:</Text>
              {generated.map((g) => (
                <TouchableOpacity key={g.id} style={styles.genRow} onPress={() => copyCode(g.code)}>
                  <Text style={styles.genCode}>{g.code}</Text>
                  <Ionicons name="copy-outline" size={16} color={styles._icon.color} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        {/* Search + grant */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Find user / grant Lifetime</Text>
          <View style={styles.inlineRow}>
            <TextInput style={[styles.input, { flex: 1 }]} value={q} onChangeText={setQ} placeholder="email or name" placeholderTextColor={styles._muted.color} autoCapitalize="none" onSubmitEditing={doSearch} />
            <TouchableOpacity style={styles.smallBtn} onPress={doSearch} testID="admin-search">{searching ? <ActivityIndicator color="white" /> : <Text style={styles.smallBtnText}>Search</Text>}</TouchableOpacity>
          </View>
          {results.map((r) => (
            <View key={r.user_id} style={styles.resultRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>{r.email}</Text>
                <Text style={styles.muted}>{r.premium?.is_premium ? `Premium · ${r.premium.plan} (${r.premium.source})` : "Free"} · {r.household_member_count} member(s)</Text>
              </View>
              {!r.premium?.is_premium ? (
                <TouchableOpacity style={styles.smallBtn} onPress={() => grantLifetime(r)}><Text style={styles.smallBtnText}>Grant</Text></TouchableOpacity>
              ) : <Ionicons name="checkmark-circle" size={22} color="#16A34A" />}
            </View>
          ))}
        </View>

        {/* Codes list */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Codes ({codes.length})</Text>
          {codes.map((c) => (
            <View key={c.id} style={styles.resultRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>••••{c.last4} · <Text style={styles.muted}>{c.status}</Text></Text>
                <Text style={styles.muted}>{c.label || "—"}{c.redeemed_by_email ? ` · ${c.redeemed_by_email}` : ""}</Text>
              </View>
              {c.status === "available" ? (
                <TouchableOpacity onPress={() => disableCode(c.id)}><Text style={styles.disableText}>Disable</Text></TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  _icon: { color: c.textPrimary },
  _muted: { color: c.textSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  headerTitle: { ...typography.h3, color: c.textPrimary },
  card: { backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg },
  cardTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.md },
  body: { ...typography.body, color: c.textPrimary },
  bold: { fontWeight: "800" },
  muted: { ...typography.caption, color: c.textSecondary },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inlineRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: c.textPrimary, fontSize: 15 },
  cta: { backgroundColor: c.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: "white", fontWeight: "700" },
  smallBtn: { backgroundColor: c.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  smallBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.borderSoft },
  genBox: { marginTop: spacing.md, backgroundColor: c.bg, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  genHint: { ...typography.caption, color: c.textSecondary, marginBottom: spacing.sm },
  genRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  genCode: { ...typography.bodyMedium, color: c.textPrimary, letterSpacing: 1, fontWeight: "700" },
  disableText: { ...typography.caption, color: "#DC2626", fontWeight: "700" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { width: "47%", backgroundColor: c.bg, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  statValue: { ...typography.h2, color: c.textPrimary },
  statLabel: { ...typography.caption, color: c.textSecondary },
});
