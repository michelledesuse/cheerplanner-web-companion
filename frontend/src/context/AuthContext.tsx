import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { loginRevenueCat, logoutRevenueCat } from "@/src/lib/revenuecat";
import { analytics } from "@heycatch/sdk";

function identify(u: UserPublic) {
  analytics.setIdentity(u.id, { email: u.email, name: u.name ?? undefined }, { signup_date: u.created_at });
}

export type UserPublic = {
  id: string;
  email: string;
  name?: string | null;
  created_at: string;
  team_access?: boolean;
  is_admin?: boolean;
  visibility?: { expenses: boolean; travel: boolean } | null;
  team_tool_order?: string[] | null;
};

type AuthContextValue = {
  user: UserPublic | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Detect the device's IANA timezone and persist it so reminders fire in the
// user's ACTUAL local time (not the server default). Fire-and-forget; updates
// automatically if the user travels to a new zone.
let _lastSyncedTz: string | null = null;
async function syncDeviceTimezone() {
  try {
    const tz = Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone;
    if (tz && typeof tz === "string" && tz.includes("/") && tz !== _lastSyncedTz) {
      _lastSyncedTz = tz;
      await api.patch("/notifications/preferences", { timezone: tz });
    }
  } catch {
    /* ignore — reminders fall back to the stored/default timezone */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const res = await api.get("/auth/me");
      setUser(res.data as UserPublic);
      loginRevenueCat((res.data as UserPublic).id);
      identify(res.data as UserPublic);
      syncDeviceTimezone();
    } catch (e: any) {
      // Only sign the user out when the token is genuinely rejected (401).
      // Transient errors (network blips, 5xx) must NOT wipe the session.
      const status = e?.response?.status;
      if (status === 401) {
        await storage.secureRemove(TOKEN_KEY);
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  const signIn = async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    await storage.secureSet(TOKEN_KEY, res.data.access_token);
    setUser(res.data.user as UserPublic);
    loginRevenueCat(res.data.user.id);
    identify(res.data.user as UserPublic);
    syncDeviceTimezone();
  };

  const signUp = async (email: string, password: string, name?: string) => {
    const res = await api.post("/auth/signup", { email, password, name });
    await storage.secureSet(TOKEN_KEY, res.data.access_token);
    setUser(res.data.user as UserPublic);
    loginRevenueCat(res.data.user.id);
    identify(res.data.user as UserPublic);
    analytics.trackEvent("signup_completed");
    syncDeviceTimezone();
  };

  const signOut = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
    logoutRevenueCat();
    analytics.resetIdentity();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
