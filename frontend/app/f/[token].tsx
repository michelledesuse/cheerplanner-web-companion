import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
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
            {data.raised_on ? (
              <Text style={styles.meta}>as of {formatDate(data.raised_on, { withYear: true })}</Text>
            ) : null}
            {data.note ? <Text style={styles.note}>{data.note}</Text> : null}
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
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: colors.textSecondary },
  name: { fontSize: 22, fontWeight: "800", color: colors.textPrimary, textAlign: "center", marginTop: 6 },
  amount: { fontSize: 44, fontWeight: "800", color: colors.successText, marginTop: 18, letterSpacing: -1 },
  raisedLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: 13, color: colors.textTertiary, marginTop: 10 },
  note: { fontSize: 14, color: colors.textPrimary, textAlign: "center", marginTop: 16, lineHeight: 20 },
  brand: { fontSize: 12, color: colors.textTertiary, marginTop: 28, fontWeight: "600" },
  errText: { fontSize: 15, color: colors.textSecondary, textAlign: "center", marginTop: 12 },
});
