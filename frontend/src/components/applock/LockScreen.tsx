import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Alert, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PinPad, { BRAND } from "./PinPad";
import BrandCover from "./BrandCover";
import { AppLockConfig, retryWaitMs, verifyPasscode, resetAttempts } from "@/src/utils/appLock";
import { biometricAuthenticate } from "@/src/utils/appLock/biometrics";

type Props = {
  config: AppLockConfig;
  bio: { available: boolean; label: string };
  onUnlocked: () => void;
  onForgot: () => void;
  /** wraps the OS biometric prompt so the provider ignores the app-state blip it causes */
  runExternal: <T>(fn: () => Promise<T>) => Promise<T>;
};

const RECOVERY_MSG =
  "If you forget your App Lock passcode, you can turn App Lock off by signing out and signing back into your CheerPlanner account. " +
  "Your existing account email and password will be required. None of your teams, athletes or other data will be deleted.";

/** Full-screen CheerPlanner lock screen. Shows no account, team, athlete or schedule info. */
export default function LockScreen({ config, bio, onUnlocked, onForgot, runExternal }: Props) {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [errSeq, setErrSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const bioOn = config.biometric && bio.available;
  const prompted = useRef(false);

  useEffect(() => {
    retryWaitMs().then((ms) => ms > 0 && setWaitUntil(Date.now() + ms));
  }, []);

  const tryBiometric = useCallback(async () => {
    const ok = await runExternal(() => biometricAuthenticate("Unlock CheerPlanner"));
    if (ok) {
      await resetAttempts();
      onUnlocked();
    }
  }, [onUnlocked, runExternal]);

  useEffect(() => {
    if (bioOn && !prompted.current) {
      prompted.current = true;
      tryBiometric();
    }
  }, [bioOn, tryBiometric]);

  const submit = async (pin: string) => {
    setBusy(true);
    try {
      const r = await verifyPasscode(pin, config);
      if (r.ok) {
        onUnlocked();
        return;
      }
      setWaitUntil(r.waitMs ? Date.now() + r.waitMs : 0);
      setError(r.waitMs ? null : r.remainingFree > 0 && r.remainingFree <= 2
        ? `Incorrect passcode. ${r.remainingFree} ${r.remainingFree === 1 ? "try" : "tries"} left before a short wait.`
        : "Incorrect passcode. Try again.");
      setErrSeq((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const forgot = () => {
    const title = "Forgot passcode?";
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${RECOVERY_MSG}\n\nSign out now?`)) onForgot();
      return;
    }
    Alert.alert(title, RECOVERY_MSG, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: onForgot },
    ]);
  };

  return (
    <BrandCover>
      <View style={[s.body, { paddingBottom: insets.bottom + 16 }]}>
        <PinPad
          title="CheerPlanner is locked"
          subtitle={bioOn ? `Use ${bio.label} or enter your passcode` : "Enter your 6-digit passcode"}
          error={error}
          errorKey={errSeq}
          busy={busy}
          waitUntil={waitUntil}
          onComplete={submit}
          leftKey={bioOn ? { icon: "finger-print", label: `Unlock with ${bio.label}`, onPress: tryBiometric } : null}
          testIDPrefix="lock"
        />
        <TouchableOpacity onPress={forgot} style={s.forgot} testID="lock-forgot">
          <Text style={s.forgotText}>Forgot passcode?</Text>
        </TouchableOpacity>
      </View>
    </BrandCover>
  );
}

const s = StyleSheet.create({
  body: { alignItems: "center", width: "100%" },
  forgot: { marginTop: 20, minHeight: 44, paddingHorizontal: 16, justifyContent: "center" },
  forgotText: { color: BRAND.white, fontSize: 15, fontWeight: "700", textDecorationLine: "underline" },
});
