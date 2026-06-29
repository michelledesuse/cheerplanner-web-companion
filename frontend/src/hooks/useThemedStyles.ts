/**
 * useThemedStyles — return a memoized StyleSheet that rebuilds whenever the
 * active theme changes.
 *
 * Usage:
 *   const styles = useThemedStyles((c) => ({
 *     container: { backgroundColor: c.bg },
 *     title: { color: c.textPrimary },
 *   }));
 *
 * Why: `StyleSheet.create({...colors.bg})` at module level snapshots primitive
 * color strings at import time, so the theme switch never propagates. Inside
 * a component using this hook, the factory is re-run on every theme version
 * bump, so colors stay live.
 */
import { useMemo } from "react";
import { StyleSheet } from "react-native";

import { useTheme } from "@/src/context/ThemeContext";
import { colors as defaultColors } from "@/src/theme";

export type ThemePalette = typeof defaultColors;

export function useThemedStyles<T extends Record<string, any>>(
  factory: (c: ThemePalette) => T,
): T {
  const { version } = useTheme();
  // We deliberately re-create on every version bump so primitive colors are fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(defaultColors)) as unknown as T, [version, factory]);
}
