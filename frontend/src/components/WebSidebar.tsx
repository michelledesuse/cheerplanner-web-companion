import React from "react";
import { View, Text, TouchableOpacity, ScrollView, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";

import { spacing, radius, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";
import { usePremium } from "@/src/context/PremiumContext";
import { useAuth } from "@/src/context/AuthContext";
import LiveDot from "@/src/components/LiveDot";

type NavItem = { label: string; icon: keyof typeof Ionicons.glyphMap; route: string };

const PRIMARY: NavItem[] = [
  { label: "Home", icon: "home", route: "/dashboard" },
  { label: "Athletes", icon: "people", route: "/athletes" },
  { label: "Expenses", icon: "wallet", route: "/expenses" },
  { label: "Competitions", icon: "trophy", route: "/competitions" },
  { label: "Schedule", icon: "time", route: "/schedule" },
  { label: "Calendar", icon: "calendar", route: "/calendar" },
  { label: "Team Hub", icon: "ribbon", route: "/team" },
];

const SECONDARY: NavItem[] = [
  { label: "Reminders", icon: "notifications", route: "/reminders" },
  { label: "Settings", icon: "settings", route: "/settings" },
];

/** Persistent left navigation shown on wide (desktop) web screens. */
export default function WebSidebar() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { isPremium, monetizationActive } = usePremium();

  const isActive = (route: string) => pathname === route || pathname.startsWith(route + "/");

  const Item = ({ item }: { item: NavItem }) => {
    const active = isActive(item.route);
    return (
      <TouchableOpacity
        style={[styles.item, active && styles.itemActive]}
        onPress={() => router.push(item.route as any)}
        testID={`sidebar-${item.label.toLowerCase().replace(/\s/g, "-")}`}
      >
        <Ionicons name={item.icon} size={20} color={active ? styles._active.color : styles._muted.color} />
        <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{item.label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.sidebar}>
      <View style={styles.brandRow}>
        <Image source={require("../../assets/images/cheerplanner-mark.png")} style={styles.brandMark} resizeMode="contain" />
        <Text style={styles.brand}>CheerPlanner</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
        {PRIMARY.map((i) => <Item key={i.route} item={i} />)}
        <View style={styles.divider} />
        {SECONDARY.map((i) => <Item key={i.route} item={i} />)}
      </ScrollView>

      {/* Plan chip */}
      <TouchableOpacity style={styles.planChip} onPress={() => router.push("/premium" as any)} testID="sidebar-plan">
        <Ionicons name={isPremium ? "star" : "star-outline"} size={16} color={isPremium ? "#F59E0B" : styles._muted.color} />
        <Text style={styles.planText} numberOfLines={1}>
          {isPremium ? "Premium" : monetizationActive ? "Free — Upgrade" : "All features free"}
        </Text>
      </TouchableOpacity>

      <View style={styles.userRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || user?.email || "?").charAt(0).toUpperCase()}</Text></View>
        <Text style={styles.userEmail} numberOfLines={1}>{user?.email}</Text>
        <LiveDot showLabel={false} />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => ({
  _active: { color: c.primary },
  _muted: { color: c.textSecondary },
  sidebar: { width: 248, backgroundColor: c.card, borderRightWidth: 1, borderRightColor: c.border, paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.md },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.sm, marginBottom: spacing.xl },
  brandMark: { width: 32, height: 30 },
  brand: { ...typography.h3, color: c.textPrimary, fontWeight: "800" },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 11, borderRadius: radius.md, marginBottom: 2 },
  itemActive: { backgroundColor: c.primarySoft || c.bg },
  itemLabel: { ...typography.bodyMedium, color: c.textSecondary },
  itemLabelActive: { color: c.primary, fontWeight: "700" },
  divider: { height: 1, backgroundColor: c.borderSoft, marginVertical: spacing.sm },
  planChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, marginBottom: spacing.sm },
  planText: { ...typography.caption, color: c.textPrimary, fontWeight: "700", flex: 1 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.sm },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontWeight: "800", fontSize: 13 },
  userEmail: { ...typography.caption, color: c.textSecondary, flex: 1 },
});
