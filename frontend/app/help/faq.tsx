import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type QA = { q: string; a: string };
type Section = { title: string; items: QA[] };

const FAQ: Section[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How many athletes can I add?",
        a:
          "Unlimited. Add as many athletes (and coaches) as your household needs. Each one is tracked individually for expenses, payments, schedule events, and packing lists.",
      },
      {
        q: "What's the difference between an athlete and a coach?",
        a:
          "Athletes are competitors; coaches are the adults running practices. Both can be added under Settings → Athletes, just pick the role. Coaches show a COACH badge throughout the app and can join unlimited teams. The data fields are otherwise the same.",
      },
      {
        q: "How do I share with a co-parent?",
        a:
          "Open Settings → Household (sharing). Invite your co-parent by email. Once they accept, both phones see the same athletes, competitions, payments, and schedule in real time. Either parent can add or edit anything.",
      },
      {
        q: "Can I have a coach on multiple teams?",
        a:
          "Yes — coaches and athletes can both belong to as many teams as you want. Set this up in the athlete's edit screen by tapping the team chips you want to include.",
      },
    ],
  },
  {
    title: "Money & payments",
    items: [
      {
        q: "How does the payment waterfall work?",
        a:
          "When you log a payment and pick multiple expenses it covers, the app applies the money in due-date order — oldest expense first, paid in full before moving to the next. For example: a 250 dollar payment covering a 50 dollar Camp fee (due Jan 15), 200 dollar Gear fee (due Feb 1), and 100 dollar Tuition fee (due Mar 1) will fully pay the Camp and Gear, leaving 100 dollars still owed on Tuition.",
      },
      {
        q: "Can I edit a payment after I save it?",
        a:
          "Yes. Tap any payment row to open its edit screen. You can change the amount, the date, the payment method, and which expenses it covers. The app re-runs the waterfall and updates each expense's paid status automatically.",
      },
      {
        q: "What's the difference between 'Total Spent', 'Open', and 'Paid'?",
        a:
          "Total Spent is everything you've been billed (sum of all expenses). Paid is how much you've actually paid. Open is what's still owed (Total Spent minus Paid). The Money tab and Dashboard tiles all use the same math.",
      },
      {
        q: "How do I import expenses from a spreadsheet?",
        a:
          "Open Settings → Import → Expenses. Download the CSV template, paste your spreadsheet rows into it (or open it in Excel and add rows), then import. The same flow works for athletes, competitions, payments, and schedule events.",
      },
    ],
  },
  {
    title: "Competitions, travel & teams",
    items: [
      {
        q: "What's the difference between a venue and an address?",
        a:
          "The venue is the name (e.g. ESPN Wide World of Sports), the address is the full street address. Both are optional and both work with the map link. If you fill in both, tapping the location opens Apple Maps to the street address; if you only fill in the venue name, it searches for the venue.",
      },
      {
        q: "Why is the address field tappable?",
        a:
          "Every address in the app — competition venues, hotels, airports, rental pickups and drop-offs, practice locations — opens directly in Apple Maps for one-tap navigation.",
      },
      {
        q: "Can a team have more than one performance day at a competition?",
        a:
          "Yes. On the competition detail screen, scroll to Performance Schedule, then tap Add day next to the team. Each day gets its own date, meet time, performance time, and arena. Use this when your team competes on Saturday AND Sunday in different halls.",
      },
      {
        q: "What is 'Teams to Watch' for?",
        a:
          "It's a spectator list. Track other teams (rivals, friends, future routines) you want to watch at the same competition. You record their name, date, performance time, and arena. They show up on the calendar in cyan so they're easy to distinguish from your own teams.",
      },
      {
        q: "Why are flights split into outbound and return?",
        a:
          "Most cheer families fly round-trip but often book the legs separately or pay different amounts for each direction. Splitting them lets you track confirmation numbers, flight numbers, departure times, and costs independently — which also makes the calendar more accurate.",
      },
    ],
  },
  {
    title: "Schedule & calendar",
    items: [
      {
        q: "Can I set up a recurring practice?",
        a:
          "Yes. When you add a schedule event, turn on Repeats. Pick the days of the week and a series-end date. The app creates one event per occurrence so you can edit or delete individual days without breaking the whole series.",
      },
      {
        q: "How do I export to Apple Calendar or Google Calendar?",
        a:
          "Open Settings → Export → Calendar (ICS). Download the file and open it on the device where your calendar app is set up. Apple Calendar, Google Calendar, and Outlook all support ICS imports.",
      },
      {
        q: "Why is my time picker showing 24-hour?",
        a:
          "It shouldn't. CheerPlanner forces 12-hour with AM/PM throughout the entire app, regardless of your device or browser locale. If you're seeing 24-hour anywhere, please contact us — that's a bug.",
      },
      {
        q: "Why is my date showing in DD/MM/YYYY instead of MM-DD-YYYY?",
        a:
          "All dates are MM-DD-YYYY everywhere. The picker itself is the native calendar (Apple's iOS picker or the browser's calendar on web), so the picker UI might match your device locale — but the displayed value is always MM-DD-YYYY.",
      },
    ],
  },
  {
    title: "Packing lists",
    items: [
      {
        q: "How do I reuse the same packing list at every competition?",
        a:
          "Open Settings → Packing list templates. Build a master list there. Then on any competition, scroll to the Packing List section and tap Apply template. Items are checkable per athlete so each child has their own progress.",
      },
      {
        q: "Can the co-parent see what's been packed?",
        a:
          "Yes — packing lists sync to the household just like everything else. If one parent checks an item off on their phone, the other parent sees it immediately.",
      },
    ],
  },
  {
    title: "Account & privacy",
    items: [
      {
        q: "How do I delete my account and data?",
        a:
          "Open Settings → Delete account. The action is irreversible and deletes every athlete, competition, expense, payment, fundraiser, schedule event, packing list, and team owned by you across the entire household.",
      },
      {
        q: "Are there ads or in-app purchases?",
        a:
          "No. CheerPlanner has no advertising, no subscriptions, no in-app purchases, and never sells your data. All entries are private records you keep for your own bookkeeping.",
      },
      {
        q: "Do you store my financial information?",
        a:
          "No. Money entries you log are tracking records only — CheerPlanner never connects to a bank, processes a payment, or stores card numbers. The 'payment' you log is just a note that you paid something, not an actual transaction.",
      },
    ],
  },
];

