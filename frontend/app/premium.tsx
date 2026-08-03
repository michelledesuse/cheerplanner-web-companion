import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { usePremium } from "@/src/context/PremiumContext";
import { loadOfferings, purchasePackage, restorePurchases, purchasesSupported, type RCPackage } from "@/src/lib/revenuecat";
import { track } from "@/src/lib/analytics";
import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

const PLAN_LABEL: Record<string, string> = {
  free: "CheerPlanner Free",
  monthly: "CheerPlanner Premium",
  annual: "CheerPlanner Premium",
  lifetime: "CheerPlanner Premium",
  promo: "CheerPlanner Premium",
};
const PLAN_SUB: Record<string, string> = {
  monthly: "Monthly Plan",
  annual: "Annual Plan",
  lifetime: "Lifetime Access",
  promo: "Promotional Access",
};

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); } catch { return ""; }
}

export default function PremiumScreen() {
  const { status, config, isPremium, monetizationActive, loading, refresh } = usePremium();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  const [offerings, setOfferings] = useState<{ monthly?: RCPackage; annual?: RCPackage } | null>(null);
  const [buying, setBuying] = useState(false);

  useFocusEffect(useCallback(() => {
    refresh();
    track("paywall_view");
    if (purchasesSupported) loadOfferings().then(setOfferings);
  }, [refresh]));

  const buy = async (which: "monthly" | "annual") => {
    track("plan_selected", { plan: which });
    track("upgrade_tap", { plan: which });
    const pkg = offerings?.[which];
    if (!purchasesSupported || !pkg) {
      Alert.alert(
        "Available in the app build",
        "In-app purchase works on the installed CheerPlanner app (App Store / TestFlight build), not in this preview. If you have a Lifetime Premium Access code, redeem it on the CheerPlanner website.",
      );
      return;
    }
    setBuying(true);
    try {
      const res = await purchasePackage(pkg);
      if (res.ok) {
        track("purchase_success", { plan: which });
        // Backend updates via RevenueCat webhook; refresh (may take a moment).
        setTimeout(refresh, 1500);
        await refresh();
        Alert.alert("Welcome to Premium!", "Your CheerPlanner Premium is now active.");
      } else if (!res.cancelled) {
        Alert.alert("Purchase not completed", "We couldn't complete the purchase. Please try again.");
      }
    } finally {
      setBuying(false);
    }
  };

  const onRestore = async () => {
    setBuying(true);
    try {
      const ok = await restorePurchases();
      await refresh();
      Alert.alert(ok ? "Restored" : "Nothing to restore", ok ? "Your Premium has been restored." : "No active purchases were found for this Apple ID.");
    } finally {
      setBuying(false);
    }
  };

  const products = config?.pricing?.products || {};
  const monthly = products.monthly?.display_price ?? 4.99;
  const annual = products.annual?.display_price ?? 39.99;
  const trialDays = products.annual?.trial_days ?? 7;
  const monthlyTrialDays = products.monthly?.trial_days ?? 0;
  const annualMonthEq = annual / 12;
  const savingsPct = monthly > 0 ? Math.round((1 - annualMonthEq / monthly) * 100) : 0;

  if (loading && !status) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator /></View>
      </SafeAreaView>
    );
  }

  const plan = status?.plan || "free";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="premium-back"><Ionicons name="chevron-back" size={26} color={styles._icon.color} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Your Plan</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} testID="premium-screen">
        {/* Current plan card */}
        <View style={[styles.planCard, isPremium && styles.planCardPremium]}>
          <Ionicons name={isPremium ? "star" : "star-outline"} size={30} color={isPremium ? "#F59E0B" : styles._muted.color} />
          <Text style={styles.planName}>{PLAN_LABEL[plan]}</Text>
          {isPremium ? <Text style={styles.planSub}>{PLAN_SUB[plan] || "Premium"}</Text> : <Text style={styles.planSub}>Free plan</Text>}
          {isPremium && plan === "lifetime" ? (
            <Text style={styles.planNote}>Lifetime — never expires. No renewal.</Text>
          ) : null}
          {isPremium && (plan === "monthly" || plan === "annual") && status?.expires_at ? (
            <Text style={styles.planNote}>Renews {fmtDate(status.expires_at)}</Text>
          ) : null}
        </View>

        {!isPremium ? (
          !monetizationActive ? (
            <>
              <View style={styles.infoBox}>
                <Ionicons name="sparkles" size={18} color="#16A34A" />
                <Text style={styles.infoText}>Good news — every CheerPlanner feature, including the full Team Hub, is unlocked for free during our launch period. Premium plans start later; we&apos;ll let you know before anything changes.</Text>
              </View>
              {Platform.OS === "web" ? (
                <TouchableOpacity style={styles.linkRow} onPress={() => router.push("/redeem" as any)} testID="redeem-link">
                  <Ionicons name="gift-outline" size={18} color={styles._icon.color} />
                  <Text style={styles.linkText}>Have a Lifetime Premium code? Redeem it</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
          <>
            <Text style={styles.sectionTitle}>Upgrade to Premium</Text>
            <Text style={styles.blurb}>Unlock the full Team Hub, advanced roster, sizes, paperwork, team payments, sign-ups, attendance, spreadsheet import/export, parent share links, automated SMS reminders, and up to 6 household members.</Text>

            {/* Annual (best value) */}
            <TouchableOpacity style={[styles.priceCard, styles.priceCardBest]} onPress={() => buy("annual")} disabled={buying} testID="upgrade-annual">
              {savingsPct > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>SAVE {savingsPct}%</Text></View> : null}
              <Text style={styles.priceTitle}>Annual</Text>
              <Text style={styles.priceValue}>{offerings?.annual?.product?.priceString || `$${annual.toFixed(2)}`}<Text style={styles.pricePer}>/year</Text></Text>
              <Text style={styles.priceHint}>{trialDays > 0 ? `${trialDays}-day free trial · ` : ""}Best value (${annualMonthEq.toFixed(2)}/mo)</Text>
            </TouchableOpacity>

            {/* Monthly */}
            <TouchableOpacity style={styles.priceCard} onPress={() => buy("monthly")} disabled={buying} testID="upgrade-monthly">
              <Text style={styles.priceTitle}>Monthly</Text>
              <Text style={styles.priceValue}>{offerings?.monthly?.product?.priceString || `$${monthly.toFixed(2)}`}<Text style={styles.pricePer}>/month</Text></Text>
              {monthlyTrialDays > 0 ? <Text style={styles.priceHint}>{monthlyTrialDays}-day free trial</Text> : null}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cta} onPress={() => buy("annual")} disabled={buying} testID="upgrade-cta">
              {buying ? <ActivityIndicator color="white" /> : <Text style={styles.ctaText}>Start Premium</Text>}
            </TouchableOpacity>

            {purchasesSupported ? (
              <TouchableOpacity style={styles.doneRow} onPress={onRestore} disabled={buying} testID="restore-purchases">
                <Text style={styles.linkText}>Restore Purchases</Text>
              </TouchableOpacity>
            ) : null}

            {/* Lifetime code redemption — web portal only (Apple compliant) */}
            {Platform.OS === "web" ? (
              <TouchableOpacity style={styles.linkRow} onPress={() => router.push("/redeem" as any)} testID="redeem-link">
                <Ionicons name="gift-outline" size={18} color={styles._icon.color} />
                <Text style={styles.linkText}>Have a Lifetime Premium code? Redeem it</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.infoBox}>
                <Ionicons name="information-circle-outline" size={18} color={styles._muted.color} />
                <Text style={styles.infoText}>Have a Lifetime Premium Access code? Redeem it on the CheerPlanner website, then sign in here — your Premium unlocks automatically.</Text>
              </View>
            )}
          </>
          )
        ) : (
          <>
            {plan === "lifetime" ? (
              <>
              <View style={styles.infoBox}>
                <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                <Text style={styles.infoText}>You have Lifetime Premium Access. It stays with your account across devices and reinstalls — no renewal, no payment.</Text>
              </View>
              {(status as any)?.has_store_subscription ? (
                <View style={styles.infoBox}>
                  <Ionicons name="alert-circle-outline" size={18} color="#B45309" />
                  <Text style={styles.infoText}>Heads up: you also have an active App Store subscription. Since you have Lifetime access, it is redundant — it may keep renewing unless you cancel it in your App Store subscription settings.</Text>
                </View>
              ) : null}
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(Platform.OS === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions")} testID="manage-sub">
                  <Ionicons name="settings-outline" size={18} color={styles._icon.color} />
                  <Text style={styles.linkText}>Manage subscription</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  _icon: { color: c.textPrimary },
  _muted: { color: c.textSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  headerTitle: { ...typography.h3, color: c.textPrimary },
  planCard: { backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg },
  planCardPremium: { borderColor: "#F59E0B" },
  planName: { ...typography.h2, color: c.textPrimary, marginTop: spacing.sm },
  planSub: { ...typography.body, color: c.textSecondary, marginTop: 2 },
  planNote: { ...typography.caption, color: c.textSecondary, marginTop: spacing.sm },
  sectionTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  blurb: { ...typography.body, color: c.textSecondary, lineHeight: 20, marginBottom: spacing.lg },
  priceCard: { backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.md },
  priceCardBest: { borderColor: c.accent, borderWidth: 2 },
  badge: { position: "absolute", top: -10, right: 14, backgroundColor: c.accent, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  badgeText: { color: "white", fontWeight: "800", fontSize: 11 },
  priceTitle: { ...typography.bodyMedium, color: c.textPrimary },
  priceValue: { ...typography.display, color: c.textPrimary, marginTop: 2 },
  pricePer: { ...typography.body, color: c.textSecondary },
  priceHint: { ...typography.caption, color: c.textSecondary, marginTop: 2 },
  cta: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: spacing.sm },
  ctaText: { color: "white", fontWeight: "800", fontSize: 16 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: spacing.lg, padding: spacing.md },
  linkText: { ...typography.bodyMedium, color: c.primary },
  doneRow: { alignItems: "center", padding: spacing.md, marginTop: spacing.xs },
  infoBox: { flexDirection: "row", gap: 8, backgroundColor: c.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border, marginTop: spacing.md },
  infoText: { flex: 1, ...typography.caption, color: c.textSecondary, lineHeight: 18 },
});
