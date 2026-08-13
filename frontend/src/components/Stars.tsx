import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const STAR_GOLD = "#F6B01E";

/** Read-only star display. `value` may be fractional (e.g. 4.3). */
export function Stars({ value, size = 16, muted = "#D8DCE3" }: { value: number; size?: number; muted?: string }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    let name: any = "star-outline";
    if (value >= i) name = "star";
    else if (value >= i - 0.5) name = "star-half";
    stars.push(<Ionicons key={i} name={name} size={size} color={name === "star-outline" ? muted : STAR_GOLD} style={{ marginRight: 1 }} />);
  }
  return <View style={styles.row}>{stars}</View>;
}

/** Interactive 1–5 star picker. */
export function StarPicker({ value, onChange, size = 34 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((i) => (
        <TouchableOpacity key={i} onPress={() => onChange(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} testID={`star-${i}`}>
          <Ionicons name={value >= i ? "star" : "star-outline"} size={size} color={value >= i ? STAR_GOLD : "#C4C9D2"} style={{ marginRight: 6 }} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});

export { STAR_GOLD };