export default function FaqScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  // Keys are "section-index/item-index" to allow multiple to be open at once.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="faq-back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>FAQ</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <Text style={styles.intro}>
          Answers to common questions about CheerPlanner. Tap a question to expand it. Still need help? Reach
          out using the Contact us button at the bottom.
        </Text>

        {FAQ.map((section, si) => (
          <View key={section.title}>
            <Text style={styles.sectionHead}>{section.title}</Text>
            {section.items.map((item, ii) => {
              const key = `${si}-${ii}`;
              const isOpen = !!open[key];
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => toggle(key)}
                  activeOpacity={0.8}
                  style={styles.card}
                  testID={`faq-q-${si}-${ii}`}
                >
                  <View style={styles.qRow}>
                    <Text style={styles.q}>{item.q}</Text>
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </View>
                  {isOpen && <Text style={styles.a}>{item.a}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        <TouchableOpacity
          onPress={() => Linking.openURL("mailto:info@cheer-planner.com?subject=CheerPlanner%20support")}
          style={styles.contactBtn}
          testID="faq-contact-btn"
        >
          <Ionicons name="mail" size={16} color="white" />
          <Text style={styles.contactBtnText}>Contact us</Text>
        </TouchableOpacity>
        <Text style={styles.footer}>info@cheer-planner.com</Text>
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
  sectionHead: { ...typography.caption, color: colors.textTertiary, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: 8 },
  qRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  q: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1, fontWeight: "700" },
  a: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 20 },
  contactBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: 999, marginTop: spacing.xl },
  contactBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  footer: { ...typography.caption, color: colors.textTertiary, textAlign: "center", marginTop: spacing.sm },
});
