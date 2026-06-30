import React from "react";
import { Image, View } from "react-native";

import { colors } from "@/src/theme";

type Props = {
  /** Base64/URI of the uploaded team logo (when set, it is shown instead of the dot). */
  logoImage?: string | null;
  /** Team accent color, used for the fallback dot when no logo is uploaded. */
  color?: string | null;
  /** Diameter in px. */
  size?: number;
  /**
   * Color to use for the fallback dot. Lets callers override (e.g. show a
   * white dot on a selected/colored chip). Ignored when a logo is present.
   */
  dotColor?: string;
};

/**
 * Small circular team marker shown next to a team name anywhere the team is
 * mentioned. Renders the uploaded logo when available, otherwise falls back to
 * the team's solid color dot (preserving the prior look for teams without a logo).
 */
export default function TeamAvatar({ logoImage, color, size = 20, dotColor }: Props) {
  if (logoImage) {
    return (
      <Image
        source={{ uri: logoImage }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.bg,
        }}
        resizeMode="cover"
      />
    );
  }
  // Fallback: keep the original small dot proportions when no logo is set.
  const dot = Math.max(8, Math.round(size * 0.45));
  return (
    <View
      style={{
        width: dot,
        height: dot,
        borderRadius: dot / 2,
        backgroundColor: dotColor || color || colors.accent,
      }}
    />
  );
}
