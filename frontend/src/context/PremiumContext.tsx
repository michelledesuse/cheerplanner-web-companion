import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";

export type PremiumStatus = {
  is_premium: boolean;
  plan: string; // free | monthly | annual | lifetime | promo
  source?: string | null;
  expires_at?: string | null;
  entitlement_id?: string | null;
  household_id?: string | null;
};

export type PlanConfig = {
  limits: Record<string, Record<string, number>>;
  pricing: any;
  premium_team_hub_features: string[];
};

type PremiumContextValue = {
  status: PremiumStatus | null;
  config: PlanConfig | null;
  isPremium: boolean;
  loading: boolean;
  /** limit for a key in the CURRENT tier; -1 = unlimited, undefined = not found */
  limit: (key: string) => number;
  /** true if a premium team-hub feature flag is gated for this user */
  isFeatureLocked: (feature: string) => boolean;
  refresh: () => Promise<void>;
};

const PremiumContext = createContext<PremiumContextValue | undefined>(undefined);

export function PremiumProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [config, setConfig] = useState<PlanConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      const [s, c] = await Promise.all([
        api.get<PremiumStatus>("/premium/status"),
        api.get<PlanConfig>("/entitlements/config"),
      ]);
      setStatus(s.data);
      setConfig(c.data);
    } catch {
      // Don't strip access on a transient failure — keep any cached status.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const isPremium = !!status?.is_premium;

  const limit = useCallback(
    (key: string) => {
      const tier = isPremium ? "premium" : "free";
      const v = config?.limits?.[tier]?.[key];
      return typeof v === "number" ? v : 0;
    },
    [config, isPremium]
  );

  const isFeatureLocked = useCallback(
    (feature: string) => !isPremium && !!config?.premium_team_hub_features?.includes(feature),
    [config, isPremium]
  );

  return (
    <PremiumContext.Provider value={{ status, config, isPremium, loading, limit, isFeatureLocked, refresh }}>
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used within PremiumProvider");
  return ctx;
}
