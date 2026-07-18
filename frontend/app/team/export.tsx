import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { formatCurrency } from "@/src/utils/format";
import { roleLabel } from "@/src/utils/roles";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import TrackerGrid from "@/src/components/TrackerGrid";
import { buildGridRows, filterAndSplit, isPersonnel, type GridMember } from "@/src/utils/rosterGroups";

type Member = GridMember & { role: string; phone?: string | null; email?: string | null; parent_first_name?: string | null; parent_last_name?: string | null; parent_phone?: string | null; parent_email?: string | null };
type Team = { id: string; name: string };
type SizeSheet = { columns: { id: string; label: string }[]; values: Record<string, Record<string, string>> };
type PwSheet = { id: string; name: string; items: { id: string; label: string }[]; values: Record<string, Record<string, { done?: boolean; note?: string | null }>> };
type PayTracker = { id: string; name: string; amount?: number | null; entries: { member_id: string; paid: boolean; amount_paid?: number | null; method?: string | null }[] };
type Comp = { id: string; name: string };

type ExportCol = { key: string; label: string; group: string; get: (m: Member) => string };

const isSportsBra = (label: string) => label.trim().toLowerCase() === "sports bra";

export default function ExportScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sizeSheet, setSizeSheet] = useState<SizeSheet | null>(null);
  const [pwSheets, setPwSheets] = useState<PwSheet[]>([]);
  const [payTrackers, setPayTrackers] = useState<PayTracker[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [compId, setCompId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(["role", "teams", "phone", "email"]));
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, t, sz, pw, pay, cp] = await Promise.all([
        api.get<Member[]>("/roster"),
        api.get<Team[]>("/teams").catch(() => ({ data: [] as Team[] })),
        api.get<SizeSheet>("/team/sizes").catch(() => ({ data: null as any })),
        api.get<PwSheet[]>("/team/paperwork").catch(() => ({ data: [] as PwSheet[] })),
        api.get<PayTracker[]>("/team/payments").catch(() => ({ data: [] as PayTracker[] })),
        api.get<Comp[]>("/competitions").catch(() => ({ data: [] as Comp[] })),
      ]);
      setMembers(r.data.filter((m) => m.role !== "parent"));
      setTeams(t.data || []);
      setSizeSheet(sz.data || null);
      setPwSheets(pw.data || []);
      setPayTrackers(pay.data || []);
      setComps(cp.data || []);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Build every selectable column from the fetched data.
  const columns: ExportCol[] = useMemo(() => {
    const cols: ExportCol[] = [];
    cols.push({ key: "role", label: "Role", group: "Contact", get: (m) => roleLabel(m.role) });
    cols.push({ key: "teams", label: "Team(s)", group: "Contact", get: (m) => (m.team_ids || []).map((id) => teams.find((t) => t.id === id)?.name || "").filter(Boolean).join(", ") });
    cols.push({ key: "phone", label: "Phone", group: "Contact", get: (m) => (isPersonnel(m.role) ? (m.phone || m.parent_phone) : (m.parent_phone || m.phone)) || "" });
    cols.push({ key: "email", label: "Email", group: "Contact", get: (m) => (isPersonnel(m.role) ? (m.email || m.parent_email) : (m.parent_email || m.email)) || "" });
    cols.push({ key: "parent", label: "Parent", group: "Contact", get: (m) => isPersonnel(m.role) ? "" : `${m.parent_first_name || ""} ${m.parent_last_name || ""}`.trim() });

    (sizeSheet?.columns || []).forEach((c) => {
      cols.push({
        key: `size:${c.id}`, label: c.label, group: "Sizes",
        get: (m) => (isSportsBra(c.label) && isPersonnel(m.role)) ? "N/A" : (sizeSheet?.values?.[m.id]?.[c.id] || ""),
      });
    });

    pwSheets.forEach((ps) => (ps.items || []).forEach((it) => {
      cols.push({
        key: `pw:${ps.id}:${it.id}`, label: `${ps.name}: ${it.label}`, group: "Paperwork",
        get: (m) => {
          const cell = ps.values?.[m.id]?.[it.id];
          if (!cell) return "";
          return (cell.done ? "Yes" : "") + (cell.note ? ` (${cell.note})` : "");
        },
      });
    }));

    payTrackers.forEach((pt) => {
      cols.push({
        key: `pay:${pt.id}`, label: `Pay: ${pt.name}`, group: "Payments",
        get: (m) => {
          const e = pt.entries?.find((x) => x.member_id === m.id);
          if (!e?.paid) return "Unpaid";
          const amt = e.amount_paid != null ? formatCurrency(e.amount_paid) : (pt.amount != null ? formatCurrency(pt.amount) : "Paid");
          return `${amt}${e.method ? ` (${e.method})` : ""}`;
        },
      });
    });

    return cols;
  }, [sizeSheet, pwSheets, payTrackers, teams]);

  const groupedCols = useMemo(() => {
    const g: Record<string, ExportCol[]> = {};
    columns.forEach((c) => { (g[c.group] ||= []).push(c); });
    return g;
  }, [columns]);

  const selectedCols = useMemo(() => columns.filter((c) => selected.has(c.key)), [columns, selected]);

  const { rows, total } = useMemo(() => buildGridRows(members, teamFilter), [members, teamFilter]);

  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const csvEscape = (v: string) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const doExport = async () => {
    const groups = filterAndSplit(members, teamFilter);
    const header = ["Group", "Name", ...selectedCols.map((c) => c.label)];
    const lines = [header.map(csvEscape).join(",")];
    const pushRows = (label: string, list: Member[]) => list.forEach((m) => {
      lines.push([label, m.name, ...selectedCols.map((c) => c.get(m))].map(csvEscape).join(","));
    });
    pushRows("Personnel", groups.personnel);
    pushRows("Athletes", groups.athletes);
    const csv = lines.join("\n");
    const scope = compId ? (comps.find((c) => c.id === compId)?.name || "roster") : "roster";
    const filename = `${scope.replace(/[^a-z0-9]+/gi, "_")}_export.csv`;

    setExporting(true);
    try {
      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const FS: any = await import("expo-file-system/legacy");
        const Sharing: any = await import("expo-sharing");
        const filePath = `${FS.cacheDirectory}${filename}`;
        await FS.writeAsStringAsync(filePath, csv, { encoding: FS.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(filePath, { mimeType: "text/csv", dialogTitle: "Export roster" });
        else Alert.alert("Saved", `Export saved to ${filePath}`);
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Could not generate the export.");
    } finally { setExporting(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="export-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Custom Roster Export</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 140 }} testID="export-screen">
          {teams.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Team</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chipRow}>
                {[{ id: null as any, name: "All teams" }, ...teams, { id: "none", name: "No team" }].map((t) => {
                  const active = teamFilter === t.id;
                  return (
                    <TouchableOpacity key={String(t.id)} onPress={() => setTeamFilter(t.id)} style={[styles.chip, active && styles.chipOn]} testID={`export-team-${t.id ?? "all"}`}>
                      <Text style={[styles.chipText, active && styles.chipTextOn]}>{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}

          {comps.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Competition (optional label)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chipRow}>
                <TouchableOpacity onPress={() => setCompId(null)} style={[styles.chip, compId === null && styles.chipOn]} testID="export-comp-none">
                  <Text style={[styles.chipText, compId === null && styles.chipTextOn]}>None</Text>
                </TouchableOpacity>
                {comps.map((c) => (
                  <TouchableOpacity key={c.id} onPress={() => setCompId(c.id)} style={[styles.chip, compId === c.id && styles.chipOn]} testID={`export-comp-${c.id}`}>
                    <Text style={[styles.chipText, compId === c.id && styles.chipTextOn]} numberOfLines={1}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={styles.sectionLabel}>Columns to include</Text>
          {Object.entries(groupedCols).map(([group, cols]) => (
            <View key={group} style={styles.colGroup}>
              <Text style={styles.colGroupTitle}>{group}</Text>
              <View style={styles.colChips}>
                {cols.map((c) => {
                  const on = selected.has(c.key);
                  return (
                    <TouchableOpacity key={c.key} onPress={() => toggle(c.key)} style={[styles.colChip, on && styles.colChipOn]} testID={`export-col-${c.key}`}>
                      {on && <Ionicons name="checkmark" size={13} color="white" />}
                      <Text style={[styles.colChipText, on && styles.colChipTextOn]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          <Text style={styles.sectionLabel}>Preview ({total} {total === 1 ? "person" : "people"})</Text>
          {total === 0 ? (
            <Text style={styles.emptyText}>No one matches this filter.</Text>
          ) : selectedCols.length === 0 ? (
            <Text style={styles.emptyText}>Pick at least one column to preview &amp; export.</Text>
          ) : (
            <View style={{ height: 340 }}>
              <TrackerGrid
                rows={rows}
                columns={selectedCols.map((c) => ({ id: c.key, label: c.label }))}
                renderCell={(m, col) => {
                  const def = selectedCols.find((c) => c.key === col.id);
                  return <Text style={styles.cellText} numberOfLines={2}>{def ? def.get(m as Member) : ""}</Text>;
                }}
                nameWidth={132}
                cellWidth={120}
                testID="export-grid"
              />
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.exportBtn, (exporting || total === 0 || selectedCols.length === 0) && { opacity: 0.5 }]}
          onPress={doExport}
          disabled={exporting || total === 0 || selectedCols.length === 0}
          testID="export-download"
        >
          {exporting ? <ActivityIndicator color="white" /> : (
            <>
              <Ionicons name="download-outline" size={18} color="white" />
              <Text style={styles.exportBtnText}>Export CSV</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  sectionLabel: { ...typography.caption, color: c.textSecondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: 8, paddingHorizontal: spacing.lg },
  chipRow: { paddingHorizontal: spacing.lg, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, maxWidth: 220 },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  chipTextOn: { color: "white" },
  colGroup: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  colGroupTitle: { ...typography.micro, color: c.textTertiary, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  colChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  colChipOn: { backgroundColor: c.accent, borderColor: c.accent },
  colChipText: { ...typography.caption, fontWeight: "700", color: c.textSecondary },
  colChipTextOn: { color: "white" },
  cellText: { ...typography.caption, color: c.textPrimary, textAlign: "center", paddingHorizontal: 6 },
  emptyText: { ...typography.caption, color: c.textSecondary, paddingHorizontal: spacing.lg },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 15 },
  exportBtnText: { color: "white", fontWeight: "800", fontSize: 15 },
});
