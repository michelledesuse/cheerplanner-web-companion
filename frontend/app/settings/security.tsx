import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Switch, Modal, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAppLock } from "@/src/context/AppLockContext";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { colors, radius, spacing, typography } from "@/src/theme";
import { TIMEOUT_OPTIONS } from "@/src/utils/appLock";
import { biometricAuthenticate } from "@/src/utils/appLock/biometrics";
import PinPad, { BRAND } from "@/src/components/applock/PinPad";

type Flow = "enable" | "change" | "disable";
type Step = "current" | "new" | "confirm";

const WEB_NOTICE =
  "On the web app, App Lock is saved in this browser only. If you clear this browser's history, cookies or site data, " +
  "App Lock turns off and you'll need to set up your passcode again in Settings → Security → App Lock.";

function notify(title: string, msg: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

export default function SecurityScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const lock = useAppLock();
  const cfg = lock.config;
  const [flow, setFlow] = useState<Flow | null>(null);

  const toggleBiometric = async (on: boolean) => {
    if (on) {
      const ok = await lock.runExternal(() => biometricAuthenticate(`Turn on ${lock.bio.label} for CheerPlanner`));
      if (!ok) return;
    }
    await lock.updateOptions({ biometric: on });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="security-back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Security</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>APP LOCK</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Enable App Lock</Text>
              <Text style={styles.rowSub}>Ask for a 6-digit passcode to open CheerPlanner on this device</Text>
            </View>
            <Switch
              value={!!cfg}
              onValueChange={(v) => setFlow(v ? "enable" : "disable")}
              trackColor={{ true: colors.accent, false: colors.border }}
              testID="applock-toggle"
            />
          </View>
          {cfg && (
            <TouchableOpacity style={styles.row} onPress={() => setFlow("change")} testID="applock-change">
              <Text style={[styles.rowLabel, { flex: 1 }]}>Change passcode</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          {cfg && lock.bio.available && (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Unlock with {lock.bio.label}</Text>
                <Text style={styles.rowSub}>Your passcode still works if this fails</Text>
              </View>
              <Switch value={!!cfg.biometric} onValueChange={toggleBiometric} trackColor={{ true: colors.accent, false: colors.border }} testID="applock-biometric" />
            </View>
          )}
          {cfg && Platform.OS !== "web" && (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Hide in screenshots & app switcher</Text>
                <Text style={styles.rowSub}>Blocks screenshots and screen recording while App Lock is on</Text>
              </View>
              <Switch value={cfg.privacy !== false} onValueChange={(v) => lock.updateOptions({ privacy: v })} trackColor={{ true: colors.accent, false: colors.border }} testID="applock-privacy" />
            </View>
          )}
        </View>

        {cfg && (
          <>
            <Text style={styles.sectionLabel}>REQUIRE PASSCODE</Text>
            <View style={styles.group}>
              {TIMEOUT_OPTIONS.map((o) => (
                <TouchableOpacity key={o.seconds} style={styles.row} onPress={() => lock.updateOptions({ timeout: o.seconds })} testID={`applock-timeout-${o.seconds}`}>
                  <Text style={[styles.rowLabel, { flex: 1 }]}>{o.label}</Text>
                  {cfg.timeout === o.seconds && <Ionicons name="checkmark" size={20} color={colors.accent} />}
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.note}>
              {"\"Immediately\" locks whenever you leave the app. Other times lock after you've been away, or haven't touched the app, for that long."}
            </Text>
          </>
        )}

        {Platform.OS === "web" && (
          <View style={styles.webNote} testID="applock-web-note">
            <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
            <Text style={styles.webNoteText}>{WEB_NOTICE}</Text>
          </View>
        )}
        <Text style={styles.note}>
          Your passcode is stored only on this device ({Platform.OS === "web" ? "encrypted in this browser" : "in the secure Keychain / Keystore"}) and is never sent to CheerPlanner.{" "}
          {"Forgot it? Tap \"Forgot passcode?\" on the lock screen, then sign back in with your CheerPlanner email and password. App Lock turns off and none of your data is deleted."}
        </Text>
      </ScrollView>

      {flow && <PinFlow flow={flow} onClose={() => setFlow(null)} />}
    </SafeAreaView>
  );
}

function PinFlow({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const lock = useAppLock();
  const [step, setStep] = useState<Step>(flow === "enable" ? "new" : "current");
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errKey, setErrKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const fail = (m: string) => { setError(m); setErrKey((k) => k + 1); };

  const onPin = async (pin: string) => {
    setBusy(true);
    try {
      if (step === "current") {
        const r = await lock.verify(pin);
        if (!r.ok) {
          setWaitUntil(r.waitMs ? Date.now() + r.waitMs : 0);
          if (!r.waitMs) fail("Incorrect passcode. Try again.");
          return;
        }
        if (flow === "disable") {
          await lock.disable();
          onClose();
          notify("App Lock is off", "CheerPlanner will open without a passcode on this device.");
          return;
        }
        setError(null);
        setStep("new");
      } else if (step === "new") {
        if (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
          fail("Pick a passcode that's harder to guess.");
          return;
        }
        setFirst(pin);
        setError(null);
        setStep("confirm");
      } else {
        if (pin !== first) {
          setStep("new");
          setFirst("");
          fail("Passcodes didn't match. Start again.");
          return;
        }
        try {
          await lock.setPasscode(pin);
        } catch {
          setStep("new");
          setFirst("");
          fail("Couldn't save your passcode on this device. Please try again.");
          return;
        }
        onClose();
        if (flow === "enable") {
          notify("App Lock is on", Platform.OS === "web"
            ? `You'll need your passcode to open CheerPlanner.\n\n${WEB_NOTICE}`
            : "You'll need your passcode to open CheerPlanner on this device.");
        } else {
          notify("Passcode changed", "Use your new passcode next time CheerPlanner locks.");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Step, string> = {
    current: "Enter current passcode",
    new: flow === "change" ? "Enter a new passcode" : "Set a 6-digit passcode",
    confirm: "Confirm passcode",
  };
  const subs: Record<Step, string> = {
    current: flow === "disable" ? "Required to turn App Lock off" : "Required before changing your passcode",
    new: "This stays on this device only",
    confirm: "Enter the same 6 digits again",
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: BRAND.blue }}>
        <TouchableOpacity onPress={onClose} style={{ alignSelf: "flex-start", padding: 16, minHeight: 44 }} accessibilityLabel="Cancel" testID="pinflow-cancel">
          <Text style={{ color: BRAND.white, fontWeight: "700", fontSize: 16 }}>Cancel</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, justifyContent: "center", paddingBottom: 40 }}>
          <PinPad
            key={step}
            title={titles[step]}
            subtitle={subs[step]}
            error={error}
            errorKey={errKey}
            busy={busy}
            waitUntil={waitUntil}
            onComplete={onPin}
            testIDPrefix={`pinflow-${step}`}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.borderSoft,
  },
  headerTitle: { ...typography.h3, color: c.textPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionLabel: { ...typography.micro, color: c.textTertiary, letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm },
  group: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 14, minHeight: 52, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  rowLabel: { ...typography.bodyMedium, color: c.textPrimary },
  rowSub: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  note: { ...typography.caption, color: c.textTertiary, marginTop: spacing.md, lineHeight: 18 },
  webNote: { flexDirection: "row", gap: 8, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.accentSubtle },
  webNoteText: { ...typography.caption, color: c.textPrimary, flex: 1, lineHeight: 18 },
});
