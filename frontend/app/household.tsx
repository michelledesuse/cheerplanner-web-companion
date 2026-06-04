import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Share, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

type Member = { id: string; email: string; name?: string | null };

export default function HouseholdScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/household");
      setMembers(r.data.members || []);
    } catch (_e) {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
              {members.map((m, i) => (
                <View key={m.id} style={[styles.memberRow, i > 0 && styles.memberDivider]}>
                  <View style={styles.memberDot}>
                    <Text style={styles.memberDotText}>{(m.name || m.email)[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.memberName}>{m.name || m.email.split("@")[0]}</Text>
                    <Text style={styles.memberMeta}>{m.email}{m.id === user?.id ? "  •  you" : ""}</Text>
                  </View>
                </View>
              ))}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  intro: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  sectionHead: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  memberDivider: { borderTopWidth: 1, borderTopColor: colors.border },
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
