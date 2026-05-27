import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";

import { api, TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, radius, spacing, typography } from "@/src/theme";
import { formatCurrency, formatDate } from "@/src/utils/format";

type Athlete = { id: string; name: string };

const TITLES: Record<string, string> = {
  competitions: "Competitions",
  travel: "Travel & accommodations",
  expenses: "Expenses",
};

export default function ImportRunner() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const router = useRouter();
  const [stage, setStage] = useState<"pick" | "loading" | "preview" | "done">("pick");
  const [rows, setRows] = useState<any[]>([]);
  const [format, setFormat] = useState<string>("");
  const [athleteColumns, setAthleteColumns] = useState<string[]>([]);
  const [existingAthletes, setExistingAthletes] = useState<Athlete[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [athleteMap, setAthleteMap] = useState<Record<string, string>>({});
  const [createMissingComps, setCreateMissingComps] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resultCreated, setResultCreated] = useState<number>(0);
  const [resultSkipped, setResultSkipped] = useState<number>(0);
  const [committing, setCommitting] = useState(false);

  const title = TITLES[kind || ""] || "Import";

  const pickAndUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "*/*",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      setStage("loading");

      const fd = new FormData();
      fd.append("kind", kind!);
      if (Platform.OS === "web") {
        const blob = await fetch(asset.uri).then((r) => r.blob());
        fd.append("file", blob, asset.name || "upload");
      } else {
        // @ts-expect-error: RN FormData accepts file objects with uri/name/type
        fd.append("file", { uri: asset.uri, name: asset.name || "upload", type: asset.mimeType || "application/octet-stream" });
      }

      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      const res = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      setRows(data.rows || []);
      setFormat(data.format || "");
      setAthleteColumns(data.athlete_columns || []);
      setExistingAthletes(data.existing_athletes || []);
      const initSel: Record<number, boolean> = {};
      (data.rows || []).forEach((_: any, i: number) => { initSel[i] = true; });
      setSelected(initSel);
      // default athlete map: each column → __new__:<column>
      const m: Record<string, string> = {};
      for (const col of data.athlete_columns || []) m[col] = `__new__:${col}`;
      setAthleteMap(m);
      setStage("preview");
    } catch (e: any) {
      Alert.alert("Couldn't read file", e?.message || "Unsupported file");
      setStage("pick");
    }
  };

  const toggleRow = (i: number) => setSelected((s) => ({ ...s, [i]: !s[i] }));
  const allOn = useMemo(() => rows.every((_, i) => selected[i]), [rows, selected]);
  const toggleAll = () => {
    const v = !allOn;
    const m: Record<number, boolean> = {};
    rows.forEach((_, i) => { m[i] = v; });
    setSelected(m);
  };

  const commit = async () => {
    setCommitting(true);
    try {
      const toSend = rows.filter((_, i) => selected[i]);
      const payload: any = { kind, rows: toSend };
      if (kind === "expenses" && format === "wide") payload.athlete_map = athleteMap;
      if (kind === "travel") payload.create_missing_competitions = createMissingComps;
      const res = await api.post("/import/commit", payload);
      setResultCreated(res.data.created || 0);
      setResultSkipped(res.data.skipped || 0);
      setWarnings(res.data.warnings || []);
      setStage("done");
    } catch (e: any) {
      Alert.alert("Import failed", e?.response?.data?.detail || "Could not save data");
    } finally {
      setCommitting(false);
    }
  };

  // ---------- Renderers ----------
  const renderRow = (row: any, i: number) => {
    const on = !!selected[i];
    let title = "";
    let sub = "";
    if (kind === "competitions") {
      title = row.name || "(unnamed)";
      sub = `${row.location || "Location TBD"} • ${formatDate(row.event_date) || "no date"}`;
    } else if (kind === "travel") {
      const types = (row.bookings || []).map((b: any) => b.type).join(" + ");
      const totalCost = (row.bookings || []).reduce((s: number, b: any) => s + Number(b.cost || 0), 0);
      title = row.competition || "(unknown comp)";
      sub = `${types || "—"} • ${formatCurrency(totalCost)}`;
    } else if (kind === "expenses") {
      if (format === "wide") {
        const total = Object.values(row.amounts || {}).reduce((s: number, v: any) => s + Number(v || 0), 0);
        title = `${row.category} — ${formatDate(row.date) || "no date"}`;
        sub = `${Object.keys(row.amounts || {}).length} athletes • ${formatCurrency(total)}`;
      } else {
        title = `${row.athlete} — ${row.category}`;
        sub = `${formatCurrency(row.amount)} • ${formatDate(row.date) || "no date"}`;
      }
    }
    return (
      <TouchableOpacity
        key={i}
        style={[styles.row, !on && styles.rowOff]}
        onPress={() => toggleRow(i)}
        activeOpacity={0.85}
        testID={`preview-row-${i}`}
      >
        <View style={[styles.check, on && styles.checkOn]}>
          {on && <Ionicons name="checkmark" size={14} color="white" />}
        </View>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ---------- Stages ----------
  if (stage === "pick") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header title={`Import ${title}`} onBack={() => router.back()} />
        <View style={styles.centered}>
          <View style={styles.dropzone}>
            <Ionicons name="cloud-upload-outline" size={42} color={colors.accent} />
            <Text style={styles.dropzoneTitle}>Choose a file</Text>
            <Text style={styles.dropzoneText}>.csv or .xlsx</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={pickAndUpload} testID="pick-file-btn">
              <Text style={styles.primaryBtnText}>Pick file</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (stage === "loading") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header title={`Import ${title}`} onBack={() => router.back()} />
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (stage === "done") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header title={`Import ${title}`} onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
          <View style={styles.successCard} testID="import-success">
            <View style={styles.successCircle}>
              <Ionicons name="checkmark" size={32} color={colors.successText} />
            </View>
            <Text style={styles.successTitle}>Import complete</Text>
            <Text style={styles.successMeta}>{resultCreated} created • {resultSkipped} skipped</Text>
            {warnings.length > 0 && (
              <View style={{ marginTop: spacing.lg }}>
                {warnings.map((w, idx) => (
                  <Text key={idx} style={styles.warningText}>⚠ {w}</Text>
                ))}
              </View>
            )}
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: spacing.xl }]} onPress={() => router.back()} testID="import-done-btn">
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // preview
  const selectedCount = rows.filter((_, i) => selected[i]).length;
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header title={`Import ${title}`} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle}>{rows.length} row{rows.length === 1 ? "" : "s"} found</Text>
          <TouchableOpacity onPress={toggleAll} testID="toggle-all-rows">
            <Text style={styles.linkText}>{allOn ? "Deselect all" : "Select all"}</Text>
          </TouchableOpacity>
        </View>

        {kind === "expenses" && format === "wide" && athleteColumns.length > 0 && (
          <View style={styles.mapCard}>
            <Text style={styles.mapTitle}>Map athlete columns</Text>
            <Text style={styles.mapSub}>Each column will become a separate athlete. Tap to use an existing athlete instead.</Text>
            {athleteColumns.map((col) => (
              <View key={col} style={styles.mapRow}>
                <Text style={styles.mapCol}>{col}</Text>
                <View style={styles.chipRow}>
                  <Chip
                    label={`+ Create "${col}"`}
                    active={athleteMap[col] === `__new__:${col}`}
                    onPress={() => setAthleteMap((m) => ({ ...m, [col]: `__new__:${col}` }))}
                  />
                  {existingAthletes.map((a) => (
                    <Chip
                      key={a.id}
                      label={a.name}
                      active={athleteMap[col] === a.id}
                      onPress={() => setAthleteMap((m) => ({ ...m, [col]: a.id }))}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {kind === "travel" && (
          <TouchableOpacity
            style={[styles.toggleCard, createMissingComps && styles.toggleCardOn]}
            onPress={() => setCreateMissingComps((s) => !s)}
          >
            <View style={[styles.check, createMissingComps && styles.checkOn]}>
              {createMissingComps && <Ionicons name="checkmark" size={14} color="white" />}
            </View>
            <Text style={styles.toggleText}>Create competitions that aren't matched yet</Text>
          </TouchableOpacity>
        )}

        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {rows.map((r, i) => renderRow(r, i))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerCount}>{selectedCount} selected</Text>
        <TouchableOpacity
          style={[styles.primaryBtn, (selectedCount === 0 || committing) && { opacity: 0.6 }]}
          onPress={commit}
          disabled={selectedCount === 0 || committing}
          testID="commit-import-btn"
        >
          {committing ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>Import {selectedCount}</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.iconBtn} testID="import-back">
        <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={{ width: 36 }} />
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: "center", marginHorizontal: spacing.sm },
  dropzone: { padding: spacing.xxl, backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 2, borderColor: colors.accentBorder, borderStyle: "dashed", alignItems: "center", width: "100%" },
  dropzoneTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.md },
  dropzoneText: { ...typography.caption, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  primaryBtn: { backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  previewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  previewTitle: { ...typography.h2, color: colors.textPrimary },
  linkText: { ...typography.bodyMedium, color: colors.accent, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  rowOff: { opacity: 0.45 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  mapCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  mapTitle: { ...typography.h3, color: colors.textPrimary },
  mapSub: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md, marginTop: 2 },
  mapRow: { marginTop: spacing.md, gap: 6 },
  mapCol: { ...typography.bodyMedium, color: colors.textPrimary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  chipTextOn: { color: "white" },
  toggleCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  toggleCardOn: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  toggleText: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerCount: { ...typography.bodyMedium, color: colors.textSecondary },
  successCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xxl, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  successCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  successTitle: { ...typography.h1, color: colors.textPrimary },
  successMeta: { ...typography.body, color: colors.textSecondary, marginTop: 4 },
  warningText: { ...typography.caption, color: colors.warningText, marginTop: 4 },
});
