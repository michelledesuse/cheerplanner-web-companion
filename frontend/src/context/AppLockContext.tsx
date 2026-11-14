/**
 * App Lock provider — sits above the whole navigator so no route, deep link,
 * notification or browser navigation can render content while locked.
 *
 * Locks: on cold start (if enabled), on return from background after the
 * chosen timeout ("Immediately" = any time the app leaves the foreground), and
 * after the same period of no touches while open (timeouts > 0).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { AppState, AppStateStatus, Modal, Platform, View } from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import { router } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import LockScreen from "@/src/components/applock/LockScreen";
import BrandCover from "@/src/components/applock/BrandCover";
import * as AL from "@/src/utils/appLock";
import { biometricSupport } from "@/src/utils/appLock/biometrics";

type Ctx = {
  ready: boolean;
  config: AL.AppLockConfig | null;
  bio: { available: boolean; label: string };
  setPasscode: (pin: string) => Promise<void>;
  verify: (pin: string) => Promise<AL.VerifyResult>;
  disable: () => Promise<void>;
  updateOptions: (patch: Partial<AL.AppLockOptions>) => Promise<void>;
  runExternal: <T>(fn: () => Promise<T>) => Promise<T>;
};

const AppLockContext = createContext<Ctx | undefined>(undefined);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AL.AppLockConfig | null>(null);
  const [locked, setLocked] = useState(false);
  const [cover, setCover] = useState(false);
  const [bio, setBio] = useState({ available: false, label: "Biometrics" });
  const cfgRef = useRef<AL.AppLockConfig | null>(null);
  cfgRef.current = config;
  const backgroundAt = useRef<number | null>(null);
  const lastActive = useRef(Date.now());
  const external = useRef(false); // OS prompt (biometric / picker) in progress

  // Cold start: locked if enabled.
  useEffect(() => {
    (async () => {
      const c = await AL.loadConfig();
      setConfig(c);
      setLocked(!!c);
      setReady(true);
      setBio(await biometricSupport());
    })();
  }, []);

  // Recovery path: any sign-out (incl. "Forgot passcode") removes App Lock from
  // this device. Signing back in requires the account email + password.
  const prevUser = useRef(user);
  useEffect(() => {
    if (prevUser.current && !user) {
      AL.clearAppLock().finally(() => { setConfig(null); setLocked(false); });
    }
    prevUser.current = user;
  }, [user]);

  // Background / foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      const c = cfgRef.current;
      if (!c || external.current) return;
      if (s === "inactive" || s === "background") {
        setCover(true); // hides content from the app switcher snapshot
        if (s === "background") {
          backgroundAt.current = Date.now();
          if (c.timeout === 0) setLocked(true);
        }
      } else if (s === "active") {
        if (backgroundAt.current != null && Date.now() - backgroundAt.current >= c.timeout * 1000) setLocked(true);
        backgroundAt.current = null;
        lastActive.current = Date.now();
        setCover(false);
      }
    });
    return () => sub.remove();
  }, []);

  // Inactivity while open (for 1/5/15-minute settings).
  useEffect(() => {
    const t = setInterval(() => {
      const c = cfgRef.current;
      if (c && c.timeout > 0 && !external.current && Date.now() - lastActive.current >= c.timeout * 1000) setLocked(true);
    }, 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const mark = () => { lastActive.current = Date.now(); };
    const evts = ["keydown", "mousemove", "wheel", "touchstart", "pointerdown", "scroll"];
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => evts.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  // Block screenshots / screen recording / Android recents thumbnail while App Lock is on.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const protect = !!config && config.privacy !== false;
    (protect ? ScreenCapture.preventScreenCaptureAsync("applock") : ScreenCapture.allowScreenCaptureAsync("applock")).catch(() => {});
  }, [config]);

  const runExternal = useCallback(async <T,>(fn: () => Promise<T>) => {
    external.current = true;
    try {
      return await fn();
    } finally {
      // the OS prompt's own app-state events arrive just after it resolves
      setTimeout(() => { external.current = false; lastActive.current = Date.now(); }, 800);
    }
  }, []);

  const unlock = useCallback(() => {
    lastActive.current = Date.now();
    setLocked(false);
    setCover(false);
  }, []);

  const forgot = useCallback(async () => {
    // Uses the existing sign-out. App Lock is cleared first so the login screen
    // is reachable; signing back in needs the account email + password.
    await AL.clearAppLock();
    setConfig(null);
    setLocked(false);
    await signOut();
    setTimeout(() => router.replace("/login"), 50); // let the navigator remount first (web)
  }, [signOut]);

  const value: Ctx = {
    ready,
    config,
    bio,
    setPasscode: async (pin) => setConfig(await AL.setPasscode(pin, cfgRef.current)),
    verify: async (pin) => (cfgRef.current ? AL.verifyPasscode(pin, cfgRef.current) : { ok: true }),
    disable: async () => { await AL.clearAppLock(); setConfig(null); },
    updateOptions: async (patch) => { if (cfgRef.current) setConfig(await AL.updateOptions(cfgRef.current, patch)); },
    runExternal,
  };

  const showLock = ready && !!config && locked;
  const showCover = !ready || (!!config && cover && !locked);
  const hidden = showLock || showCover;

  return (
    <AppLockContext.Provider value={value}>
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => { lastActive.current = Date.now(); return false; }}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      >
        {/* Web: don't even render the app while locked/loading (no DOM text for
            DevTools/Ctrl+F/print). The URL stays put, so the same page comes
            back on unlock. Native keeps it mounted (hidden) to preserve
            navigation state across quick app switches. */}
        {Platform.OS === "web" && hidden ? null : children}
      </View>
      {showCover && <BrandCover />}
      {/* Modal so the lock sits above any sheet/modal that was open */}
      <Modal visible={showLock} animationType="none" transparent={false} statusBarTranslucent onRequestClose={() => {}}>
        {showLock && config && (
          <LockScreen config={config} bio={bio} onUnlocked={unlock} onForgot={forgot} runExternal={runExternal} />
        )}
      </Modal>
    </AppLockContext.Provider>
  );
}

export function useAppLock(): Ctx {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within AppLockProvider");
  return ctx;
}
