import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Modal, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const LAST_SHOWN_KEY = "rate_prompt_last_shown_at";
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // rolling 2 weeks

type Ctx = { promptRating: (reason?: string) => Promise<void> };
const RatePromptContext = createContext<Ctx>({ promptRating: async () => {} });

export function useRatePrompt() {
  return useContext(RatePromptContext);
}

export function RatePromptProvider({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const [visible, setVisible] = useState(false);
  const inFlight = useRef(false);

  const promptRating = useCallback(async () => {
    if (inFlight.current || visible) return;
    inFlight.current = true;
    try {
      const last = await AsyncStorage.getItem(LAST_SHOWN_KEY);
      if (last && Date.now() - Number(last) < COOLDOWN_MS) return; // within 2 weeks → skip
      // Record immediately so we never prompt more than once per 2-week window.
      await AsyncStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
      setVisible(true);
    } finally {
      inFlight.current = false;
    }
  }, [visible]);

  const close = () => setVisible(false);

  const onRate = async () => {
    close();
    try {
      if (await StoreReview.isAvailableAsync()) {
        await StoreReview.requestReview();
        return;
      }
      const url = await StoreReview.storeUrl();
      if (url) {
        const { Linking } = require("react-native");
        Linking.openURL(url);
      }
    } catch {
      /* no-op: rating unavailable in this environment */
    }
  };

  return (
    <RatePromptContext.Provider value={{ promptRating }}>
      {children}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <View style={styles.card} testID="rate-prompt-card">
            <View style={styles.iconWrap}>
              <Ionicons name="star" size={26} color="#F59E0B" />
            </View>
            <Text style={styles.title}>Enjoying CheerPlanner?</Text>
            <Text style={styles.body}>
              A quick rating helps other cheer families discover the app. It only takes a few seconds!
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onRate} testID="rate-prompt-rate">
              <Ionicons name="star-outline" size={18} color="#fff" />
              <Text style={styles.primaryText}>Rate CheerPlanner</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={close} testID="rate-prompt-later">
              <Text style={styles.secondaryText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </RatePromptContext.Provider>
  );
}

const makeStyles = (c: ThemePalette) => ({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", padding: spacing.lg,
  },
  card: {
    width: "100%", maxWidth: 380, backgroundColor: c.card, borderRadius: radius.xl,
    padding: spacing.lg, alignItems: "center", gap: spacing.sm,
    borderWidth: 1, borderColor: c.border,
  },
  iconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "#FEF3C7",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  title: { ...typography.h3, color: c.textPrimary, textAlign: "center" as const },
  body: { ...typography.body, color: c.textSecondary, textAlign: "center" as const, lineHeight: 21, marginBottom: spacing.sm },
  primaryBtn: {
    flexDirection: "row" as const, alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 13, width: "100%",
  },
  primaryText: { color: "#fff", fontWeight: "800" as const, fontSize: 15 },
  secondaryBtn: { paddingVertical: 10, width: "100%", alignItems: "center" },
  secondaryText: { ...typography.body, color: c.textSecondary, fontWeight: "600" as const },
});
