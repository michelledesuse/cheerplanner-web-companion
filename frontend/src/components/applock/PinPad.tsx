import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Animated, Platform, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { PIN_LENGTH } from "@/src/utils/appLock";

// Fixed CheerPlanner brand palette — identical in light and dark mode on purpose.
export const BRAND = { blue: "#0000FF", black: "#000000", white: "#FFFFFF" };

type Props = {
  title: string;
  subtitle?: string;
  error?: string | null;
  /** bump to replay the shake for a repeated identical error */
  errorKey?: number;
  busy?: boolean;
  /** epoch ms; keypad disabled with a countdown until then */
  waitUntil?: number;
  onComplete: (pin: string) => void;
  /** Optional bottom-left key (e.g. Face ID) */
  leftKey?: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void } | null;
  testIDPrefix?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Branded 6-digit keypad with dot indicators, shake-on-error and lockout countdown. */
export default function PinPad({ title, subtitle, error, errorKey = 0, busy, waitUntil = 0, onComplete, leftKey, testIDPrefix = "pin" }: Props) {
  const [pin, setPin] = useState("");
  const [now, setNow] = useState(Date.now());
  const shake = useRef(new Animated.Value(0)).current;
  const waiting = waitUntil > now;

  useEffect(() => {
    if (!waitUntil || waitUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [waitUntil]);

  useEffect(() => {
    if (!error) return;
    setPin("");
    Animated.sequence([10, -10, 8, -8, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: Platform.OS !== "web" }))).start();
  }, [error, errorKey, shake]);

  const press = (d: string) => {
    if (busy || waiting) return;
    setPin((p) => {
      if (p.length >= PIN_LENGTH) return p;
      const next = p + d;
      if (next.length === PIN_LENGTH) {
        setTimeout(() => { onComplete(next); setPin(""); }, 60);
      }
      return next;
    });
  };
  const back = () => setPin((p) => p.slice(0, -1));

  // Hardware keyboard on web.
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressRef.current(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const secs = Math.ceil((waitUntil - now) / 1000);
  const waitLabel = secs >= 60 ? `${Math.ceil(secs / 60)} min` : `${secs}s`;

  return (
    <View style={s.wrap} testID={`${testIDPrefix}-pad`}>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
      <Animated.View style={[s.dots, { transform: [{ translateX: shake }] }]} accessibilityLabel={`${pin.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[s.dot, i < pin.length && s.dotOn]} testID={`${testIDPrefix}-dot-${i}`} />
        ))}
      </Animated.View>
      <View style={s.msgRow}>
        {busy ? <ActivityIndicator color={BRAND.white} />
          : waiting ? <Text style={s.error} testID={`${testIDPrefix}-wait`}>Too many tries. Try again in {waitLabel}.</Text>
          : error ? <Text style={s.error} testID={`${testIDPrefix}-error`}>{error}</Text> : null}
      </View>
      <View style={s.grid}>
        {KEYS.map((k) => <Key key={k} label={k} onPress={() => press(k)} disabled={waiting || !!busy} testID={`${testIDPrefix}-key-${k}`} />)}
        {leftKey ? (
          <TouchableOpacity style={s.keyGhost} onPress={leftKey.onPress} accessibilityLabel={leftKey.label} testID={`${testIDPrefix}-key-bio`}>
            <Ionicons name={leftKey.icon} size={30} color={BRAND.white} />
          </TouchableOpacity>
        ) : <View style={s.keyGhost} />}
        <Key label="0" onPress={() => press("0")} disabled={waiting || !!busy} testID={`${testIDPrefix}-key-0`} />
        <TouchableOpacity style={s.keyGhost} onPress={back} accessibilityLabel="Delete digit" testID={`${testIDPrefix}-key-back`}>
          <Ionicons name="backspace-outline" size={28} color={BRAND.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Key({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled: boolean; testID: string }) {
  return (
    <TouchableOpacity style={[s.key, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled} activeOpacity={0.6} accessibilityLabel={label} testID={testID}>
      <Text style={s.keyText}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", width: "100%" },
  title: { color: BRAND.white, fontSize: 22, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "rgba(255,255,255,0.8)", fontSize: 14, marginTop: 6, textAlign: "center", paddingHorizontal: 24 },
  dots: { flexDirection: "row", gap: 16, marginTop: 28 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: BRAND.white },
  dotOn: { backgroundColor: BRAND.white },
  msgRow: { minHeight: 44, justifyContent: "center", paddingHorizontal: 24 },
  error: { color: BRAND.white, fontSize: 14, fontWeight: "700", textAlign: "center", backgroundColor: "rgba(0,0,0,0.35)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, overflow: "hidden" },
  grid: { flexDirection: "row", flexWrap: "wrap", width: 300, justifyContent: "space-between", rowGap: 16 },
  key: { width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  keyGhost: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  keyText: { color: BRAND.white, fontSize: 32, fontWeight: "600" },
});
