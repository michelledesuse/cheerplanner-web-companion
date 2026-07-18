import React from "react";
import { TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/context/ThemeContext";

/**
 * Header "Home" button. Home lives at the top of every tab screen (it was
 * removed from the bottom tab bar in the R2/R3 nav upgrade). Tapping it
 * returns to the dashboard.
 */
export default function HomeButton({ testID = "home-btn" }: { testID?: string }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <TouchableOpacity
      onPress={() => router.push("/(tabs)/dashboard")}
      style={[styles.btn, { backgroundColor: palette.accentSubtle, borderColor: palette.accent }]}
      testID={testID}
      accessibilityLabel="Go to Home"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="home" size={18} color={palette.accent} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
});
