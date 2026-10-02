import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

import { useTheme } from "@/src/context/ThemeContext";

/**
 * The official CheerPlanner wordmark: "Cheer" in brand blue (#0000FF) and
 * "Planner" in black (#000000). On dark backgrounds the "Planner" half follows
 * the theme's primary text color so it stays readable (black→white), keeping to
 * the brand palette of blue / black / white.
 *
 * Renders a <Text>, so it can stand alone OR be nested inline inside another
 * <Text> (it inherits the surrounding font size/weight; only the color of each
 * half is fixed).
 */
export const BRAND_BLUE = "#0000FF";

export default function BrandName({
  style,
  cheerColor,
  plannerColor,
  testID,
}: {
  style?: StyleProp<TextStyle>;
  /** Override the "Cheer" color (defaults to brand blue). */
  cheerColor?: string;
  /** Override the "Planner" color (defaults to the theme's primary text). */
  plannerColor?: string;
  testID?: string;
}) {
  const { palette } = useTheme();
  const planner = plannerColor || palette.textPrimary;
  return (
    <Text style={style} testID={testID} allowFontScaling>
      <Text style={{ color: cheerColor || BRAND_BLUE }}>Cheer</Text>
      <Text style={{ color: planner }}>Planner</Text>
    </Text>
  );
}
