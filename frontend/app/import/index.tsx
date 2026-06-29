import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Platform, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

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
  {
    kind: "schedule",
    title: "Schedule",
    desc: "Practices, lessons, classes. Supports recurring events (e.g. every Tuesday).",
    icon: "calendar" as const,
    color: "#EA580C",
  },
  {
    kind: "teams_to_watch",
    title: "Teams to watch",
    desc: "Teams you want to catch at a competition — matched to the competition by name.",
    icon: "eye" as const,
    color: "#8B5CF6",
  },
];

type Fmt = "csv" | "xlsx";

export default function ImportHub() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fmt, setFmt] = useState<Fmt>("csv");

  const downloadTemplate = async (kind: string) => {
    if (downloading) return;
    setDownloading(kind);
    try {
      const ext = fmt === "xlsx" ? "xlsx" : "csv";
      const mime = fmt === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv";
      const filename = `cheerplanner-${kind}-template.${ext}`;
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/import/template/${kind}?fmt=${fmt}`;

      if (Platform.OS === "web") {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      } else {
        const FS: any = await import("expo-file-system/legacy");
        const Sharing: any = await import("expo-sharing");
        const path = `${FS.cacheDirectory}${filename}`;
        const dl = await FS.downloadAsync(url, path, { headers: { Authorization: `Bearer ${token}` } });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dl.uri, { mimeType: mime, dialogTitle: "Save template" });
        } else {
          Alert.alert("Saved", `Template saved to ${dl.uri}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Download failed", e?.response?.data?.detail || e?.message || "Could not download the template. Please check your connection and try again.");
    } finally {
      setDownloading(null);
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
            You&apos;ll preview every row before anything is saved.
          </Text>
        </View>

        <View style={styles.fmtRow}>
          <Text style={styles.fmtLabel}>Template format</Text>
          <View style={styles.fmtToggle}>
            {(["csv", "xlsx"] as const).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.fmtChip, fmt === f && styles.fmtChipOn]}
                onPress={() => setFmt(f)}
                testID={`fmt-${f}`}
              >
                <Text style={[styles.fmtChipText, fmt === f && styles.fmtChipTextOn]}>
                  {f.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
                  style={[styles.ghostBtn, downloading === t.kind && { opacity: 0.6 }]}
                  onPress={() => downloadTemplate(t.kind)}
                  disabled={downloading === t.kind}
                  testID={`import-template-${t.kind}`}
                >
                  {downloading === t.kind ? (
                    <ActivityIndicator size="small" color={colors.textPrimary} />
                  ) : (
                    <Ionicons name="download-outline" size={14} color={colors.textPrimary} />
                  )}
                  <Text style={styles.ghostBtnText}>{downloading === t.kind ? "Downloading…" : fmt.toUpperCase()}</Text>
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

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  intro: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  introTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.sm },
  introText: { ...typography.body, color: colors.textSecondary, marginTop: 6, lineHeight: 22 },
  card: { flexDirection: "row", backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, gap: spacing.md },
  fmtRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  fmtLabel: { ...typography.bodyMedium, color: colors.textPrimary, fontWeight: "700" },
  fmtToggle: { flexDirection: "row", backgroundColor: colors.card, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  fmtChip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  fmtChipOn: { backgroundColor: colors.primary },
  fmtChipText: { ...typography.caption, fontWeight: "800", color: colors.textSecondary, letterSpacing: 0.5 },
  fmtChipTextOn: { color: "white" },
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
