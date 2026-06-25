import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { api } from "@/src/api/client";
import { colors as themeColors } from "@/src/theme";

const STORAGE_KEY = "cheerplanner:theme_palette_v1";

export type ThemePreset = {
  id: string;
  name: string;
  accent: string;
  accentSubtle: string;
  bg: string;
  card: string;
  textPrimary: string;
  tabActive: string;
};

type ThemeContextValue = {
  presetId: string;
  presets: ThemePreset[];
  version: number; // bumps on every theme change so consumers re-render
  refreshPresets: () => Promise<void>;
  applyPreset: (preset: ThemePreset) => Promise<void>;
};

const Ctx = createContext<ThemeContextValue>({
  presetId: "red_white",
  presets: [],
  version: 0,
  refreshPresets: async () => {},
  applyPreset: async () => {},
});

/**
 * Mutates the shared `colors` object in place so static imports across the
 * app see the new palette. We additionally bump a version counter in context
 * so any component that uses `useTheme()` re-renders.
 *
 * Trade-off: components that DON'T use the hook only see the new colors on
 * their next re-render (route change, refresh, etc.). That's good enough for
 * v1.0.8 — incremental rollout to `useTheme()` happens screen-by-screen.
 */
function mutateColors(p: ThemePreset) {
  themeColors.accent = p.accent;
  themeColors.accentSubtle = p.accentSubtle;
  themeColors.accentBorder = p.accent + "55"; // semi-transparent
  themeColors.bg = p.bg;
  themeColors.card = p.card;
  themeColors.textPrimary = p.textPrimary;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [presetId, setPresetId] = useState<string>("red_white");
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [version, setVersion] = useState(0);

  // 1) On mount, restore cached palette from AsyncStorage so the first paint
  //    uses the user's chosen theme (no flash of default red).
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY);
        if (cached) {
          const p: ThemePreset = JSON.parse(cached);
          mutateColors(p);
          setPresetId(p.id);
          setVersion((v) => v + 1);
        }
      } catch {}
    })();
  }, []);

  const refreshPresets = useCallback(async () => {
    try {
      const [presetsRes, householdRes] = await Promise.all([
        api.get<{ presets: ThemePreset[] }>("/themes/presets"),
        api.get<{ theme?: { preset_id?: string } }>("/household"),
      ]);
      const list = presetsRes.data?.presets || [];
      setPresets(list);
      const wantedId = householdRes.data?.theme?.preset_id || "red_white";
      const wanted = list.find((p) => p.id === wantedId) || list[0];
      if (wanted) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(wanted));
        mutateColors(wanted);
        setPresetId(wanted.id);
        setVersion((v) => v + 1);
      }
    } catch {
      // network error — keep cached theme
    }
  }, []);

  const applyPreset = useCallback(async (preset: ThemePreset) => {
    // Apply immediately, then persist server-side. Errors don't roll back.
    mutateColors(preset);
    setPresetId(preset.id);
    setVersion((v) => v + 1);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preset));
    } catch {}
    try {
      await api.patch("/household/theme", { preset_id: preset.id });
    } catch {
      // theme stays locally even if server save fails; will retry on next pick
    }
  }, []);

  return (
    <Ctx.Provider value={{ presetId, presets, version, refreshPresets, applyPreset }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  return useContext(Ctx);
}
