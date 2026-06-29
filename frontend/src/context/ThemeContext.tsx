import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { api } from "@/src/api/client";
import { colors as themeColors } from "@/src/theme";

const STORAGE_KEY = "cheerplanner:theme_palette_v1";

export type ThemePalette = typeof themeColors;

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
  savedPresets: ThemePreset[];
  version: number; // bumps on every theme change so consumers re-render
  palette: ThemePalette; // fresh object identity on every theme change
  refreshPresets: () => Promise<void>;
  applyPreset: (preset: ThemePreset) => Promise<void>;
  saveCurrentTheme: (name: string, preset: ThemePreset) => Promise<void>;
  deleteSavedTheme: (id: string) => Promise<void>;
};

const Ctx = createContext<ThemeContextValue>({
  presetId: "red_white",
  presets: [],
  savedPresets: [],
  version: 0,
  palette: { ...themeColors },
  refreshPresets: async () => {},
  applyPreset: async () => {},
  saveCurrentTheme: async () => {},
  deleteSavedTheme: async () => {},
});

/**
 * Mutates the shared `colors` object in place (so legacy inline `colors.X`
 * references stay live) AND returns a fresh palette snapshot. Consumers that
 * use the `useThemedStyles` hook read the snapshot from context, so a new
 * object identity guarantees their memoized StyleSheets rebuild on every
 * theme change — including bg / card / textPrimary, not just accent.
 */
function applyToPalette(p: ThemePreset): ThemePalette {
  themeColors.accent = p.accent;
  themeColors.accentSubtle = p.accentSubtle;
  themeColors.accentBorder = p.accent + "55"; // semi-transparent
  themeColors.bg = p.bg;
  themeColors.card = p.card;
  themeColors.textPrimary = p.textPrimary;
  return { ...themeColors };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [presetId, setPresetId] = useState<string>("red_white");
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [savedPresets, setSavedPresets] = useState<ThemePreset[]>([]);
  const [version, setVersion] = useState(0);
  const [palette, setPalette] = useState<ThemePalette>({ ...themeColors });

  // 1) On mount, restore cached palette from AsyncStorage so the first paint
  //    uses the user's chosen theme (no flash of default red).
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY);
        if (cached) {
          const p: ThemePreset = JSON.parse(cached);
          setPalette(applyToPalette(p));
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
        api.get<{ theme?: { preset_id?: string; custom?: Partial<ThemePreset>; saved?: ThemePreset[] } }>("/household"),
      ]);
      const list = presetsRes.data?.presets || [];
      setPresets(list);
      const theme = householdRes.data?.theme;
      const saved = theme?.saved || [];
      setSavedPresets(saved);
      const wantedId = theme?.preset_id || "red_white";
      // Custom theme: the palette lives in household.theme.custom (not the preset list).
      if (wantedId === "custom" && theme?.custom) {
        const custom = {
          id: "custom",
          name: "Custom",
          tabActive: theme.custom.tabActive || theme.custom.accent,
          ...theme.custom,
        } as ThemePreset;
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
        setPalette(applyToPalette(custom));
        setPresetId("custom");
        setVersion((v) => v + 1);
        return;
      }
      const wanted = list.find((p) => p.id === wantedId) || saved.find((s) => s.id === wantedId) || list[0];
      if (wanted) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(wanted));
        setPalette(applyToPalette(wanted));
        setPresetId(wanted.id);
        setVersion((v) => v + 1);
      }
    } catch {
      // network error — keep cached theme
    }
  }, []);

  const applyPreset = useCallback(async (preset: ThemePreset) => {
    // Apply immediately, then persist server-side. Errors don't roll back.
    setPalette(applyToPalette(preset));
    setPresetId(preset.id);
    setVersion((v) => v + 1);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preset));
    } catch {}
    try {
      if (preset.id === "custom") {
        await api.patch("/household/theme", {
          preset_id: "custom",
          custom: {
            accent: preset.accent,
            accentSubtle: preset.accentSubtle,
            bg: preset.bg,
            card: preset.card,
            textPrimary: preset.textPrimary,
            tabActive: preset.tabActive,
          },
        });
      } else {
        await api.patch("/household/theme", { preset_id: preset.id });
      }
    } catch {
      // theme stays locally even if server save fails; will retry on next pick
    }
  }, []);

  const saveCurrentTheme = useCallback(async (name: string, preset: ThemePreset) => {
    setPalette(applyToPalette(preset));
    setVersion((v) => v + 1);
    try {
      const res = await api.post<{ preset: ThemePreset; theme: { saved?: ThemePreset[] } }>(
        "/household/theme/saved",
        {
          name,
          accent: preset.accent,
          accentSubtle: preset.accentSubtle,
          bg: preset.bg,
          card: preset.card,
          textPrimary: preset.textPrimary,
          tabActive: preset.tabActive,
        },
      );
      const entry = res.data?.preset;
      if (entry) {
        setSavedPresets(res.data?.theme?.saved || []);
        setPresetId(entry.id);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
      }
    } catch {}
  }, []);

  const deleteSavedTheme = useCallback(async (id: string) => {
    try {
      const res = await api.delete<{ theme: { saved?: ThemePreset[] } }>(`/household/theme/saved/${id}`);
      setSavedPresets(res.data?.theme?.saved || []);
    } catch {}
  }, []);

  return (
    <Ctx.Provider value={{ presetId, presets, savedPresets, version, palette, refreshPresets, applyPreset, saveCurrentTheme, deleteSavedTheme }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  return useContext(Ctx);
}
