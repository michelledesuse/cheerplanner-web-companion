import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, radius, spacing, typography } from "@/src/theme";

const TYPES = [
  {
    kind: "competitions",
    title: "Competitions",
    desc: "Names, locations, event dates, booking link release times.",
    icon: "trophy" as const,
    color: colors.accent,
  },
  {
    kind: "travel",
    title: "Travel & accommodations",
    desc: "Hotels, rental cars, flights — one row per competition.",
    icon: "airplane" as const,
    color: "#0EA5E9",
  },
  {
    kind: "expenses",
    title: "Expenses",
    desc: "Tuition, gear, comp fees etc. Per-athlete monthly grid or long form.",
    icon: "wallet" as const,
    color: "#10B981",
  },
];

export default function ImportHub() {
  const router = useRouter();

  const downloadTemplate = async (kind: string) => {
    try {
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/import/template/${kind}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      if (Platform.OS === "web") {
        const blob = new Blob([text], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `cheerplanner-${kind}-template.csv`;
        a.click();
      } else {
        // Native: write to cache and share
        const FileSystem = await import("expo-file-system");
        const Sharing = await import("expo-sharing");
        const path = `${FileSystem.cacheDirectory}cheerplanner-${kind}-template.csv`;
        await FileSystem.writeAsStringAsync(path, text);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path);
        }
      }
    } catch (_e) {
      // ignore
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="import-hub-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Import data</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        <View style={styles.intro}>
          <Ionicons name="cloud-upload" size={26} color={colors.accent} />
          <Text style={styles.introTitle}>Upload from a spreadsheet</Text>
          <Text style={styles.introText}>
            Use your existing Cheer / Travel / Competitions spreadsheet, or download a clean template, fill it in, and upload.
            You'll preview every row before anything is saved.
          </Text>
        </View>

        {TYPES.map((t) => (
          <View key={t.kind} style={styles.card} testID={`import-card-${t.kind}`}>
            <View style={[styles.iconBox, { backgroundColor: t.color + "22" }]}>
              <Ionicons name={t.icon} size={22} color={t.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t.title}</Text>
              <Text style={styles.cardDesc}>{t.desc}</Text>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.push(`/import/${t.kind}`)}
                  testID={`import-upload-${t.kind}`}
                >
                  <Ionicons name="cloud-upload-outline" size={14} color="white" />
                  <Text style={styles.primaryBtnText}>Upload file</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ghostBtn}
                  onPress={() => downloadTemplate(t.kind)}
                  testID={`import-template-${t.kind}`}
                >
                  <Ionicons name="download-outline" size={14} color={colors.textPrimary} />
                  <Text style={styles.ghostBtnText}>Template</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}

        <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>What works</Text>
          <Text style={styles.helpText}>• .csv and .xlsx files{"\n"}
            • Your existing Cheer Expenses / Competitions / Travel spreadsheets{"\n"}
            • The CheerPlanner clean templates above{"\n"}
            • Multi-athlete expense grids — each athlete column maps to an existing athlete or a new one</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  intro: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  introTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.sm },
  introText: { ...typography.body, color: colors.textSecondary, marginTop: 6, lineHeight: 22 },
  card: { flexDirection: "row", backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, gap: spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardDesc: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cardActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.bg, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  ghostBtnText: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
  helpCard: { marginTop: spacing.lg, padding: spacing.lg, backgroundColor: colors.accentSubtle, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentBorder },
  helpTitle: { ...typography.h3, color: colors.accent, marginBottom: 6 },
  helpText: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
});
