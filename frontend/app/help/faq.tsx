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
        q: "What roles can a person have?",
        a:
          "Four roles: Athlete, Coach, Team Rep/Mgr, and Staff. Add anyone under Settings → Athletes and pick their role. Coaches, reps and staff are treated as team \"personnel\" — they unlock the Team Hub and are listed separately from athletes in Team Hub tools. Everyone can belong to more than one team.",
      },
      {
        q: "How do I share with a co-parent?",
        a:
          "Open Settings → Family Sharing. Invite your co-parent by email. Once they accept, both phones see the same athletes, competitions, payments, and schedule in real time. As the account owner you can also fine-tune what each household member sees: on the Family Sharing screen, use the per-member toggles (or the one-tap Kids preset) to hide Expenses/Payments and/or Travel from a specific person.",
      },
      {
        q: "Can a coach or athlete be on multiple teams?",
        a:
          "Yes — coaches, staff, reps and athletes can all belong to as many teams as you want. Set this up in the person's edit screen by tapping the team chips you want to include.",
      },
      {
        q: "Can CheerPlanner text me reminders?",
        a:
          "Yes. Open Settings → Notifications to turn on SMS reminders and confirm your mobile number. When you add a competition or booking you can choose how far ahead to be reminded, and a background scheduler sends the text at the right time. Reminders are opt-in.",
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
        q: "What's the difference between 'Season Total', 'Open', and 'Paid'?",
        a:
          "Season Total is everything you've been billed (sum of all expenses). Paid is how much you've actually paid. Open is what's still owed (Season Total minus Paid). The Money tab and Dashboard tiles all use the same math.",
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
          "Open a competition and scroll to the Packing List section, then tap Apply template. You can start from the CheerPlanner Standard list or any list you've saved. Tap Save to store the current list as a reusable template.",
      },
      {
        q: "Can I rename or delete a packing template I made?",
        a:
          "Yes. Open the Templates picker (the Templates button on any packing list) and tap Manage. From there you can rename or delete any template you created. The built-in CheerPlanner Standard template is locked and can't be edited or removed.",
      },
      {
        q: "Can the co-parent see what's been packed?",
        a:
          "Yes — packing lists sync to the household just like everything else. If one parent checks an item off on their phone, the other parent sees it immediately.",
      },
    ],
  },
  {
    title: "Appearance & themes",
    items: [
      {
        q: "Can I change the app's colors?",
        a:
          "Yes. Open Settings → Appearance. Choose from 12 built-in presets (including dark themes like Green & Black and Red & Black), or scroll down to Build your own to create a fully custom theme.",
      },
      {
        q: "How does the custom theme builder work?",
        a:
          "Under Build your own you get a full color picker and four color roles — Accent, Background, Surface, and Text. Tap a role to select it, drag the picker to choose its color, watch the live preview update, then tap Apply custom theme. Set as many or as few of the four colors as you like.",
      },
      {
        q: "Do theme changes affect everyone in my household?",
        a:
          "Yes — the theme is saved for the whole household and syncs to every member's phone automatically. It also persists when you reopen the app.",
      },
      {
        q: "A screen still shows the old colors — what do I do?",
        a:
          "Theme changes now apply instantly across the whole app. If you ever see a stale color, just navigate away and back; the screen will already be repainted.",
      },
    ],
  },
  {
    title: "Team Hub (coaches, reps & staff)",
    items: [
      {
        q: "What is the Team Hub?",
        a:
          "A private workspace on the Team tab for team personnel. It centers on a team Roster with tracking tools built on top: Payment Tracking, Sizes, Paperwork / Other, a Sign-Up Sheet, Custom Team Forms, and a Custom Roster Export.",
      },
      {
        q: "Who can see the Team Hub?",
        a:
          "The household owner controls access. Open Settings → Team Hub Access to grant or revoke it for each household member, or invite someone by email. If a coach or gym gave you a Team Hub code, open Settings → Team Hub Access and enter it in the \"Have a Team Hub code?\" box at the top to unlock the Team tab. Members with access see the Team tab and its tools; everyone else won't see the Hub or its data.",
      },
      {
        q: "How is the Roster different from my athletes?",
        a:
          "The Roster is the team's people — coaches, staff, reps and athletes — and a person can be on multiple teams. Every list separates Personnel from Athletes but still counts everyone in totals. For athletes the contact info is the parent's; for personnel it's their own.",
      },
      {
        q: "How does Payment Tracking work?",
        a:
          "It's a manual ledger — no real payments. Set an optional expected amount per person, then record each person's actual amount, method (Cash, Check, Venmo, Zelle, etc. or a custom one) and the date paid. Great for team bonding, gifts, meals and dues.",
      },
      {
        q: "How do Sizes work — and why no Sports bra for coaches?",
        a:
          "Sizes is a shared spreadsheet with default columns (Shirt, Tank, Sports bra, Shorts, Shoes, Sweatshirt, Jacket, Ring) that you can extend with your own. Values are free text (AL, YM, 7…). Personnel don't get a Sports bra size, so that cell shows N/A for them. Tap the chart icon for a size tally by item.",
      },
      {
        q: "What's Paperwork / Other for?",
        a:
          "Named check-off sheets for waivers, forms or anything else. Add your own items, then check each person off with an optional note (e.g. 'expires 6/1'). Each sheet shows a completion tally.",
      },
      {
        q: "How does the Sign-Up Sheet work?",
        a:
          "Create slots people can claim — like 'Water ×12' or 'Chaperone' — optionally linked to a competition. Each claim records who signed up, a quantity, and an optional note, and the slot shows how many spots are still needed.",
      },
      {
        q: "What can I do with Custom Roster Export?",
        a:
          "Pick exactly which columns to include — contact info, any Sizes column, any Paperwork item, any Payment tracker's status — filter by team, optionally label it with a competition, preview it on screen, and download the whole thing as a CSV you can open in Excel or Google Sheets.",
      },
      {
        q: "What are Team Forms and how do parents fill them out?",
        a:
          "Team Forms let you build custom forms — meal orders, T-shirt sizes, media consent, anything — with questions of any type: multiple choice, multi-select, yes/no, number, short text, and paragraph. Open Team → Team Forms to create one and add questions. You can fill in a member's answers yourself, or tap Share link / Remind to send parents a link they open with no login — pre-filled with their prior answers so they can edit until you close it. As responses come in you get a live tally (e.g. '10 Chicken, 5 Pasta') plus a per-member list, and you can Download everything as a CSV for your caterer or vendor.",
      },
      {
        q: "Can I stop people from changing a form after I've placed the order?",
        a:
          "Yes. Flip the Lock Form toggle to immediately close a form to new submissions and edits — for everyone, including the parent link. You can also set a Deadline: the form auto-locks at the date and time you choose, and parents see a 'closes in 2 days' countdown on their link. Use the Remind button any time to text only the parents who still haven't responded.",
      },
      {
        q: "Can I share music with my team?",
        a:
          "Yes. Open Team → Team Music to upload competition mixes or music (audio files up to 15 MB each). Everyone with Team Hub access can play them right in the app, and you can attach a track to specific teams or competitions so it's easy to find. Only team personnel can upload, edit, or delete tracks. (Background/locked-screen playback requires the installed app build, not Expo Go.)",
      },
      {
        q: "Can parents add a photo of their athlete to the roster?",
        a:
          "Yes. When you share your roster link, a parent can upload one photo of their athlete or staff member (no login needed) along with their info — it saves straight to that person on your internal roster. You can also add, change, or remove a member's photo yourself from the roster edit screen.",
      },
    ],
  },
  {
    title: "Seasons, weather & community",
    items: [
      {
        q: "How do seasons work now?",
        a:
          "Give a season a start and end date and CheerPlanner files your data into it automatically — competitions by their date, schedule events by date, expenses by due date, and payments by the due date of the expense they cover (so an August payment on a July bill counts toward the July season). No manual tagging needed. Switch the active season anytime from the season bar; pick \"All seasons\" to see everything. Records that fall outside every season's dates are never hidden — they stay visible under All seasons.",
      },
      {
        q: "Can I still put a record in a specific season by hand?",
        a:
          "Yes. A manual season tag always wins over the automatic date match — handy for things like a deposit paid before a season officially opens.",
      },
      {
        q: "What does \"Roll over to new season\" do?",
        a:
          "On the Seasons screen, tap a season → Roll over to new season. It creates next season for you (name and dates pre-filled), carries your teams and a checklist of athletes forward (uncheck graduating seniors), and makes the new season active. It never changes or deletes your old season, warns instead of creating a duplicate, and offers an Undo right after.",
      },
      {
        q: "Where does the weather forecast come from?",
        a:
          "Any competition or event that has a location and a date shows a forecast (high/low, conditions, chance of rain) right on its card and on the calendar. Forecasts come from Open-Meteo and cover about 16 days out — further-off events show \"forecast available closer to the date.\" If there's no location saved, no weather is shown.",
      },
      {
        q: "What are Community Reviews?",
        a:
          "A shared directory of cheer-friendly places (restaurants, hotels, gyms and more) that every CheerPlanner user can see and add to — open it from Settings → Community Reviews. Rate a spot 1–5 stars, filter by city and category, and post as your first name + last initial or anonymously. A competition's detail screen also suggests reviewed places in that city. To keep it safe, you must agree to Community Guidelines before posting, objectionable language is blocked automatically, and you can edit or delete your own review, report others, or block a reviewer at any time. Repeatedly reported reviews are hidden automatically.",
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
          "There are never any ads and we never sell your data. CheerPlanner is free to use with generous limits, and offers an optional Premium membership (in-app purchase via the App Store) that unlocks higher limits and the advanced Team Hub tools. See the Membership section below for details.",
      },
      {
        q: "Do you store my financial information?",
        a:
          "No. Money entries you log are tracking records only — CheerPlanner never connects to a bank, processes a payment, or stores card numbers. The 'payment' you log is just a note that you paid something, not an actual transaction.",
      },
      {
        q: "What happens to photos and music I upload?",
        a:
          "Photos (athlete/staff and record photos) and Team Music audio are stored only to power those features and to sync across your household and Team Hub. They're never sold or used for anything else, and deleting the item — or your account — removes them. See our Privacy Policy for full details.",
      },
    ],
  },
  {
    title: "Membership & subscription",
    items: [
      {
        q: "What's included in the Free plan?",
        a:
          "Free covers everyday cheer-parent needs: unlimited athletes, expenses, payments, fundraisers, competitions, travel, schedule, calendar and packing lists for your own family, plus a household of up to 2 members. Team Hub on Free includes the Roster (up to 36 athletes / 4 personnel), 1 sign-up sheet, and 1 attendance session.",
      },
      {
        q: "What does Premium add?",
        a:
          "Premium raises your household to 6 members and unlocks the full Team Hub: unlimited roster, unlimited sign-up sheets and attendance sessions, plus Sizes, Paperwork, Team Payment tracking, custom roster columns & expanded fields, spreadsheet import/export, parent share links, and mass SMS reminders.",
      },
      {
        q: "How much does Premium cost?",
        a:
          "$4.99/month or $39.99/year — the annual plan works out to a big saving versus monthly, and both come with a 7-day free trial. Prices are shown and charged by the App Store in your local currency; the store is always the source of truth.",
      },
      {
        q: "How do I upgrade, and can I try it first?",
        a:
          "Open Settings → Membership (or tap any locked Premium feature) to see the plans and start your 7-day free trial. You can cancel anytime during the trial in your App Store subscription settings and you won't be charged.",
      },
      {
        q: "I switched phones / reinstalled — how do I get Premium back?",
        a:
          "Open Settings → Membership and tap Restore Purchases. As long as you're signed into the same App Store account, your subscription (or lifetime access) is restored.",
      },
      {
        q: "Does Premium apply to my whole household?",
        a:
          "Yes. Premium is tied to your household, so once any member upgrades, everyone sharing that household gets the Premium limits and Team Hub features.",
      },
      {
        q: "What if I already have a lifetime or promo code?",
        a:
          "If you were given a lifetime access or promo code, redeem it on the web at cheer-planner.com/redeem while signed in. Lifetime members never see a renewal and don't need a store subscription.",
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
  contactBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.accent, borderRadius: 999, marginTop: spacing.xl },
  contactBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  footer: { ...typography.caption, color: colors.textTertiary, textAlign: "center", marginTop: spacing.sm },
});
