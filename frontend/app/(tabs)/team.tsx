import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import HomeButton from "@/src/components/HomeButton";
import TeamHubSwitcher from "@/src/components/TeamHubSwitcher";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { usePremium } from "@/src/context/PremiumContext";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";
import { api } from "@/src/api/client";

type Tool = {
  key: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string; // set = live; unset = coming soon
};

const TOOLS: Tool[] = [
  { key: "chat", title: "Team Chat", desc: "Message your coaches, reps & staff in one group thread.", icon: "chatbubbles-outline", route: "/team/chat" },
  { key: "roster", title: "Roster", desc: "Team members & contact info in one place.", icon: "people-outline", route: "/team/roster" },
  { key: "payments", title: "Payment Tracking", desc: "Team bonding, gifts, meals & dues — track who's paid.", icon: "cash-outline", route: "/team/payments" },
  { key: "sizes", title: "Sizes", desc: "Uniform, apparel & shoe sizes for each member.", icon: "shirt-outline", route: "/team/sizes" },
  { key: "paperwork", title: "Paperwork / Other", desc: "Waivers, forms & any other check-off items.", icon: "document-text-outline", route: "/team/paperwork" },
  { key: "forms", title: "Team Forms", desc: "Custom forms — meal orders, T-shirt sizes & more. Parents fill via a link.", icon: "clipboard-outline", route: "/team/forms" },
  { key: "signup", title: "Sign-Up Sheet", desc: "Let parents sign up to volunteer or bring items for events.", icon: "hand-left-outline", route: "/team/signups" },
  { key: "attendance", title: "Attendance", desc: "Check off who's present at practices & events.", icon: "checkmark-done-outline", route: "/team/attendance" },
  { key: "todos", title: "To-Do List", desc: "A shared checklist for your team's tasks.", icon: "checkbox-outline", route: "/team/todos" },
  { key: "music", title: "Team Music", desc: "Upload competition mixes & music to share with the team.", icon: "musical-notes-outline", route: "/team/music" },
  { key: "scouting", title: "Scouting Reports", desc: "Track each athlete's skills across Tumbling, Stunting & Jumps.", icon: "ribbon-outline", route: "/team/scouting" },
  { key: "calendar", title: "Calendar", desc: "Schedule practices & events, collect RSVPs from families.", icon: "calendar-outline", route: "/team/calendar" },
  { key: "results", title: "Competition Results", desc: "Log placements & scores and share a season summary.", icon: "trophy-outline", route: "/team/results" },
  { key: "export", title: "Custom Roster Export", desc: "Pick columns (sizes, paperwork, payments) into one downloadable view for a competition.", icon: "download-outline", route: "/team/export" },
];

const PREMIUM_TOOLS = new Set(["payments", "sizes", "paperwork", "export"]);

/**
 * Team Hub — a private workspace for coaches, team reps/managers & staff.
 * Phase C: Roster is live; Gifts & Meals and Waivers arrive next.
 */
