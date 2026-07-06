import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert, Platform, Modal, TextInput, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const FREQ_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", off: "Off" };

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [notifFreq, setNotifFreq] = useState<string>("");

  // Fetch current notification frequency so the Settings row can show a live
  // "Daily" / "Weekly" / "Off" badge — makes it obvious where to manage email
  // reminders from this screen.
  const loadNotifFreq = React.useCallback(async () => {
    try {
      const r = await api.get<{ frequency?: string; enabled?: boolean }>("/notifications/preferences");
      const freq = r.data?.enabled === false ? "off" : r.data?.frequency || "daily";
      setNotifFreq(FREQ_LABEL[freq] || "");
    } catch {
      // Stay silent — don't block settings render on a notification fetch failure.
    }
  }, []);

  useEffect(() => { loadNotifFreq(); }, [loadNotifFreq]);
  useFocusEffect(React.useCallback(() => { loadNotifFreq(); }, [loadNotifFreq]));

  const openExport = async (path: string, suggestedName: string, mimeType: string = "text/csv") => {
    try {
      const { api } = await import("@/src/api/client");
      // Backend exports return plain-text CSV / ICS. Force a string response so
      // we don't depend on Blob support (which is patchy on React Native).
      const r = await api.get<string>(path, {
        responseType: "text",
        transformResponse: [(d) => d],
      });
      const csv = typeof r.data === "string" ? r.data : String(r.data ?? "");
      if (!csv || csv.length < 5) throw new Error("Empty export returned by server");

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: `${mimeType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const FS: any = await import("expo-file-system/legacy");
        const Sharing: any = await import("expo-sharing");
        const filePath = `${FS.cacheDirectory}${suggestedName}`;
        await FS.writeAsStringAsync(filePath, csv, { encoding: FS.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(filePath, { mimeType, dialogTitle: "Save export" });
        } else {
          Alert.alert("Saved", `Export saved to ${filePath}`);
        }
      }
    } catch (e: any) {
      Alert.alert(
        "Export failed",
        e?.response?.data?.detail || e?.message || "Could not generate the export."
      );
    }
  };

  const onSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/login");
        },
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your CheerPlanner account and ALL your data (athletes, expenses, payments, competitions, schedules, packing lists). This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => { setDeletePassword(""); setDeleteOpen(true); },
        },
      ],
    );
  };

  const performDelete = async () => {
    if (!deletePassword) {
      Alert.alert("Password required", "Enter your password to confirm.");
      return;
    }
    setDeletingAccount(true);
    try {
      await api.delete("/auth/me", { data: { password: deletePassword } });
      setDeleteOpen(false);
      await signOut();
      router.replace("/login");
      // Give the modal a tick to unmount before the toast.
      setTimeout(() => {
        Alert.alert("Account deleted", "Your account and all related data have been removed.");
      }, 250);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || "Could not delete account.";
      Alert.alert("Error", msg);
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} testID="settings-screen">
        <Text style={styles.title}>Settings</Text>

        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || user?.email || "?")[0]?.toUpperCase()}</Text>
          </View>
          <Text style={styles.profileName}>{user?.name || user?.email?.split("@")[0]}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
        </View>

        <Text style={styles.sectionHead}>Reminders &amp; notifications</Text>
        <View style={styles.group}>
          <SettingRow
            icon="mail-unread-outline"
            label="Email reminders"
            subtitle="Daily or weekly digest of upcoming payments, comps &amp; travel"
            value={notifFreq}
            onPress={() => router.push("/settings/notifications" as any)}
            chevron
            testID="settings-notifications"
          />
          <SettingRow icon="notifications-outline" label="In-app reminders" value="7 / 3 / 1 days before" />
        </View>

        <Text style={styles.sectionHead}>Preferences</Text>
        <View style={styles.group}>
          <SettingRow
            icon="color-palette-outline"
            label="Appearance"
            subtitle="Color theme for your household"
            onPress={() => router.push("/settings/appearance" as any)}
            chevron
            testID="settings-appearance"
          />
          <SettingRow icon="cash-outline" label="Currency" value="USD ($)" />
        </View>

        <Text style={styles.sectionHead}>Sharing</Text>
        <View style={styles.group}>
          <SettingRow icon="people-circle-outline" label="Household (share with co-parent)" onPress={() => router.push("/household")} chevron testID="settings-household" />
        </View>

        <Text style={styles.sectionHead}>Data</Text>
        <View style={styles.group}>
          <SettingRow icon="cloud-upload-outline" label="Import from spreadsheet" onPress={() => router.push("/import")} chevron />
          <SettingRow icon="download-outline" label="Export expenses &amp; payments (CSV)" onPress={() => openExport("/export/expenses-payments.csv", "cheerplanner-expenses-payments.csv")} chevron testID="export-expenses-payments" />
          <SettingRow icon="calendar-outline" label="Export calendar (.ics)" onPress={() => openExport("/export/calendar.ics", "cheerplanner.ics", "text/calendar")} chevron testID="export-calendar" />
          <SettingRow icon="people-outline" label="Athletes" onPress={() => router.push("/(tabs)/athletes")} chevron />
          <SettingRow icon="ribbon-outline" label="Teams" onPress={() => router.push("/teams" as any)} chevron testID="settings-teams" />
          <SettingRow icon="trophy-outline" label="Competitions" onPress={() => router.push("/(tabs)/competitions")} chevron />
          <SettingRow icon="gift-outline" label="Fundraisers" onPress={() => router.push("/fundraisers")} chevron />
        </View>

        <Text style={styles.sectionHead}>Help &amp; support</Text>
        <View style={styles.group}>
          <SettingRow
            icon="rocket-outline"
            label="Setup guide"
            onPress={() => router.push("/help/setup" as any)}
            chevron
            testID="settings-setup-guide"
          />
          <SettingRow
            icon="help-circle-outline"
            label="FAQ"
            onPress={() => router.push("/help/faq" as any)}
            chevron
            testID="settings-faq"
          />
          <SettingRow
            icon="mail-outline"
            label="Contact support"
            onPress={() => Linking.openURL("mailto:info@cheer-planner.com?subject=CheerPlanner%20support")}
            chevron
            testID="settings-contact"
          />
          <SettingRow
            icon="shield-checkmark-outline"
            label="Privacy Policy"
            onPress={() => router.push("/settings/privacy" as any)}
            chevron
            testID="settings-privacy"
          />
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut} testID="sign-out-btn">
          <Ionicons name="log-out-outline" size={18} color={colors.dangerText} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHead}>Danger zone</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.deleteRow} onPress={confirmDelete} activeOpacity={0.7} testID="settings-delete-account">
            <View style={[styles.rowIcon, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="trash" size={18} color={colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.deleteRowLabel}>Delete account</Text>
              <Text style={styles.deleteRowSubtitle}>Permanently remove your account &amp; data</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>CheerPlanner • v1.0.3</Text>
      </ScrollView>

      {/* Password-confirm modal for account deletion (Apple 5.1.1(v) compliance) */}
      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Ionicons name="warning" size={22} color={colors.danger} />
              <Text style={styles.modalTitle}>Delete account</Text>
            </View>
            <Text style={styles.modalBody}>
              This is permanent. Your account, athletes, expenses, payments, competitions, schedules, and packing lists will be deleted forever. Enter your password to confirm.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder="Password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              testID="settings-delete-password-input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setDeleteOpen(false); setDeletePassword(""); }}
                disabled={deletingAccount}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeleteBtn, deletingAccount && { opacity: 0.7 }]}
                onPress={performDelete}
                disabled={deletingAccount}
                testID="settings-delete-confirm-btn"
              >
                {deletingAccount ? <ActivityIndicator color="white" /> : <Text style={styles.modalDeleteText}>Delete forever</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SettingRow({ icon, label, subtitle, value, onPress, chevron, testID }: any) {
  const styles = useThemedStyles(makeStyles);
  const Comp = onPress ? TouchableOpacity : View;
  return (
    <Comp style={styles.row} onPress={onPress} activeOpacity={0.7} testID={testID}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.textSecondary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </Comp>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  title: { ...typography.display, color: c.textPrimary, marginBottom: spacing.lg },
  profile: { backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg },
  avatar: { width: 70, height: 70, borderRadius: 22, backgroundColor: c.primary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  avatarText: { color: "white", fontSize: 28, fontWeight: "800" },
  profileName: { ...typography.h2, color: c.textPrimary },
  profileEmail: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  sectionHead: { ...typography.micro, color: c.textTertiary, marginTop: spacing.lg, marginBottom: spacing.sm },
  group: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  rowIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
  rowLabel: { ...typography.bodyMedium, color: c.textPrimary },
  rowSubtitle: { ...typography.caption, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  rowValue: { ...typography.caption, color: c.textSecondary },
  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.dangerBg },
  signOutText: { color: c.dangerText, fontWeight: "700" },
  footer: { textAlign: "center", marginTop: spacing.lg, color: c.textTertiary, ...typography.caption },

  deleteRow: {
    flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md,
    backgroundColor: c.card,
  },
  deleteRowLabel: { ...typography.bodyMedium, color: c.danger },
  deleteRowSubtitle: { ...typography.caption, color: c.textTertiary, marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalSheet: {
    width: "100%", maxWidth: 420, backgroundColor: c.bg,
    borderRadius: 16, padding: spacing.lg, gap: spacing.md,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  modalTitle: { ...typography.h3, color: c.textPrimary },
  modalBody: { ...typography.body, color: c.textSecondary, lineHeight: 20 },
  modalInput: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: c.textPrimary,
  },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  modalCancelText: { ...typography.bodyMedium, color: c.textPrimary },
  modalDeleteBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.danger, alignItems: "center" },
  modalDeleteText: { color: "white", fontWeight: "700" },
});
