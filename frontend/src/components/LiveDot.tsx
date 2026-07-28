import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { useTheme } from "@/src/context/ThemeContext";
import { useRealtime } from "@/src/context/RealtimeContext";

/**
 * Tiny real-time connection indicator. Shows a green "Live" dot when the
 * WebSocket is connected (families are seeing shared data update instantly),
 * and a muted "Offline" dot otherwise. Purely informational.
 */
export default function LiveDot({ showLabel = true }: { showLabel?: boolean }) {
  const { palette } = useTheme();
  const { connected } = useRealtime();

  const color = connected ? "#22c55e" : (palette.textSecondary || "#9ca3af");

  return (
    <View style={styles.wrap} accessibilityLabel={connected ? "Live sync connected" : "Live sync offline"}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {showLabel ? (
        <Text style={[styles.label, { color }]}>{connected ? "Live" : "Offline"}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
  },
});
