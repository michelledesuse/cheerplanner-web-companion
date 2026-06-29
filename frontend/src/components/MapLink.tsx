import React from "react";
import { Linking, Platform, Pressable, Text, View, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import { colors, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type Props = {
  /** The address / venue name / location text to display and look up. */
  address: string | null | undefined;
  /** Fallback shown when address is empty (e.g. "Location TBD"). When falsy, returns null. */
  placeholder?: string;
  /** Optional secondary line (e.g. "Convention Center") to bias the search. */
  hint?: string;
  /** Style variant: "inline" (no chip, just colored text) or "chip" (pill background). */
  variant?: "inline" | "chip" | "hero";
  /** Override the small icon. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Visual tint for chip background / underline. Defaults to accent. */
  color?: string;
  /** Optional ellipsis on overflow. */
  numberOfLines?: number;
  /** Wraps content; use undefined to let it auto-size. */
  style?: any;
  testID?: string;
};

/**
 * Tappable address that opens the platform's native maps app.
 *
 * - iOS  → Apple Maps via `http://maps.apple.com/?q=...`
 * - Android → Google Maps via `geo:0,0?q=...` (falls back to https URL)
 * - Web  → Google Maps web search in a new tab
 *
 * The component is purely display-only. It renders nothing if `address` is
 * empty and no `placeholder` was given.
 */
export default function MapLink({
  address,
  placeholder,
  hint,
  variant = "inline",
  icon = "location-outline",
  color = colors.accent,
  numberOfLines,
  style,
  testID,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const trimmed = (address || "").trim();
  if (!trimmed && !placeholder) return null;

  const display = trimmed || placeholder || "";
  const isPlaceholder = !trimmed;

  const handlePress = async () => {
    if (isPlaceholder) return;
    const query = encodeURIComponent(hint ? `${trimmed}, ${hint}` : trimmed);
    // Always use a Google Maps web URL so it renders inside the in-app
    // browser. This keeps the user in CheerPlanner with an obvious "Done"
    // (iOS) or back button (Android) instead of being punted out to Apple
    // Maps app with no way to return.
    const url = `https://www.google.com/maps/search/?api=1&query=${query}`;

    try {
      if (Platform.OS === "web") {
        // On web, just open in a new tab — the browser tab itself acts as
        // the "back" affordance.
        await Linking.openURL(url);
        return;
      }
      await WebBrowser.openBrowserAsync(url, {
        // iOS: SFSafariViewController-style sheet that animates back to the app.
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        // Tint the controls so they match CheerPlanner's accent.
        controlsColor: colors.accent,
        toolbarColor: colors.bg,
        dismissButtonStyle: "done",
        // Android Chrome Custom Tab options
        showTitle: true,
        enableBarCollapsing: true,
      });
    } catch (_e) {
      // Fallback: try a plain external open.
      try { await Linking.openURL(url); }
      catch { Alert.alert("Couldn't open maps", "We weren't able to open the map for that address."); }
    }
  };

  const containerStyle =
    variant === "chip" ? styles.chip
    : variant === "hero" ? styles.hero
    : styles.inline;
  const textColorStyle =
    variant === "hero" ? { color: "rgba(255,255,255,0.95)" }
    : { color: isPlaceholder ? colors.textTertiary : color };
  const iconColor =
    variant === "hero" ? "rgba(255,255,255,0.85)" : (isPlaceholder ? colors.textTertiary : color);

  return (
    <Pressable
      onPress={handlePress}
      disabled={isPlaceholder}
      hitSlop={6}
      style={({ pressed }) => [containerStyle, pressed && !isPlaceholder && { opacity: 0.55 }, style]}
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={isPlaceholder ? display : `Open ${display} in maps`}
    >
      <Ionicons name={icon} size={variant === "hero" ? 14 : 13} color={iconColor} />
      <Text
        style={[
          variant === "hero" ? styles.heroText : styles.inlineText,
          textColorStyle,
          !isPlaceholder && variant !== "hero" && styles.underline,
        ]}
        numberOfLines={numberOfLines}
      >
        {display}
      </Text>
      {!isPlaceholder && variant !== "hero" && (
        <Ionicons name="open-outline" size={11} color={iconColor} style={{ marginLeft: 2 }} />
      )}
    </Pressable>
  );
}

const makeStyles = () => ({
  inline: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  inlineText: { ...typography.caption, fontSize: 13 },
  underline: { textDecorationLine: "underline" },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: colors.accentSubtle, borderRadius: 999,
    flexShrink: 1,
  },
  hero: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  heroText: { ...typography.caption, fontSize: 13, fontWeight: "500" },
});

/** Helper used by callers that just want the URL (e.g. to render a custom UI). */
export function mapsUrlFor(address: string, hint?: string): string {
  const q = encodeURIComponent(hint ? `${address}, ${hint}` : address);
  if (Platform.OS === "ios") return `http://maps.apple.com/?q=${q}`;
  if (Platform.OS === "android") return `geo:0,0?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// Re-export View for callers that want to compose
export { View };
