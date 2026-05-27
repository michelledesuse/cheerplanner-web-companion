import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

export type UserPublic = {
  id: string;
  email: string;
  name?: string | null;
  created_at: string;
};

type AuthContextValue = {
  user: UserPublic | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (!token) {
        setUser(null);
        return;
      }
      const res = await api.get("/auth/me");
      setUser(res.data as UserPublic);
    } catch (_e) {
      await storage.secureRemove(TOKEN_KEY);
      setUser(null);
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
  };

  const signUp = async (email: string, password: string, name?: string) => {
    const res = await api.post("/auth/signup", { email, password, name });
    await storage.secureSet(TOKEN_KEY, res.data.access_token);
    setUser(res.data.user as UserPublic);
  };

  const signOut = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
