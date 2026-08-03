import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";

export type Season = {
  id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean;
  order: number;
};

type SeasonContextValue = {
  seasons: Season[];
  activeSeason: Season | null;
  /** The season the app's lists are currently filtered to. null = "All seasons". */
  filterSeasonId: string | null;
  setFilterSeasonId: (id: string | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Persistently mark a season active for the whole household. */
  activate: (id: string) => Promise<void>;
};

const SeasonContext = createContext<SeasonContextValue>({
  seasons: [], activeSeason: null, filterSeasonId: null,
  setFilterSeasonId: () => {}, loading: false, refresh: async () => {}, activate: async () => {},
});

export function SeasonProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [filterSeasonId, setFilterSeasonId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const r = await api.get<Season[]>("/seasons");
      const list = r.data || [];
      setSeasons(list);
      const active = list.find((s) => s.is_active) || null;
      setInitialized((wasInit) => {
        // On first load, default the filter to the active season.
        if (!wasInit) setFilterSeasonId(active ? active.id : null);
        else setFilterSeasonId((cur) => (cur && list.some((s) => s.id === cur) ? cur : active ? active.id : null));
        return true;
      });
    } catch {
      // ignore — Seasons is optional
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) refresh();
    else { setSeasons([]); setFilterSeasonId(null); setInitialized(false); }
  }, [user, refresh]);

  const activate = useCallback(async (id: string) => {
    await api.post(`/seasons/${id}/activate`, {});
    setFilterSeasonId(id);
    await refresh();
  }, [refresh]);

  const activeSeason = seasons.find((s) => s.is_active) || null;

  return (
    <SeasonContext.Provider value={{ seasons, activeSeason, filterSeasonId, setFilterSeasonId, loading, refresh, activate }}>
      {children}
    </SeasonContext.Provider>
  );
}

export function useSeason() {
  return useContext(SeasonContext);
}
