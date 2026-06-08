import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

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

        <Text style={styles.sectionHead}>Preferences</Text>
        <View style={styles.group}>
          <SettingRow icon="cash-outline" label="Currency" value="USD ($)" />
          <SettingRow icon="notifications-outline" label="In-app reminders" value="7 / 3 / 1 days before" />
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
          <SettingRow icon="trophy-outline" label="Competitions" onPress={() => router.push("/(tabs)/competitions")} chevron />
          <SettingRow icon="gift-outline" label="Fundraisers" onPress={() => router.push("/fundraisers")} chevron />
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut} testID="sign-out-btn">
          <Ionicons name="log-out-outline" size={18} color={colors.dangerText} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>CheerPlanner • v1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({ icon, label, value, onPress, chevron, testID }: any) {
  const Comp = onPress ? TouchableOpacity : View;
  return (
    <Comp style={styles.row} onPress={onPress} activeOpacity={0.7} testID={testID}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.textPrimary} /></View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      {value && <Text style={styles.rowValue}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
    </Comp>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
  profile: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  avatar: { width: 70, height: 70, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  avatarText: { color: "white", fontSize: 28, fontWeight: "800" },
  profileName: { ...typography.h2, color: colors.textPrimary },
  profileEmail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  sectionHead: { ...typography.micro, color: colors.textTertiary, marginTop: spacing.lg, marginBottom: spacing.sm },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  rowLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  rowValue: { ...typography.caption, color: colors.textSecondary },
  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBg },
  signOutText: { color: colors.dangerText, fontWeight: "700" },
  footer: { textAlign: "center", marginTop: spacing.lg, color: colors.textTertiary, ...typography.caption },
});
