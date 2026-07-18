import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type Step = {
  num: number;
  title: string;
  body: string;
  tip?: string;
};

const STEPS: Step[] = [
  {
    num: 1,
    title: "Add your people (athletes, coaches & staff)",
    body:
      "Open Settings → Athletes → tap + to add each person. Set a name, optional gym/team, an avatar color, and choose a role: Athlete, Coach, Team Rep/Mgr, or Staff. Coaches, reps and staff are treated as team \"personnel\" and unlock the Team Hub. Everyone can belong to more than one team.",
    tip: "If you have multiple children at the same gym, add them now — every expense, payment, and schedule entry is tracked per athlete.",
  },
  {
    num: 2,
    title: "Create your teams",
    body:
      "Go to Settings → Teams → tap + to add the household's teams for the season (for example, Senior Elite Coed 5). Pick a color and an optional season label. Then open each athlete and assign them to one or more teams from the Teams chips.",
  },
  {
    num: 3,
    title: "Add the season's competitions",
    body:
      "Open the Competitions tab → tap + Competition. Enter the name, venue (e.g. ESPN Wide World of Sports), full address, event date and time, and turn on Housing required if you need a hotel. Save, then tap the new card to open the details screen where you'll add Travel, Performance Schedule, and Packing List. You can also add a competition straight from the Calendar tab's + button.",
    tip: "Tap any address anywhere in the app to open Apple Maps for directions.",
  },
  {
    num: 4,
    title: "Plan travel — hotels, flights, cars",
    body:
      "Inside a competition, scroll to Travel & accommodations and tap + Hotel, + Flight, or + Car. Each one has its own fields: hotels track check-in/out dates and free-cancel deadlines, flights split into outbound + return legs with confirmation numbers and times, and cars track pickup/drop-off date, time, and address.",
  },
  {
    num: 5,
    title: "Enter performance times per team",
    body:
      "On the competition detail screen, pick which household teams are attending under Our Teams Attending. For each selected team, tap Add day to enter the performance date, meet time, performance time, and arena. You can add multiple days per team if your team competes on Saturday and Sunday in different halls.",
  },
  {
    num: 6,
    title: "Track expenses and payments",
    body:
      "Open the Money tab. Tap + Expense to log a charge (tuition, registration, uniform, etc.) for a specific athlete with an optional due date. When you pay something, tap + Payment, enter the amount, and pick which expenses it covers. The app automatically applies the payment in due-date order — oldest bill first, paid in full before moving to the next.",
    tip: "The Home screen's Total Due Today card adds up what's due today plus anything overdue.",
  },
  {
    num: 7,
    title: "Add practices, lessons, and other events",
    body:
      "Open the Schedule tab and tap + Event. Choose an event type (practice, team bonding, private lesson, choreography, class, other), pick athletes, set the date and time, and add a location and address. If it repeats, turn on the recurrence toggle and pick a weekly schedule with an end date.",
  },
  {
    num: 8,
    title: "Turn on text (SMS) reminders",
    body:
      "Open Settings → Notifications to enable reminders and confirm your mobile number. CheerPlanner can text you ahead of competitions and travel (like hotel free-cancel deadlines). When adding a competition or booking, choose how far ahead you want to be reminded — a background scheduler sends each text at the right time.",
    tip: "Reminders are opt-in and only sent to the number you confirm.",
  },
  {
    num: 9,
    title: "Build a packing list",
    body:
      "On any competition detail page, open the Packing List section. You can apply a saved template from Settings → Packing list templates, or add items one at a time. Each item is checkable per athlete so you can confirm nothing was left behind.",
  },
  {
    num: 10,
    title: "Share with a co-parent",
    body:
      "Go to Settings → Household (sharing) and invite your co-parent's email. Once they accept, both phones see the same athletes, competitions, expenses, and schedule live. Either parent can add or edit anything.",
  },
  {
    num: 11,
    title: "Use the Calendar and export to Apple Calendar",
    body:
      "The Calendar tab pulls together competition days, meet times and performance times for each of your teams, hotel check-ins and check-outs, flights, expense due dates, fundraisers, and practices. Open Settings → Export → Calendar (ICS) to download a file you can subscribe to from Apple Calendar, Google Calendar, or Outlook.",
  },
  {
    num: 12,
    title: "Open the Team Hub (coaches, reps & staff)",
    body:
      "Tap the Team tab. The Team Hub unlocks automatically once your household has someone marked Coach, Team Rep/Mgr, or Staff. It's a private workspace for team personnel with a Roster and tracking tools. Start with Roster → add people manually or pull in your athletes with one tap. Athletes store a parent's contact info; personnel store their own. People can be on multiple teams, and every list separates Personnel from Athletes.",
  },
  {
    num: 13,
    title: "Track payments, sizes & paperwork",
    body:
      "Inside the Team Hub: Payment Tracking is a manual ledger — set an optional expected amount, then record each person's actual amount, method (Cash, Venmo, etc.) and date paid. Sizes is a shared spreadsheet with default columns (Shirt, Tank, Sports bra, Shorts, Shoes, Sweatshirt, Jacket, Ring) you can extend; tap the chart icon for a size tally. Paperwork / Other is one or more named check-off sheets (waivers, forms) with a checkbox and note per person.",
    tip: "Grids keep the member's name frozen on the left while you scroll across columns. Personnel don't get a Sports bra size.",
  },
  {
    num: 14,
    title: "Sign-up sheets & custom exports",
    body:
      "Sign-Up Sheet lets you create slots (e.g. \"Water ×12\", \"Chaperone\") that families claim with a quantity and note — optionally tied to a competition. Custom Roster Export lets you pick exactly which columns to include (contact info, sizes, paperwork status, payment status), filter by team, and download the combined sheet as a CSV.",
  },
  {
    num: 15,
    title: "Import from a spreadsheet (optional)",
    body:
      "Already track expenses in Excel or Google Sheets? Open Settings → Import. Download the CSV template, paste your data, and import in one tap. The same flow works for athletes, competitions, payments, and schedule events.",
  },
  {
    num: 16,
    title: "Personalize your theme",
    body:
      "Open Settings → Appearance to recolor the whole app for your household. Pick one of the ready-made presets (Red & White, Royal Blue, Green & Black and more — including dark themes), or scroll to Build your own to create a custom theme. The custom builder gives you a full color picker and up to 4 colors — Accent, Background, Surface, and Text — so you can match your gym's colors exactly. Changes apply instantly across every screen.",
    tip: "Themes are shared household-wide and sync to every member's phone, so pick something everyone likes.",
  },
];

