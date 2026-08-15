import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useRealtimeRefetch } from "@/src/context/RealtimeContext";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type ActivityItem = {
  id: string;
  resource: "competition" | "event";
  resource_id: string;
  resource_name?: string;
  action: "added" | "updated";
  actor_name?: string;
};

/**
 * Home-tab banner surfacing when ANOTHER household member adds or changes a
 * competition or schedule event. Tapping an item opens it (and clears it);
 * "Mark all seen" clears everything. Solo households never see anything here.
 */
export default function ActivityBanner() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/activity");
      setItems(r.data.items || []);
    } catch (_e) { setItems([]); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRealtimeRefetch(load);

  const markAll = async () => {
    setItems([]);
    try { await api.post("/activity/mark-seen", { all: true }); } catch (_e) {}
  };

  const openItem = async (it: ActivityItem) => {
    // Optimistically remove + clear on the server (auto-clear on view).
    setItems((prev) => prev.filter((x) => x.resource_id !== it.resource_id));
    try { await api.post("/activity/mark-seen", { resource_id: it.resource_id }); } catch (_e) {}
    if (it.resource === "competition") router.push(`/competitions/${it.resource_id}`);
    else router.push(`/schedule/new?id=${it.resource_id}`);
  };

  if (items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, 3);

  return (
    <View style={styles.card} testID="activity-banner">
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <View style={styles.dot} />
          <Text style={styles.headText}>
            {items.length} new or updated {items.length === 1 ? "item" : "items"}
          </Text>
        </View>
        <TouchableOpacity onPress={markAll} testID="activity-mark-all" hitSlop={8}>
          <Text style={styles.markAll}>Mark all seen</Text>
        </TouchableOpacity>
      </View>

      {shown.map((it) => (
        <TouchableOpacity
          key={it.id}
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => openItem(it)}
          testID={`activity-item-${it.resource_id}`}
        >
          <Ionicons
            name={it.resource === "competition" ? "trophy-outline" : "calendar-outline"}
            size={16}
            color={colors.accent}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>{it.resource_name || "Item"}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {it.actor_name || "Someone"} {it.action === "added" ? "added this" : "made changes"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      ))}

      {items.length > 3 && (
        <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={styles.moreBtn} testID="activity-toggle-more">
          <Text style={styles.moreText}>{expanded ? "Show less" : `Show ${items.length - 3} more`}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: ThemePalette) => ({
  card: {
    marginBottom: spacing.md,
    backgroundColor: c.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.accent,
    padding: spacing.md,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  headLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent },
  headText: { ...typography.bodyMedium, color: c.textPrimary, fontWeight: "700" },
  markAll: { ...typography.caption, color: c.accent, fontWeight: "700" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.borderSoft,
  },
  rowTitle: { ...typography.bodyMedium, color: c.textPrimary },
  rowMeta: { ...typography.caption, color: c.textSecondary, marginTop: 1 },
  moreBtn: { paddingTop: 8, alignItems: "center", borderTopWidth: 1, borderTopColor: c.borderSoft },
  moreText: { ...typography.caption, color: c.accent, fontWeight: "700" },
});
