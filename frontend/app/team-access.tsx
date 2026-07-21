import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Share, Switch, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Member = { id: string; email: string; name?: string | null; team_access: boolean; is_owner: boolean };
type Invite = { id: string; email?: string | null; code: string; expires_at: string };
type AccessData = { is_owner: boolean; owner_user_id: string; members: Member[]; invites: Invite[] };

export default function TeamAccessScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { user, refreshUser } = useAuth();
  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<AccessData>("/team-access");
      setData(r.data);
    } catch (_e) {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleMember = async (m: Member, val: boolean) => {
    setBusyId(m.id);
    try {
      await api.patch(`/team-access/members/${m.id}`, { enabled: val });
      await load();
      if (m.id === user?.id) await refreshUser(); // own access changed → refresh Team tab gate
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not update access.");
    } finally { setBusyId(null); }
  };

  const sendInvite = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { Alert.alert("Enter an email", "Add the person's email to invite them."); return; }
    setInviting(true);
    try {
      const r = await api.post<{ granted?: boolean; invited?: boolean; code?: string }>("/team-access/invite", { email: e });
      setEmail("");
      await load();
      if (r.data.granted) {
        Alert.alert("Access granted", "That household member now has Team Hub access.");
      } else if (r.data.invited && r.data.code) {
        Alert.alert("Invite created", `Share code ${r.data.code} with them. When they join, they'll get Team Hub access.`);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not send invite.");
    } finally { setInviting(false); }
  };

  const shareInvite = async (inv: Invite) => {
    try {
      await Share.share({
        message: `Join my CheerPlanner Team Hub with invite code: ${inv.code}\n\nSign up (or log in), then enter this code under Settings → Invite Family Members → Join. Expires in 7 days.`,
      });
    } catch (_e) {}
  };

  const revokeInvite = (inv: Invite) => {
    Alert.alert("Revoke invite?", `The code for ${inv.email || "this person"} will stop working.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => {
        try { await api.delete(`/team-access/invite/${inv.id}`); await load(); }
        catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not revoke."); }
      } },
    ]);
  };

  const owner = data?.members.find((m) => m.is_owner);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="team-access-back">
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Team Hub Access</Text>
          <View style={{ width: 36 }} />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : !data?.is_owner ? (
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} testID="team-access-screen">
            <View style={styles.card}>
              <View style={[styles.statusIcon, { backgroundColor: colors.accentSubtle }]}>
                <Ionicons name={data?.members.find((m) => m.id === user?.id)?.team_access ? "checkmark-circle-outline" : "lock-closed-outline"} size={26} color={colors.accent} />
              </View>
              <Text style={styles.statusTitle}>
                {data?.members.find((m) => m.id === user?.id)?.team_access ? "You have Team Hub access" : "You don't have Team Hub access"}
              </Text>
              <Text style={styles.statusText}>
                Team Hub access is managed by the account owner{owner ? `, ${owner.name || owner.email}` : ""}. Ask them to grant you access.
              </Text>
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled" testID="team-access-screen">
            <Text style={styles.intro}>
              As the account owner, you decide who can open the Team Hub (roster, sizes, payments, paperwork &amp; sign-ups). Grant it to people in your household, or invite someone new by email.
            </Text>

            <Text style={styles.sectionHead}>Household members</Text>
            <View style={styles.card}>
              {data.members.map((m, i) => (
                <View key={m.id} style={[styles.memberRow, i > 0 && styles.memberDivider]}>
                  <View style={styles.memberDot}>
                    <Text style={styles.memberDotText}>{(m.name || m.email)[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.memberName}>{m.name || m.email.split("@")[0]}{m.is_owner ? "  •  owner" : ""}{m.id === user?.id ? "  •  you" : ""}</Text>
                    <Text style={styles.memberMeta}>{m.email}</Text>
                  </View>
                  {busyId === m.id ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Switch
                      value={m.team_access}
                      onValueChange={(v) => toggleMember(m, v)}
                      trackColor={{ true: colors.accent, false: colors.divider }}
                      testID={`team-access-toggle-${m.id}`}
                    />
                  )}
                </View>
              ))}
            </View>

            <Text style={styles.sectionHead}>Invite by email</Text>
            <View style={styles.card}>
              <Text style={styles.label}>Their email address</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="coach@example.com"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                testID="team-access-invite-email"
              />
              <TouchableOpacity style={[styles.primaryBtn, { marginTop: spacing.sm }, inviting && { opacity: 0.7 }]} onPress={sendInvite} disabled={inviting} testID="team-access-invite-submit">
                {inviting ? <ActivityIndicator color="white" /> : (
                  <>
                    <Ionicons name="mail-outline" size={16} color="white" />
                    <Text style={styles.primaryBtnText}>Invite to Team Hub</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.hint}>If they&apos;re already in your household, they get access instantly. Otherwise you&apos;ll get a code to share.</Text>
            </View>

            {data.invites.length > 0 && (
              <>
                <Text style={styles.sectionHead}>Pending invites</Text>
                <View style={styles.card}>
                  {data.invites.map((inv, i) => (
                    <View key={inv.id} style={[styles.memberRow, i > 0 && styles.memberDivider]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{inv.email || "Invite"}</Text>
                        <Text style={styles.memberMeta}>Code {inv.code} · expires {new Date(inv.expires_at).toLocaleDateString()}</Text>
                      </View>
                      <TouchableOpacity onPress={() => shareInvite(inv)} style={styles.smallBtn} testID={`team-access-invite-share-${inv.id}`}>
                        <Ionicons name="share-outline" size={18} color={colors.accent} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => revokeInvite(inv)} style={styles.smallBtn} testID={`team-access-invite-revoke-${inv.id}`}>
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h3, color: c.textPrimary },
  intro: { ...typography.body, color: c.textSecondary, marginBottom: spacing.md },
  sectionHead: { ...typography.caption, color: c.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  card: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  memberDivider: { borderTopWidth: 1, borderTopColor: c.border },
  memberDot: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  memberDotText: { color: "white", fontWeight: "800", fontSize: 14 },
  memberName: { ...typography.bodyMedium, color: c.textPrimary },
  memberMeta: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  label: { ...typography.caption, color: c.textSecondary, marginBottom: 6 },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.accent, paddingVertical: 12, borderRadius: radius.md },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  hint: { ...typography.caption, color: c.textTertiary, marginTop: spacing.sm },
  smallBtn: { padding: 8, marginLeft: 4 },
  statusIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: spacing.sm },
  statusTitle: { ...typography.h3, color: c.textPrimary, textAlign: "center" },
  statusText: { ...typography.caption, color: c.textSecondary, textAlign: "center", marginTop: 6, lineHeight: 19 },
});