export default function SetupGuideScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="setup-back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Setup Guide</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <Text style={styles.intro}>
          A step-by-step walkthrough to get the most out of CheerPlanner. You can tackle these in any order, but
          finishing them all gives you the best season at a glance.
        </Text>

        {STEPS.map((s) => (
          <View key={s.num} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.numChip}><Text style={styles.numText}>{s.num}</Text></View>
              <Text style={styles.cardTitle}>{s.title}</Text>
            </View>
            <Text style={styles.cardBody}>{s.body}</Text>
            {!!s.tip && (
              <View style={styles.tipBlock}>
                <Ionicons name="bulb" size={14} color={colors.accent} />
                <Text style={styles.tipText}>{s.tip}</Text>
              </View>
            )}
          </View>
        ))}

        <View style={[styles.card, styles.endNote]}>
          <Ionicons name="checkmark-circle" size={28} color={colors.successText} />
          <Text style={styles.endTitle}>You&apos;re all set</Text>
          <Text style={styles.endBody}>
            Need more help? Tap the FAQ row in Settings for answers to common questions, or contact us from the
            same screen.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = () => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  intro: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.sm },
  numChip: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  numText: { color: "white", fontWeight: "800", fontSize: 13 },
  cardTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, fontSize: 16 },
  cardBody: { ...typography.body, color: colors.textPrimary, lineHeight: 20 },
  tipBlock: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.accentSubtle, borderRadius: radius.sm },
  tipText: { flex: 1, ...typography.caption, color: colors.textPrimary, fontStyle: "italic", lineHeight: 18 },
  endNote: { alignItems: "center", padding: spacing.lg },
  endTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.sm },
  endBody: { ...typography.body, color: colors.textSecondary, textAlign: "center", marginTop: 6 },
});
