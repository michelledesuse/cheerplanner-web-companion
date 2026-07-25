import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { formatCurrency } from "@/src/utils/format";
import SheetAccessButton from "@/src/components/SheetAccessButton";
import { useCanManageAccess } from "@/src/hooks/useCanManageAccess";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Tracker = {
  id: string; name: string; amount?: number | null; note?: string | null;
  summary: { paid_count: number; member_total: number; collected: number; outstanding: number | null; short_count: number; unpaid_count: number };
};

export default function PaymentsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [items, setItems] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = useCanManageAccess();

  const load = useCallback(async () => {
    try {
      const r = await api.get<Tracker[]>("/team/payments");
      setItems(r.data);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!name.trim()) { Alert.alert("Name required", "Give this a name."); return; }
    setSaving(true);
    try {
      await api.post("/team/payments", { name: name.trim(), amount: amount ? Number(amount) : null });
      setName(""); setAmount(""); setAddOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not create.");
    } finally { setSaving(false); }
  };

  const duplicate = async (id: string) => {
    try { await api.post(`/team/payments/${id}/duplicate`); await load(); }
    catch (e: any) { Alert.alert("Error", e?.response?.data?.detail || "Could not duplicate."); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="payments-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Tracking</Text>
        <TouchableOpacity onPress={() => router.push("/import/team_payments" as any)} style={styles.iconBtn} testID="payments-import" hitSlop={8}>
          <Ionicons name="cloud-upload-outline" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.addBtn} testID="payment-add">
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          testID="payments-list"
        >
          {items.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="cash-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No payment trackers yet</Text>
              <Text style={styles.emptyText}>Create one for team bonding, gifts, meals or dues — then check off who&apos;s paid.</Text>
            </View>
          ) : items.map((t) => {
            const { paid_count, member_total, collected, outstanding, short_count } = t.summary;
            const pct = member_total > 0 ? Math.round((paid_count / member_total) * 100) : 0;
            return (
              <TouchableOpacity key={t.id} style={styles.card} onPress={() => router.push({ pathname: "/team/payment", params: { id: t.id } })} testID={`payment-row-${t.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.cardName}>{t.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    {t.amount != null && <Text style={styles.cardAmount}>{formatCurrency(t.amount)}/person</Text>}
                    {canManage && <SheetAccessButton resource="payment" resourceId={t.id} />}
                    <TouchableOpacity onPress={() => duplicate(t.id)} hitSlop={8} testID={`payment-duplicate-${t.id}`}>
                      <Ionicons name="copy-outline" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={styles.cardMeta}>{paid_count}/{member_total} paid</Text>
                  <Text style={styles.cardMeta}>{formatCurrency(collected)} collected</Text>
                </View>
                {short_count > 0 && (
                  <View style={styles.owePill} testID={`payment-owe-${t.id}`}>
                    <Ionicons name="alert-circle" size={13} color={colors.warningText} />
                    <Text style={styles.oweText}>
                      {short_count} {short_count === 1 ? "owes" : "owe"}{outstanding != null ? ` · ${formatCurrency(outstanding)} short` : ""}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>New payment tracker</Text>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Team bonding – Nationals" placeholderTextColor={colors.textTertiary} testID="payment-name-input" />
              <Text style={styles.label}>Amount per person (optional)</Text>
              <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="e.g. 25" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" testID="payment-amount-input" />
              <TouchableOpacity style={[styles.confirm, saving && { opacity: 0.6 }]} onPress={create} disabled={saving} testID="payment-create-btn">
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.confirmText}>Create tracker</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  headerTitle: { ...typography.h2, color: c.textPrimary, flex: 1 },
  addBtn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
  card: { backgroundColor: c.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.md },
  cardName: { ...typography.bodyMedium, fontWeight: "800", color: c.textPrimary, flex: 1 },
  cardAmount: { ...typography.caption, color: c.textSecondary, fontWeight: "700" },
  cardMeta: { ...typography.caption, color: c.textSecondary },
  owePill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 10, backgroundColor: (c.warningText || c.accent) + "1A", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  oweText: { ...typography.micro, color: c.warningText || c.accent, fontWeight: "800" },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: c.divider, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: c.accent },
  emptyBlock: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: c.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: c.textSecondary, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...typography.body, color: c.textPrimary },
  confirm: { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  confirmText: { color: "white", fontWeight: "800", fontSize: 15 },
});
