import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/context/ThemeContext";
import { storage } from "@/src/utils/storage";

const SEEN_KEY = "cp_guided_tour_seen_v1";

type Step = { icon: string; title: string; body: string; highlight?: "tabs" | "star" };

function buildSteps(isCoach: boolean): Step[] {
  const roleStep: Step = isCoach
    ? { icon: "clipboard", title: "Your coaching tools", body: "Open the Team tab for your Team Hub — build Scouting Reports (set athletes' skill levels) and design event Flyers with the AI Coaching Assistant." }
    : { icon: "checkmark-circle", title: "Stay on top of it all", body: "RSVP to team events from the Team calendar, and track your Expenses and payments — all from the tabs." };
  return [
    { icon: "sparkles", title: "Welcome to CheerPlanner!", body: "Here's a quick 20-second tour so you know where everything is." },
    { icon: "grid", title: "Your tabs", body: "Use the tabs at the bottom to jump between Home, Athletes, Schedule, Calendar, and more.", highlight: "tabs" },
    roleStep,
    { icon: "star", title: "Your Assistant Coach", body: "Stuck? Tap the star button anytime to ask how to use any part of the app.", highlight: "star" },
  ];
}

// One-time first-run walkthrough that points out the tabs and the star help button.
export default function GuidedTour() {
  const { user } = useAuth();
  const { palette: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) return;
      const seen = await storage.getItem(SEEN_KEY, false);
      if (alive && !seen) setShow(true);
    })();
    return () => { alive = false; };
  }, [user]);

  if (!user || !show) return null;

  const STEPS = buildSteps(!!user?.team_access);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const finish = async () => { setShow(false); await storage.setItem(SEEN_KEY, true); };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}>
        {/* Highlights */}
        {s.highlight === "tabs" && (
          <View style={{ position: "absolute", left: 6, right: 6, bottom: 2, height: insets.bottom + 54, borderRadius: 16, borderWidth: 2, borderColor: c.accent }} />
        )}
        {s.highlight === "star" && (
          <View style={{ position: "absolute", right: 10, bottom: insets.bottom + 62, width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: c.accent, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="star" size={20} color="#fff" />
          </View>
        )}

        {/* Card */}
        <View style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 150, backgroundColor: c.bg, borderRadius: 18, padding: 20 }} testID="guided-tour-card">
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSubtle, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Ionicons name={s.icon as any} size={22} color={c.accent} />
          </View>
          <Text style={{ fontSize: 19, fontWeight: "800", color: c.textPrimary, marginBottom: 6 }}>{s.title}</Text>
          <Text style={{ fontSize: 14, lineHeight: 21, color: c.textSecondary }}>{s.body}</Text>

          <View style={{ flexDirection: "row", gap: 6, marginTop: 16, marginBottom: 16 }}>
            {STEPS.map((_, i) => (
              <View key={i} style={{ width: i === step ? 20 : 7, height: 7, borderRadius: 4, backgroundColor: i === step ? c.accent : c.border }} />
            ))}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={finish} hitSlop={8} testID="guided-tour-skip">
              <Text style={{ fontSize: 14, fontWeight: "700", color: c.textTertiary }}>Skip</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {step > 0 && (
                <TouchableOpacity onPress={() => setStep((x) => x - 1)} style={{ paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: c.border }} testID="guided-tour-back">
                  <Text style={{ fontSize: 14, fontWeight: "800", color: c.textPrimary }}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => (last ? finish() : setStep((x) => x + 1))} style={{ paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, backgroundColor: c.accent }} testID="guided-tour-next">
                <Text style={{ fontSize: 14, fontWeight: "800", color: "#fff" }}>{last ? "Got it!" : "Next"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
