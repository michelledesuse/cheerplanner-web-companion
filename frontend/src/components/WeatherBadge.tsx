import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, StyleProp, ViewStyle } from "react-native";

import { api } from "@/src/api/client";
import { colors } from "@/src/theme";

type WeatherData = {
  available: boolean;
  reason?: string | null;
  location_name?: string;
  high_f?: number | null;
  low_f?: number | null;
  condition?: string;
  emoji?: string;
  precip_pct?: number | null;
};

// tiny in-memory cache so lists don't refetch the same place/date repeatedly
const memCache = new Map<string, WeatherData>();

export default function WeatherBadge({
  location,
  date,
  compact = false,
  style,
  testID,
}: {
  location?: string | null;
  date?: string | null;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  const day = (date || "").slice(0, 10);

  useEffect(() => {
    mounted.current = true;
    if (!location || !location.trim() || !day) { setData(null); return; }
    const key = `${location.trim().toLowerCase()}|${day}`;
    if (memCache.has(key)) { setData(memCache.get(key)!); return; }
    setLoading(true);
    api
      .get(`/weather`, { params: { location: location.trim(), date: day } })
      .then((r) => { memCache.set(key, r.data); if (mounted.current) setData(r.data); })
      .catch(() => { if (mounted.current) setData(null); })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [location, day]);

  if (!location || !day) return null;
  if (loading && !data) {
    return compact ? null : (
      <View style={[styles.chip, style]} testID={testID}>
        <ActivityIndicator size="small" color={colors.textTertiary} />
      </View>
    );
  }
  if (!data) return null;

  if (!data.available) {
    if (data.reason === "out_of_range" && !compact) {
      return (
        <View style={[styles.hint, style]} testID={testID}>
          <Text style={styles.hintText}>🌤️ Forecast available closer to the date</Text>
        </View>
      );
    }
    return null; // no_location / not_found / unavailable / past -> hide
  }

  const hi = data.high_f != null ? `${data.high_f}°` : "—";
  const lo = data.low_f != null ? `${data.low_f}°` : "—";

  if (compact) {
    return (
      <View style={[styles.compact, style]} testID={testID}>
        <Text style={styles.compactText}>{data.emoji} {hi}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.chip, style]} testID={testID}>
      <Text style={styles.emoji}>{data.emoji}</Text>
      <Text style={styles.temp}>{hi}<Text style={styles.tempLow}> / {lo}</Text></Text>
      <Text style={styles.dot}>·</Text>
      <Text style={styles.cond} numberOfLines={1}>{data.condition}</Text>
      {data.precip_pct != null && (
        <>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.precip}>💧 {data.precip_pct}%</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start",
    backgroundColor: colors.accentSubtle, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexWrap: "wrap",
  },
  emoji: { fontSize: 16 },
  temp: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  tempLow: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  dot: { color: colors.textTertiary, fontSize: 14 },
  cond: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  precip: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  hint: { alignSelf: "flex-start", paddingVertical: 4 },
  hintText: { color: colors.textTertiary, fontSize: 12, fontStyle: "italic" },
  compact: { flexDirection: "row", alignItems: "center" },
  compactText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
});
