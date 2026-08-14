import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Share, KeyboardAvoidingView, Platform, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type MemberPrivacy = { expenses: boolean; travel: boolean };
type Member = { id: string; email: string; name?: string | null; is_owner?: boolean; privacy?: MemberPrivacy };

export default function HouseholdScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/household");
      setMembers(r.data.members || []);
      setIsOwner(!!r.data.is_owner);
    } catch (_e) {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRealtimeRefetch(load);

  const togglePrivacy = async (memberId: string, area: keyof MemberPrivacy, next: boolean) => {
    setMembers((prev) => prev.map((m) => m.id === memberId
      ? { ...m, privacy: { expenses: true, travel: true, ...(m.privacy || {}), [area]: next } }
      : m));
    setSavingPrivacy(`${memberId}:${area}`);
    try {
      await api.patch(`/household/privacy/${memberId}`, { [area]: next });
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not update privacy");
      await load();
    } finally { setSavingPrivacy(null); }
  };

  const applyPreset = async (memberId: string, preset: "kids" | "full") => {
    const next = preset === "kids"
      ? { expenses: false, travel: true }
      : { expenses: true, travel: true };
    setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, privacy: { ...next } } : m));
    setSavingPrivacy(`${memberId}:preset`);
    try {
      await api.patch(`/household/privacy/${memberId}`, next);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not update privacy");
      await load();
    } finally { setSavingPrivacy(null); }
  };

  const generateInvite = async () => {
    setGenerating(true);
    try {
      const r = await api.post("/household/invite", {});
      setInvite(r.data);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not generate invite");
    } finally { setGenerating(false); }
  };

  const shareInvite = async () => {
    if (!invite) return;
    try {
      await Share.share({
        message: `Join my CheerPlanner household with this invite code: ${invite.code}\n\nThis code expires in 7 days.`,
      });
    } catch (_e) {}
  };

  const submitJoin = async () => {
    const c = joinCode.trim().toUpperCase();
    if (!c) { Alert.alert("Missing", "Enter an invite code"); return; }
    setJoining(true);
    try {
      await api.post("/household/join", { code: c });
      setJoinCode("");
      Alert.alert("Success", "You've joined the household. Pull to refresh your data.");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not join");
    } finally { setJoining(false); }
  };

  const leaveHousehold = async () => {
    Alert.alert(
      "Leave household?",
      "You will no longer see shared data. A new solo household will be created for you. Your existing data stays with the remaining members.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            try {
              await api.post("/household/leave", {});
              Alert.alert("Left", "You've left the household.");
              load();
            } catch (_e) { Alert.alert("Error", "Could not leave"); }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="household-back">
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Household</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            Share CheerPlanner data with another parent or guardian. Members in the same household see and edit the same athletes, expenses, payments, competitions, and fundraisers.
          </Text>

          {/* Members list */}
          <Text style={styles.sectionHead}>Members ({members.length})</Text>
          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
          ) : (
            <View style={styles.card}>
              {members.map((m, i) => {
                const showPrivacy = isOwner && !m.is_owner && m.id !== user?.id;
                const priv = m.privacy || { expenses: true, travel: true };
                return (
                <View key={m.id} style={[i > 0 && styles.memberDivider]}>
                  <View style={styles.memberRow}>
                    <View style={styles.memberDot}>
                      <Text style={styles.memberDotText}>{(m.name || m.email)[0].toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={styles.memberName}>{m.name || m.email.split("@")[0]}{m.is_owner ? "  •  owner" : ""}</Text>
                      <Text style={styles.memberMeta}>{m.email}{m.id === user?.id ? "  •  you" : ""}</Text>
                    </View>
                  </View>
                  {showPrivacy && (
                    <View style={styles.privacyBox}>
                      <Text style={styles.privacyHead}>What {(m.name || m.email.split("@")[0])} can see</Text>
                      <View style={styles.presetRow}>
                        <TouchableOpacity
                          style={[styles.presetBtn, !priv.expenses && priv.travel !== false && styles.presetBtnActive]}
                          onPress={() => applyPreset(m.id, "kids")}
                          disabled={savingPrivacy === `${m.id}:preset`}
                          testID={`preset-kids-${m.id}`}
                        >
                          <Ionicons name="happy-outline" size={15} color={!priv.expenses && priv.travel !== false ? "#fff" : colors.accent} />
                          <Text style={[styles.presetText, !priv.expenses && priv.travel !== false && styles.presetTextActive]}>Kids (no finances)</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.presetBtn, priv.expenses !== false && priv.travel !== false && styles.presetBtnActive]}
                          onPress={() => applyPreset(m.id, "full")}
                          disabled={savingPrivacy === `${m.id}:preset`}
                          testID={`preset-full-${m.id}`}
                        >
                          <Ionicons name="checkmark-circle-outline" size={15} color={priv.expenses !== false && priv.travel !== false ? "#fff" : colors.accent} />
                          <Text style={[styles.presetText, priv.expenses !== false && priv.travel !== false && styles.presetTextActive]}>Full access</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.privacyRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.privacyLabel}>Expenses & payments</Text>
                        </View>
                        <Switch
                          value={priv.expenses !== false}
                          onValueChange={(v) => togglePrivacy(m.id, "expenses", v)}
                          disabled={savingPrivacy === `${m.id}:expenses`}
                          trackColor={{ true: colors.accent }}
                          testID={`privacy-expenses-${m.id}`}
                        />
                      </View>
                      <View style={styles.privacyRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.privacyLabel}>Travel & bookings</Text>
                        </View>
                        <Switch
                          value={priv.travel !== false}
                          onValueChange={(v) => togglePrivacy(m.id, "travel", v)}
                          disabled={savingPrivacy === `${m.id}:travel`}
                          trackColor={{ true: colors.accent }}
                          testID={`privacy-travel-${m.id}`}
                        />
                      </View>
                      <Text style={styles.privacyHint}>Kids preset hides finances but keeps schedule &amp; travel. Or fine-tune with the switches above.</Text>
                    </View>
                  )}
                </View>
              );
              })}
            </View>
          )}

          {/* Invite section */}
          <Text style={styles.sectionHead}>Invite someone</Text>
          {invite ? (
            <View style={styles.card}>
              <Text style={styles.label}>Your invite code</Text>
              <Text style={styles.codeText} selectable testID="invite-code">{invite.code}</Text>
              <Text style={styles.codeMeta}>Expires {new Date(invite.expires_at).toLocaleDateString()}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={shareInvite} style={[styles.primaryBtn, { flex: 1 }]}>
                  <Ionicons name="share-outline" size={16} color="white" />
                  <Text style={styles.primaryBtnText}>Share code</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={generateInvite} style={[styles.secondaryBtn, { flex: 1 }]}>
                  <Text style={styles.secondaryBtnText}>New code</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={generateInvite} disabled={generating} testID="generate-invite">
              {generating ? <ActivityIndicator color="white" /> : (
                <>
                  <Ionicons name="add-circle-outline" size={16} color="white" />
                  <Text style={styles.primaryBtnText}>Generate invite code</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Join section */}
          <Text style={styles.sectionHead}>Join a household</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Have an invite code?</Text>
            <TextInput
              style={styles.input}
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
              placeholder="6-character code (e.g. AB12CD)"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              testID="join-code-input"
            />
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: spacing.sm }, joining && { opacity: 0.7 }]} onPress={submitJoin} disabled={joining} testID="join-submit">
              {joining ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>Join household</Text>}
            </TouchableOpacity>
          </View>

          {/* Leave */}
          {members.length > 1 && (
            <TouchableOpacity onPress={leaveHousehold} style={styles.leaveBtn} testID="leave-household">
              <Ionicons name="exit-outline" size={16} color={colors.dangerText} />
              <Text style={styles.leaveBtnText}>Leave household</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  intro: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  sectionHead: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  memberDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  privacyBox: { backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm, marginLeft: 50 },
  privacyHead: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", marginBottom: 4 },
  presetRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  presetBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.card },
  presetBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  presetText: { ...typography.caption, color: colors.accent, fontWeight: "700" },
  presetTextActive: { color: "#fff" },
  privacyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  privacyLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  privacyHint: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  memberDot: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  memberDotText: { color: "white", fontWeight: "800", fontSize: 14 },
  memberName: { ...typography.bodyMedium, color: colors.textPrimary },
  memberMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 6 },
  codeText: { fontSize: 32, fontWeight: "900", color: colors.accent, letterSpacing: 4, marginVertical: 4, textAlign: "center" },
  codeMeta: { ...typography.caption, color: colors.textTertiary, textAlign: "center" },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, color: colors.textPrimary, letterSpacing: 2, textAlign: "center", fontWeight: "700" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.accent, paddingVertical: 12, borderRadius: radius.md },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  secondaryBtnText: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  leaveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.xl, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerText },
  leaveBtnText: { color: colors.dangerText, fontWeight: "700", fontSize: 14 },
});
