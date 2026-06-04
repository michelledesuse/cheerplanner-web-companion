import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const apiBase = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "") + "/api";

  const openExport = async (path: string, suggestedName: string) => {
    try {
      const { api } = await import("@/src/api/client");
      const r = await api.get(path, { responseType: "blob" as any });
      const isWeb = typeof window !== "undefined" && (window as any).document;
      if (isWeb) {
        // Browser: create blob URL and trigger download
        const blob = r.data instanceof Blob ? r.data : new Blob([r.data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = suggestedName; document.body.appendChild(a);
        a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        // Native: persist + share
        const FS: any = await import("expo-file-system");
        const Sharing: any = await import("expo-sharing");
        const path2 = `${FS.cacheDirectory}${suggestedName}`;
        const text = typeof r.data === "string" ? r.data : await (r.data as Blob).text();
        await FS.writeAsStringAsync(path2, text, { encoding: FS.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path2);
        } else {
          Alert.alert("Saved", `File saved to ${path2}`);
        }
      }
    } catch (_e) {
      Alert.alert("Export failed", "Could not generate the export.");
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
          <SettingRow icon="download-outline" label="Export expenses (CSV)" onPress={() => openExport("/export/expenses.csv", "expenses.csv")} chevron testID="export-expenses" />
          <SettingRow icon="download-outline" label="Export payments (CSV)" onPress={() => openExport("/export/payments.csv", "payments.csv")} chevron testID="export-payments" />
          <SettingRow icon="calendar-outline" label="Export calendar (.ics)" onPress={() => openExport("/export/calendar.ics", "cheerplanner.ics")} chevron testID="export-calendar" />
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

function SettingRow({ icon, label, value, onPress, chevron }: any) {
  const Comp = onPress ? TouchableOpacity : View;
  return (
    <Comp style={styles.row} onPress={onPress} activeOpacity={0.7}>
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
