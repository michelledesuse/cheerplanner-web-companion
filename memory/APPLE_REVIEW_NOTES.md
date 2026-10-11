# Apple App Review — Submission Notes

Paste the "App Review Notes" section below into App Store Connect →
your app version → **App Review Information → Notes**.
Enter the demo credentials in the **Sign-In Required** fields.

_Last updated: July 29, 2026 (after: live sync, Team Hub links, link-attached
reminders, "last reminded" timestamps, sign-up Excel/CSV export, roster native texting)._

---

## Demo Account (Sign-In Required)
- **Username:** applereview@cheerplanner.app
- **Password:** Review2026!

This account is the single App Review + App Store screenshot account. It has Lifetime
Premium (all paywalled features unlocked) and is pre-loaded with: 2 athletes, 2 upcoming
competitions with hotel/flight/car, expenses + a payment, a fundraiser, weekly practices,
3 Smart Inbox drafts, an 8-person TeamHub roster, 3 payment trackers, 2 sign-up sheets,
2 paperwork sheets, 3 attendance sessions, team sizes, 3 competition results, 2 Team Forms,
TeamChat (main thread + "Parents & Coach" channel + a flyer), AI Designer flyers + brand kit,
an SMS broadcast with delivery receipts (no real texts sent), and Community Reviews.

Reset any time: Admin → Testing → "Reset demo data" (or `python scripts/seed_marketing_demo.py`).
Extra logins for chat/ParentGuard demos (password CheerDemo2026!): coach.casey@, parent.taylor@,
mia.athlete@ (pending approval), sophia.athlete@ (approved) — all @cheerplanner.app.

> ⚠️ The reviewer tests the **deployed/production** build. Confirm this account
> exists, logs in, and has data in **production** — not just the builder — before submitting.

---

## App Review Notes (copy/paste)

ABOUT THE APP
CheerPlanner helps cheerleading families and coaches organize expenses, competitions, travel, schedules, packing lists, paperwork, and team payments in one shared app.

HOW TO REVIEW KEY FEATURES
1. Sign in with the demo account above.
2. Family tools: Explore the bottom tabs — Home (dashboard), Athletes, Expenses, Competitions, Schedule/Calendar, and Reminders.
3. Team Hub (coach/staff tools): Open the Team tab. From here you can view the Roster, Payments, Paperwork, Sign-ups, Attendance, Sizes, Team Forms, and Competition Results. Lists can be archived and reordered. Sheets and items can have links attached, and you can export sign-up lists as Excel/CSV.
3a. Team Chat: supervised group chat with Community Guidelines, report and block. Minors only join with parent approval (ParentGuard).
3b. Smart Inbox: Home → Smart Inbox shows confirmations that were read into draft bookings/expenses/payments; tap one to review and confirm.
3c. Community Reviews: public reviews of places (restaurants, hotels, etc.) with report/block.
4. Live sync: Shared data updates in real time across sessions; a "Live" indicator shows the connection status.

TEXT MESSAGING (IMPORTANT)
- SMS reminders are OPTIONAL and are only sent when a user explicitly opts in. Consent is not required to use the app. Users can reply STOP to opt out or reply HELP for help. Our SMS opt-in details are available in-app and at the "Text Messaging Opt-In" page.
- The Roster "Text" button simply opens the device's native Messages app pre-filled with a contact's number; those messages are sent by the user through their own carrier, not by the app.
- Please do NOT trigger reminder texts to real phone numbers during review. The demo account's roster is empty/uses non-deliverable test numbers, so no real messages will be sent.

SUBSCRIPTIONS / IN-APP PURCHASE
- Some premium features are available via auto-renewable subscription through Apple In-App Purchase (managed via RevenueCat).
- The demo account has Premium unlocked, so every feature is reviewable without purchasing.

PRIVACY
- Data is only shared with household members or team staff the user explicitly invites. A full Privacy Policy and the SMS/Text Messaging Opt-In page are linked in the app.

CONTACT
For any questions during review, contact: info@cheer-planner.com

---

## Pre-submission checklist
- [ ] `applereview@cheerplanner.app` logs in on the **production** build with sample data.
- [ ] Demo username/password entered in App Store Connect → Sign-In Required.
- [ ] These notes pasted into App Review Information → Notes.
- [ ] If real IAP is enabled: subscription is "Ready to Submit" and attached to this version.
- [ ] Privacy Policy URL and SMS Opt-In page reachable.
- [ ] "What's New" release notes updated for this build.
