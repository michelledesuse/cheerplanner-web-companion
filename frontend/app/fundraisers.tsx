import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { formatCurrency, formatDate, todayISO } from "@/src/utils/format";
import DateField from "@/src/components/DateField";
import ApplyFundraiserSheet from "@/src/components/ApplyFundraiserSheet";

type Fundraiser = { id: string; name: string; amount_raised: number; applied_amount?: number; available?: number; raised_on: string; note?: string; goal_amount?: number | null };

export default function FundraisersScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Fundraiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [goal, setGoal] = useState("");
  const [raisedOn, setRaisedOn] = useState(todayISO());
  const [applyFund, setApplyFund] = useState<Fundraiser | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/fundraisers");
      setItems(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = items.reduce((s, i) => s + Number(i.amount_raised || 0), 0);

  const resetForm = () => {
    setName(""); setAmount(""); setGoal(""); setRaisedOn(todayISO()); setEditingId(null); setShowAdd(false);
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Missing", "Add a name"); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0) { Alert.alert("Missing", "Enter a valid amount"); return; }
    const goalNum = goal.trim() ? parseFloat(goal) : null;
    const body = { name: name.trim(), amount_raised: amt, raised_on: raisedOn, goal_amount: (goalNum != null && !isNaN(goalNum) && goalNum > 0) ? goalNum : null };
    try {
      if (editingId) {
        await api.patch(`/fundraisers/${editingId}`, body);
      } else {
        await api.post("/fundraisers", body);
      }
      resetForm();
      load();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not save");
    }
  };

  const startEdit = (f: Fundraiser) => {
    setEditingId(f.id);
    setName(f.name);
    setAmount(String(f.amount_raised));
    setGoal(f.goal_amount != null ? String(f.goal_amount) : "");
    setRaisedOn(f.raised_on);
    setShowAdd(true);
  };

  const remove = async (id: string) => { await api.delete(`/fundraisers/${id}`); if (editingId === id) resetForm(); load(); };

  const shareFundraiser = async (f: Fundraiser) => {
    try {
      const r = await api.post(`/fundraisers/${f.id}/share`, { enabled: true });
      const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
      const url = `${base}/f/${r.data.share_token}`;
      await Share.share({ message: `Support our fundraiser "${f.name}" 🎉\n${url}`, url });
    } catch (e: any) {
      Alert.alert("Couldn't create link", e?.response?.data?.detail || "Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Fundraisers</Text>
          <TouchableOpacity onPress={() => setShowAdd((s) => !s)} style={[styles.iconBtn, { backgroundColor: colors.primary }]} testID="toggle-fundraiser-form">
            <Ionicons name={showAdd ? "close" : "add"} size={20} color="white" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>TOTAL RAISED</Text>
            <Text style={styles.heroAmount}>{formatCurrency(total)}</Text>
            <Text style={styles.heroMeta}>
              {items.length} {items.length === 1 ? "fundraiser" : "fundraisers"}
              {(() => {
                const totalApplied = items.reduce((s, i) => s + Number(i.applied_amount || 0), 0);
                const available = Math.max(0, total - totalApplied);
                return totalApplied > 0 ? ` • ${formatCurrency(available)} available` : "";
              })()}
            </Text>
          </View>

          {showAdd && (
            <View style={styles.formCard}>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Bake sale" placeholderTextColor={colors.textTertiary} testID="fundraiser-name-input" />
              <Text style={styles.label}>Amount raised (USD)</Text>
              <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textTertiary} testID="fundraiser-amount-input" />
              <Text style={styles.label}>Goal (optional, USD)</Text>
              <TextInput style={styles.input} value={goal} onChangeText={setGoal} keyboardType="decimal-pad" placeholder="e.g. 1000" placeholderTextColor={colors.textTertiary} testID="fundraiser-goal-input" />
              <Text style={styles.label}>Date</Text>
              <DateField value={raisedOn} onChange={setRaisedOn} />
              <TouchableOpacity style={styles.saveBtn} onPress={save} testID="fundraiser-save-btn">
                <Text style={styles.saveBtnText}>{editingId ? "Save changes" : "Add fundraiser"}</Text>
              </TouchableOpacity>
              {editingId && (
                <TouchableOpacity onPress={resetForm} style={[styles.saveBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginTop: 6 }]} testID="fundraiser-cancel-edit">
                  <Text style={[styles.saveBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
          ) : items.length === 0 ? (
            <Text style={styles.emptyHint}>No fundraisers yet. Add your first one!</Text>
          ) : (
            items.map((f) => {
              const applied = Number(f.applied_amount || 0);
              const avail = Number(f.available ?? Math.max(0, Number(f.amount_raised) - applied));
              return (
              <View key={f.id} style={styles.row}>
                <View style={[styles.iconCircle, { backgroundColor: colors.warningBg }]}>
                  <Ionicons name="gift" size={16} color={colors.warningText} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowTitle}>{f.name}</Text>
                  <Text style={styles.rowMeta}>
                    {formatDate(f.raised_on, { withYear: true })}
                    {applied > 0 ? ` • ${formatCurrency(applied)} applied` : ""}
                  </Text>
                  {avail > 0 && (
                    <TouchableOpacity
                      onPress={() => setApplyFund(f)}
                      style={styles.applyBtn}
                      testID={`apply-fund-btn-${f.id}`}
                    >
                      <Ionicons name="arrow-forward-circle" size={14} color="white" />
                      <Text style={styles.applyBtnText}>Apply to expense</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.rowAmount}>{formatCurrency(f.amount_raised)}</Text>
                  {applied > 0 && (
                    <Text style={styles.rowMeta}>{formatCurrency(avail)} left</Text>
                  )}
                  <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                    <TouchableOpacity onPress={() => shareFundraiser(f)} hitSlop={10} testID={`fundraiser-share-${f.id}`}>
                      <Ionicons name="share-social-outline" size={16} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => startEdit(f)} hitSlop={10} testID={`fundraiser-edit-${f.id}`}>
                      <Ionicons name="create-outline" size={16} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => remove(f.id)} hitSlop={10}>
                      <Ionicons name="trash-outline" size={14} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <ApplyFundraiserSheet
        visible={!!applyFund}
        fundraiser={applyFund}
        onClose={() => setApplyFund(null)}
        onApplied={() => { load(); }}
      />
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.xl },
  heroLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  heroAmount: { color: "white", fontSize: 40, fontWeight: "800", marginTop: 4, letterSpacing: -0.5 },
  heroMeta: { color: "rgba(255,255,255,0.7)", marginTop: 4 },
  formCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 6 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  saveBtn: { marginTop: spacing.md, backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "white", fontWeight: "700", fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  iconCircle: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowAmount: { ...typography.h3, color: colors.successText, marginBottom: 4 },
  applyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.accent, borderRadius: 999, marginTop: 6, alignSelf: "flex-start" },
  applyBtnText: { color: "white", fontWeight: "700", fontSize: 11, letterSpacing: 0.2 },
  emptyHint: { ...typography.body, color: colors.textTertiary, textAlign: "center", marginTop: spacing.xl },
});
