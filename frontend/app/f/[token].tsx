import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, Platform, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";

import { colors } from "@/src/theme";
import { formatCurrency, formatDate } from "@/src/utils/format";

type PublicFundraiser = {
  name: string;
  amount_raised: number;
  applied_amount: number;
  available: number;
  goal_amount?: number | null;
  raised_on: string;
  note?: string | null;
};

/**
 * Public, unauthenticated view of a shared fundraiser.
 * Opened via a link like https://<host>/f/<token> (works on web + mobile).
 */
export default function PublicFundraiser() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [data, setData] = useState<PublicFundraiser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.href
      : `${(process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "")}/f/${token}`;

  const copyLink = async () => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        await Share.share({ message: shareUrl, url: shareUrl });
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
        const res = await fetch(`${base}/api/public/fundraisers/${token}`);
        if (!res.ok) {
          setError("This fundraiser link isn't available.");
        } else {
          setData(await res.json());
        }
      } catch {
        setError("Couldn't load this fundraiser. Please check your connection.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : error || !data ? (
          <View style={styles.card}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.errText}>{error || "Not found."}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="gift" size={22} color="white" />
            </View>
            <Text style={styles.label}>FUNDRAISER</Text>
            <Text style={styles.name}>{data.name}</Text>
            <Text style={styles.amount}>{formatCurrency(data.amount_raised)}</Text>
            <Text style={styles.raisedLabel}>raised</Text>
            {data.goal_amount && data.goal_amount > 0 ? (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, Math.round((data.amount_raised / data.goal_amount) * 100))}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  {Math.min(100, Math.round((data.amount_raised / data.goal_amount) * 100))}% of {formatCurrency(data.goal_amount)} goal
                </Text>
              </View>
            ) : null}
            {data.raised_on ? (
              <Text style={styles.meta}>as of {formatDate(data.raised_on, { withYear: true })}</Text>
            ) : null}
            {data.note ? <Text style={styles.note}>{data.note}</Text> : null}
            <TouchableOpacity style={styles.copyBtn} onPress={copyLink} testID="copy-link-btn">
              <Ionicons name={copied ? "checkmark" : "link"} size={16} color={colors.accent} />
              <Text style={styles.copyBtnText}>{copied ? "Link copied!" : "Copy link"}</Text>
            </TouchableOpacity>
            <Text style={styles.brand}>Shared from CheerPlanner</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%", maxWidth: 440, alignItems: "center",
    backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 36, paddingHorizontal: 24,
  },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: colors.textSecondary },
  name: { fontSize: 22, fontWeight: "800", color: colors.textPrimary, textAlign: "center", marginTop: 6 },
  amount: { fontSize: 44, fontWeight: "800", color: colors.successText, marginTop: 18, letterSpacing: -1 },
  raisedLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: 13, color: colors.textTertiary, marginTop: 10 },
  note: { fontSize: 14, color: colors.textPrimary, textAlign: "center", marginTop: 16, lineHeight: 20 },
  progressWrap: { width: "100%", marginTop: 18 },
  progressTrack: { height: 10, borderRadius: 6, backgroundColor: colors.border, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 6, backgroundColor: colors.successText },
  progressText: { fontSize: 13, color: colors.textSecondary, marginTop: 8, textAlign: "center", fontWeight: "600" },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 24, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, borderWidth: 1, borderColor: colors.accent },
  copyBtnText: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  brand: { fontSize: 12, color: colors.textTertiary, marginTop: 28, fontWeight: "600" },
  errText: { fontSize: 15, color: colors.textSecondary, textAlign: "center", marginTop: 12 },
});