export default function TeamScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { gatingActive } = usePremium();
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const [chatAthlete, setChatAthlete] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [scoutReq, setScoutReq] = useState(0);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const unlocked = !!user?.team_access;

  const loadUnread = useCallback(async () => {
    try {
      const r = await api.get<{ unread: number }>("/team/chat/unread");
      setUnread(r.data.unread || 0);
      if (!user?.team_access) setChatAthlete(true); // approved chat participant
    } catch (_e) { setUnread(0); setChatAthlete(false); }
    try {
      const p = await api.get<{ count: number; is_owner: boolean }>("/team/members/pending-count");
      setIsOwner(!!p.data.is_owner); setPendingCount(p.data.count || 0);
    } catch (_e) { /* keep last-known owner state on a transient error */ }
    if (user?.team_access) {
      try {
        const rr = await api.get<{ count: number }>("/team/scouting/review-requests");
        setScoutReq(rr.data.count || 0);
      } catch (_e) { setScoutReq(0); }
    }
  }, [user]);
  useRealtimeRefetch(loadUnread);

  const joinTeam = useCallback(async () => {
    const c = joinCode.trim().toUpperCase();
    if (!c || joining) return;
    setJoining(true);
    try {
      await api.post("/team/join", { code: c });
      setShowJoin(false); setJoinCode("");
      await refreshUser();
      Alert.alert("You're in!", "You've joined the team's group chat. A coach will finish setting up your role.", [
        { text: "Open chat", onPress: () => router.push("/team/chat" as any) },
      ]);
      loadUnread();
    } catch (e: any) {
      Alert.alert("Couldn't join", e?.response?.data?.detail || "Check the code and try again.");
    } finally { setJoining(false); }
  }, [joinCode, joining, refreshUser, router, loadUnread]);

  // Access is per-login: only members who marked themselves as team personnel
  // (Settings → team access) can open the Hub, even in a shared household.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try { await refreshUser(); } finally { if (active) setLoading(false); }
        if (active) loadUnread();
      })();
      return () => { active = false; };
    }, [refreshUser, loadUnread])
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle}>Team Hub</Text>
          <Text style={styles.headerSub} numberOfLines={1}>For coaches, reps & staff</Text>
        </View>
        <HomeButton />
      </View>

      {loading ? (
        <View style={styles.center} testID="team-screen"><ActivityIndicator color={colors.accent} /></View>
      ) : !unlocked ? (
        <ScrollView contentContainerStyle={styles.content} testID="team-screen">
          <View style={styles.lockedCard}>
            <View style={styles.lockedIcon}>
              <Ionicons name="lock-closed-outline" size={26} color={colors.accent} />
            </View>
            <Text style={styles.lockedTitle}>Team Hub is for team personnel</Text>
            <Text style={styles.lockedText}>
              These tools are private to coaches, team reps &amp; staff. The account owner grants Team Hub access — from Settings → Team Hub Access. If you&apos;re the owner, open it to enable access for yourself or invite your staff.
            </Text>
            <TouchableOpacity style={styles.lockedBtn} onPress={() => router.push("/team-access" as any)} testID="team-add-staff">
              <Ionicons name="settings-outline" size={18} color="white" />
              <Text style={styles.lockedBtnText}>Manage access</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatAthleteBtn} onPress={() => setShowJoin(true)} testID="team-join-code">
              <Ionicons name="key-outline" size={18} color={colors.accent} />
              <Text style={styles.chatAthleteText}>Have a team code?</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatAthleteBtn} onPress={() => router.push("/team/scouting" as any)} testID="athlete-open-scouting">
              <Ionicons name="ribbon-outline" size={18} color={colors.accent} />
              <Text style={styles.chatAthleteText}>My Scouting Report</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatAthleteBtn} onPress={() => router.push("/team/calendar" as any)} testID="athlete-open-calendar">
              <Ionicons name="calendar-outline" size={18} color={colors.accent} />
              <Text style={styles.chatAthleteText}>Calendar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatAthleteBtn} onPress={() => router.push("/team/results" as any)} testID="athlete-open-results">
              <Ionicons name="trophy-outline" size={18} color={colors.accent} />
              <Text style={styles.chatAthleteText}>Competition Results</Text>
            </TouchableOpacity>
            {chatAthlete && (
              <TouchableOpacity style={styles.chatAthleteBtn} onPress={() => router.push("/team/chat" as any)} testID="athlete-open-chat">
                <Ionicons name="chatbubbles-outline" size={18} color={colors.accent} />
                <Text style={styles.chatAthleteText}>Open Team Chat</Text>
                {unread > 0 && <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unread > 99 ? "99+" : unread}</Text></View>}
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} testID="team-screen">
          <TeamHubSwitcher />

          {isOwner && (
            <TouchableOpacity style={styles.toolCard} testID="team-tool-members" activeOpacity={0.7} onPress={() => router.push("/team/members" as any)}>
              <View style={styles.toolIcon}>
                <Ionicons name="person-add-outline" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.toolTitleRow}>
                  <Text style={styles.toolTitle}>Members</Text>
                  {pendingCount > 0 && (
                    <View style={styles.unreadBadge} testID="team-members-badge">
                      <Text style={styles.unreadText}>{pendingCount > 99 ? "99+" : pendingCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.toolDesc}>
                  {pendingCount > 0 ? `${pendingCount} new member${pendingCount === 1 ? "" : "s"} to set up` : "Share your team code & assign roles."}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}

          <View style={styles.introCard}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <Text style={styles.introText}>
              A private space for you as team personnel. Access is granted by the account owner — manage who can open the Hub in Settings → Team Hub Access.
            </Text>
          </View>

          {TOOLS.map((t) => {
            const locked = PREMIUM_TOOLS.has(t.key) && gatingActive;
            return (
            <TouchableOpacity
              key={t.key}
              style={styles.toolCard}
              testID={`team-tool-${t.key}`}
              activeOpacity={t.route ? 0.7 : 1}
              disabled={!t.route}
              onPress={() => {
                if (locked) { router.push("/premium" as any); return; }
                t.route && router.push(t.route as any);
              }}
            >
              <View style={styles.toolIcon}>
                <Ionicons name={t.icon} size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.toolTitleRow}>
                  <Text style={styles.toolTitle}>{t.title}</Text>
                  {t.key === "chat" && unread > 0 && (
                    <View style={styles.unreadBadge} testID="team-chat-unread">
                      <Text style={styles.unreadText}>{unread > 99 ? "99+" : unread}</Text>
                    </View>
                  )}
                  {t.key === "scouting" && scoutReq > 0 && (
                    <View style={styles.unreadBadge} testID="team-scouting-badge">
                      <Text style={styles.unreadText}>{scoutReq > 99 ? "99+" : scoutReq}</Text>
                    </View>
                  )}
                  {!t.route && (
                    <View style={styles.soonBadge}>
                      <Text style={styles.soonText}>COMING SOON</Text>
                    </View>
                  )}
                  {locked && (
                    <View style={styles.premiumBadge}>
                      <Ionicons name="star" size={9} color="#92400E" />
                      <Text style={styles.premiumText}>PREMIUM</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.toolDesc}>{t.desc}</Text>
              </View>
              {locked ? <Ionicons name="lock-closed" size={16} color={colors.textTertiary} /> : (t.route && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />)}
            </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Join a team with a code */}
      <Modal visible={showJoin} transparent animationType="fade" onRequestClose={() => setShowJoin(false)}>
        <Pressable style={styles.modalWrap} onPress={() => setShowJoin(false)}>
          <Pressable style={styles.joinSheet} testID="join-modal">
            <Text style={styles.joinTitle}>Join a team</Text>
            <Text style={styles.joinSub}>Enter the code your coach shared. You&apos;ll start in the group chat.</Text>
            <TextInput
              style={styles.joinInput}
              placeholder="TEAM CODE"
              placeholderTextColor={colors.textTertiary}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              testID="join-code-input"
            />
            <TouchableOpacity style={[styles.lockedBtn, (!joinCode.trim() || joining) && { opacity: 0.5 }, { marginTop: 6, justifyContent: "center" }]} onPress={joinTeam} disabled={!joinCode.trim() || joining} testID="join-submit">
              {joining ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.lockedBtnText}>Join team</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowJoin(false)} style={{ paddingVertical: 10, alignItems: "center" }}>
              <Text style={styles.chatAthleteText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  headerBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  headerTitle: { ...typography.h1, color: c.textPrimary },
  headerSub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  introCard: {
    flexDirection: "row", gap: spacing.md, alignItems: "flex-start",
    backgroundColor: c.accentSubtle, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: c.accent + "33",
  },
  introText: { ...typography.caption, color: c.textPrimary, flex: 1, lineHeight: 18 },
  toolCard: {
    flexDirection: "row", gap: spacing.md, alignItems: "center",
    backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: c.border,
  },
  toolIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center" },
  toolTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  toolTitle: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary },
  soonBadge: { backgroundColor: c.divider, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  soonText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5, color: c.textSecondary },
  premiumBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEF3C7", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  premiumText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5, color: "#92400E" },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  unreadText: { color: "white", fontSize: 11, fontWeight: "800" },
  toolDesc: { ...typography.caption, color: c.textSecondary, marginTop: 3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  lockedCard: { alignItems: "center", backgroundColor: c.card, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: spacing.xl, gap: spacing.sm, marginTop: spacing.md },
  lockedIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  lockedTitle: { ...typography.h3, color: c.textPrimary, textAlign: "center" },
  lockedText: { ...typography.caption, color: c.textSecondary, textAlign: "center", lineHeight: 19 },
  lockedBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18, marginTop: spacing.md },
  lockedBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
  chatAthleteBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: c.accent, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18, marginTop: spacing.sm },
  chatAthleteText: { color: c.accent, fontWeight: "800", fontSize: 14 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  joinSheet: { width: "100%", maxWidth: 420, backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.lg },
  joinTitle: { ...typography.h3, color: c.textPrimary },
  joinSub: { ...typography.caption, color: c.textSecondary, marginTop: 6, marginBottom: 12, lineHeight: 18 },
  joinInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13, ...typography.h3, color: c.textPrimary, letterSpacing: 3, textAlign: "center", marginBottom: 12 },
});
