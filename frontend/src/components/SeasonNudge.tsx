import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";

import { colors, radius, spacing, typography } from "@/src/theme";

const KEY = "season_nudge_dismissed_v1";

/**
 * A single, benefit-led, dismissible prompt to create a season — shown ONLY
 * when the backend flags `suggest_season` (i.e. the user has >12 months of
 * data worth filtering). Never implies the app needs a season to work.
 */
export default function SeasonNudge({ show }: { show: boolean }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => setDismissed(v === "1"));
  }, []);

  if (!show || dismissed) return null;

  const dismiss = () => { setDismissed(true); AsyncStorage.setItem(KEY, "1"); };

  return (
    <View style={styles.wrap} testID="season-nudge">
      <Ionicons name="calendar-outline" size={18} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.text}>You have data spanning more than a year — create a season to filter by year and roll your roster forward.</Text>
        <TouchableOpacity onPress={() => router.push("/seasons" as any)} testID="season-nudge-cta">
          <Text style={styles.cta}>Set up a season</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="season-nudge-dismiss">
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: colors.accentSubtle, borderRadius: radius.md,
    padding: 12, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.accent + "33",
  },
  text: { ...typography.caption, color: colors.textPrimary, lineHeight: 18 },
  cta: { ...typography.caption, color: colors.accent, fontWeight: "800", marginTop: 6 },
});
