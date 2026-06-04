# CheerTrack – Product Requirements (v1)

## Vision
A mobile app for cheer parents to keep every dollar, due date, hotel block, and competition organized in one place.

## Users
- A parent with one or more cheer athletes (kids).
- Authenticates with email & password (custom JWT).

## Core capabilities (v1 - MVP)
1. **Auth** – signup, login, JWT, bcrypt, rate-limited login. Tokens stored via SecureStore.
2. **Athletes** – CRUD; multiple athletes per parent; per-athlete totals (spent / paid / balance).
3. **Expenses** – per athlete (or **bulk multi-athlete**: select multiple athletes + toggle "Split equally" vs "Same per athlete"), categorized. Each expense exposes `paid_amount` and `balance_due`. Supports **partial payments**: tap the per-row "Apply" button to apply funds from manual cash or any fundraiser with available balance. Fully covered expenses auto-flip to `paid=true`.
4. **Payments** – per athlete (or **bulk multi-athlete** with same split-mode toggle) with method tracking (Card, Bank, Cash, Fundraiser, Other). Linkable to one or more expenses (`applied_expense_ids`). Payment rows show "Applied to: <category>" inline. Mark-paid auto-flip only fires when cumulative payments fully cover the expense.
5. **Competitions** – name, location, event date, housing required flag, booking link, booking-release datetime, notes.
6. **Travel & accommodations** – per competition: hotel (provider, conf#, check-in/out, cancel-by, cost, paid, balance, due), rental car (provider, conf#, cost), flight (airline, conf#, depart/arrive, return leg, cost). Travel-budget summary per competition.
7. **Reminders** – auto computed from expense due dates, hotel/booking balance due dates, hotel cancel-by, and competition booking release datetimes. Urgency levels: overdue / due soon (≤3d) / upcoming (≤7d) / future. Surfaced on dashboard & dedicated tab.
8. **Fundraisers** – simple ledger of money raised; totals on dashboard.
9. **Dashboard** – Home tab. Stat tiles (this month, paid YTD, athletes, raised), next competition card, top reminders, compact bottom balance strip (outstanding / expenses due / travel). Settings reachable via header gear icon.
10. **Settings** – profile, currency (USD), preferences view, sign out. (Not in main tabs; accessed via Home gear icon.)
11. **Competition assignment** – each athlete can be assigned to one or many competitions (multi-select). Toggles available from both Athlete detail and Competition detail screens.
12. **Calendar** (v1.5) – month view with multi-dot markers from a single `/api/calendar` feed. Sources: expense due dates (red), competitions (blue) — multi-day comps span every day with "starts" / "day X of N" / "ends" titles, hotel checkin/checkout & flight depart/return (purple) — hotel stays span every night, flights with both legs span every day in-between as "Travel day", fundraiser dates (green). All inputs are normalized to ISO via a backend `_normalize_date()` helper so that flight times (which are saved as freeform `"DD-MM-YYYY HH:MM"` or `"DD/MM/YYYY"` text) are parsed correctly. Tapping a day surfaces all events; tapping an event navigates to the related screen.
14. **Edit expenses** (v1.5) – tapping any expense row (on the Expenses tab or athlete detail) opens the expense form in edit mode. PATCH `/api/expenses/{id}` accepts category, amount, incurred_on, due_date, note, and paid; `paid_amount`/`balance_due` are recomputed live from linked payments.
15. **Auto-populated expense due date** (v1.6) – when creating a new expense, the due date mirrors the expense (incurred_on) date by default. Changing the expense date updates the due date automatically until the user manually overrides the due date. Backend also defaults `due_date = incurred_on` when omitted on POST `/api/expenses` and POST `/api/expenses/bulk`.
16. **Fundraisers segment on Money tab** (v1.7) – the Expenses (Money) tab now has THREE segmented sub-tabs: Expenses · Payments · Fundraisers. The Fundraisers segment shows total raised + available summary, lists all fundraisers with applied/available indicators, exposes an "Apply to expense" pill per row, and the header `+` button reads "Fundraiser" → opens the fundraiser create screen. Empty state has a prominent "Add fundraiser" CTA.
17. **Fundraiser editing** (v1.8) – the fundraisers screen now supports edit (tap the pencil icon on a row); PATCH `/api/fundraisers/{id}` accepts name/amount_raised/raised_on/note/athlete_id; nullable fields can be cleared.
18. **Per-athlete filter on Money tab** (v1.8) – when 2+ athletes exist, a horizontal scrolling chip strip lets you filter expenses + payments by one athlete (or All).
19. **Overdue badge on expenses** (v1.8) – any unpaid expense with `due_date < today` gets a red "OVERDUE" pill next to the category name on the Money tab.
20. **Inline payment editing** (v1.8) – tapping a payment row on the Money tab opens the payment form in edit mode (the form already supported `?id=` param).
22. **Expense due dates always visible on the Calendar** (v1.9) – the Calendar emit now falls back to `incurred_on` when `due_date` is missing/null, and normalizes all dates through `_normalize_date()` so legacy or imported records show up. A one-time startup backfill copies `incurred_on` into `due_date` for any expense missing it (156 records backfilled in production on first deploy). Tapping a red dot now opens the expense edit form directly (previously opened the athlete detail).
13. **Athlete photo avatars** (v1.4) – each athlete can upload a square photo from their device gallery (stored as base64 data URL on the document). Photo renders everywhere the colored initial does (athletes tab, detail, etc.). Tap-to-clear supported via PATCH with `avatar_image: null`.

## Tab structure (v1.3)
**Home · Athletes · Expenses · Comps · Calendar**. The Expenses tab is a combined Money screen with an Expenses/Payments segmented control, "ALL/OPEN/PAID" filter, and a top-right quick-add button. Reminders & Settings remain accessible but are hidden from the tab bar.

## Tech
- Backend: FastAPI + Motor (MongoDB) + bcrypt + PyJWT + slowapi. UUID ids, ISO-string datetimes. `_id` excluded from all responses.
- Frontend: Expo Router (file-based), React Native, axios, Ionicons, SecureStore via `@/src/utils/storage`.
- Theme: Slate-900 primary, rose-600 accent, stone-50 background. Manrope/IBM Plex-equivalent system fonts.

## Out of scope (v1)
- Email & SMS reminders (planned for later — user opted to skip)
- Multi-parent collaboration
- Push notifications
- Reports/exports

## Smart growth hook
Fundraisers tracker — quietly turns parents into evangelists by letting them celebrate raised totals, share with their team, and offset upcoming dues. Future hook: shareable fundraiser links.
