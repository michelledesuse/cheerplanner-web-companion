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
23. **Recurring expenses** (v2.0) – POST `/api/expenses` accepts `recurrence: "weekly" | "biweekly" | "monthly"` and `recurrence_count: int` (N). Server creates N occurrences with `incurred_on` and `due_date` shifted per recurrence (month math clamps day-of-month to month length). All occurrences share a `recurrence_group_id` for future grouping. Frontend exposes Repeat chips + occurrence-count input below the "Already paid" toggle (visible only on single-athlete create).
24. **Receipt attachments** (v2.0) – Expense form now has an image-picker block for attaching a receipt photo (base64 stored on `receipt_image`). Replace / Remove actions provided.
25. **CSV / ICS export** (v2.0) – Settings → Data → "Export expenses (CSV)", "Export payments (CSV)", "Export calendar (.ics)". Backend serves `/api/export/{expenses,payments}.csv` and `/api/export/calendar.ics`. Frontend handles both web (Blob download) and native (cache write + Sharing.shareAsync) cleanly.
26. **Home balance tap-through** (v2.0) – the bottom balance strip on Home is now tappable and routes to the Athletes tab where per-athlete Open balances are visible.
27. **Shared household** (v2.1) – two or more parents/guardians can share the same CheerPlanner data. Generate a 6-character invite code in Settings → Household → "Generate invite code", share it, the other parent enters it under "Join a household". Both users now see and edit the same athletes, expenses, payments, competitions, bookings, and fundraisers. Leave Household creates a new solo household for the leaver; remaining members keep all shared data. Implementation: backend `_household_user_ids()` helper widens every query from `user_id == me` to `user_id IN household.members`, with lazy household creation on first request.
28. **Schedule tab** (v2.2) – new bottom tab (5th position): **Home · Athletes · Expenses · Comps · Schedule · Calendar**. Tracks practices, team bondings, private lessons, choreography sessions, classes, and other events. Each event has a type (color-coded), title, optional location, date, start/end times, optional athlete tags, and notes. Events appear on the Calendar tab with their type color. Backend: `ScheduleEvent` model + GET/POST/PATCH/DELETE `/api/schedule` endpoints. Calendar feed widened to include schedule items. Empty-state CTA includes manual add AND "Import from spreadsheet" hooks.
13. **Athlete photo avatars** (v1.4) – each athlete can upload a square photo from their device gallery (stored as base64 data URL on the document). Photo renders everywhere the colored initial does (athletes tab, detail, etc.). Tap-to-clear supported via PATCH with `avatar_image: null`.

29. **Live theming engine** (v1.0.8) – Appearance picker (Settings → Appearance, 12 presets incl. dark themes `red_black`/`green_black` and light themes) now repaints the **whole app instantly** when a preset is chosen — backgrounds, cards, text colors and accent — no swipe-back needed. Implementation: `ThemeContext` delivers a fresh `palette` object through context state on every change (not just an in-place mutation + version int); `useThemedStyles(makeStyles)` (src/hooks) memoizes a StyleSheet keyed on the palette object identity so primitives (bg/card/textPrimary) stay live; `app/_layout.tsx` wraps the Stack in a themed `<View bg=palette.bg>` (react-native-screens caches `contentStyle`). Migrated screens: all 6 bottom tabs (dashboard, athletes, expenses, competitions, schedule, calendar) + settings + appearance + root layout. Theming rules baked in: monetary amounts/values use `textPrimary` (readable on any theme, no sea-of-accent-red numbers); grey icons use `textSecondary`; hardcoded hex literals replaced with palette tokens. (Verified iteration_29, 5/5 pass.) Known minor follow-up: cold-start with empty AsyncStorage first-paints theme.ts defaults until the household preset loads — could call `refreshPresets()` at bootstrap. Not-yet-migrated detail screens (athlete detail, expense/payment forms, household, import, help) — **now migrated (Tier-2, iteration_30)**, so the entire app re-themes live with no swipe-back.

31. **100% live-theme coverage + Saved named presets** (iteration_33) – (a) Migrated ALL remaining screens (auth, athletes/new, competitions/new+[id], schedule/new, bookings/new, fundraisers, teams, reminders, settings/notifications) and shared components (DateField, TimeField, MapLink, CompetitionTeamsSection, ColorField, etc.) to `useThemedStyles`, so the entire app re-themes live with no swipe-back. (b) `ColorField` shadow→`boxShadow` (remaining shadow*/ref warnings are library-internal). (c) **Save theme as named preset**: Appearance "Build your own" → "Save as preset" (name modal) stores the custom palette in `household.theme.saved`; a "MY SAVED THEMES" list lets families apply any saved look in one tap or delete it. New backend: `POST /api/household/theme/saved`, `DELETE /api/household/theme/saved/{id}` (cap 20). Verified iteration_33 (backend 10/10 pytest, frontend 5/5).

30. **Custom theme builder + full color picker** (iteration_32) – Settings → Appearance has a "Build your own" section with a full color picker (reanimated-color-picker) letting users choose up to **4 colors** mapped to roles: Accent, Background, Surface, Text. Tap a role chip to edit it (saturation panel + hue slider + live hex), watch the 4-stripe live preview, then "Apply custom theme" → persists via PATCH /api/household/theme `{preset_id:'custom', custom:{...}}` and restores on reload. Backend already supported `preset_id='custom'`. Also: dashboard bootstraps `refreshPresets()` so a cold start paints the saved household theme. Setup Guide (step 12) and FAQ ("Appearance & themes") updated to document theming. (Verified iteration_32, all pass.)

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

## v2.2 — Imports & sort (latest)
- Expenses tab: sort toggle "Recent" ↔ "Due date" (ascending by `due_date`, no-due-date items last). Client-side, instant.
- Import hub: global CSV/XLSX format toggle; all templates downloadable as `.csv` or `.xlsx` (openpyxl). XLSX includes a "Reference" sheet (valid Categories / accepted options).
- New "Teams to Watch" import: template + parser + commit. Rows match a Competition by name and append a `TeamToWatch` ({name,date,location,performance_time}); unmatched competition names auto-create a placeholder competition (with a warning). Rows missing competition OR team name are skipped.
- `ALLOWED_IMPORT_KINDS` now includes `teams_to_watch`.

## Backlog (deferred to a future session)
- Shareable fundraiser links (P2).
- Teams-to-Watch preview screen: add a "Create missing competitions" confirmation toggle (like Travel import) so a typo'd competition name doesn't silently create a placeholder.

## Backlog — added (future, not yet built)
- C1: **Conflict Detection for events** — highlight schedule events (and ideally practices vs comps/travel) whose date + start/end times OVERLAP, so parents can spot double-bookings. Surface a visual warning (e.g. a red "Overlaps with X" badge) on the Schedule tab and/or Calendar day view. Consider per-athlete conflict scope (an athlete double-booked) vs household-wide.
- C2: [DONE — iteration_50] "Jump to Today" button on the Calendar — appears in the header only when viewing a non-today date; resets selected + month to today across Month/Week/Day. testID cal-today.
- C3: **Weather integration for events/competition dates** — show a weather forecast (and/or historical/climate averages for far-out dates) for the location of upcoming Competitions and Schedule events. Surface on the competition detail, schedule event, and/or calendar day view. Needs a weather API (e.g. Open-Meteo — free, no key; or OpenWeatherMap — requires API key) + geocoding of the event location/address. Forecast APIs typically only cover ~14 days out, so for dates beyond that fall back to seasonal/climate normals or show "forecast available closer to the date."
- Offline support (user question, phased): Phase 1 = local read-cache (AsyncStorage/expo-sqlite) so screens render with no connection; Phase 2 = offline write queue + sync engine with conflict resolution (multi-member households). Larger effort — do in phases.
- 1. Schedule Event: add an explicit start/end date range (multi-day event, e.g. Choreography Jul 1–Jul 5), offered IN ADDITION to the existing recurring-event option.
- 2. Add "Fundraiser" as a selectable schedule Event type.
- 3. Let users create/manage their own custom event types (persisted per household).
- 4. In-app autofill: remember previously used values (locations, addresses, providers, categories, team names, etc.) and suggest them in form fields.
- 5. Calendar tab: toggle to view Day / Week / Month.
- 6. Home tab: "Total Due Today" card = sum of all expenses + travel costs due today.

## Backlog — web companion (added)
- Companion WEBSITE that shares the SAME backend/database so users can use CheerPlanner on desktop or phone. Ranked HARDEST/largest: reuses existing FastAPI API + JWT auth, but is effectively a full second frontend (all screens, auth, responsive web UI). Bigger than offline support. Do as a dedicated multi-phase project.
- **REAL-TIME SYNC (user request, for website phase):** When building the companion website, implement real-time listeners so the website AND the mobile app feel like ONE fluid experience — a change on either surface reflects instantly on the other. Approach options: WebSockets (FastAPI `WebSocket` endpoints broadcasting per-household updates) and/or MongoDB Change Streams (watch collections filtered by household, push diffs to connected clients). Scope: both web and mobile subscribe to household-scoped update channels; on create/update/delete, broadcast the changed resource so all clients (web + phones in the same household) live-update without manual refresh. Bundle this into the companion-website multi-phase project.

## Difficulty order (easiest -> hardest), pending
1. Fundraiser as schedule event type  [DONE]
2. Teams-to-Watch "create missing competitions" toggle  [DONE]
3. Home "Total Due Today" card  [DONE]
4. Schedule event start/end date range  [DONE]
5. Calendar Day/Week/Month toggle  [DONE]
6. Shareable fundraiser links  [DONE]
7. User-created custom event types  [DONE — v2.3, iteration_48: household-wide custom event types (with color) + custom expense categories, added inline from create forms]
8. In-app autofill with memory
9. Offline support (phased)
10. Companion website (shared DB) — hardest

## Twilio SMS — LIVE (v2.4, toll-free approved)
- Stored in backend/.env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER=+18446977111 (toll-free).
- Toll-free verification APPROVED (Jun 2026). SMS sending is now enabled.
- Implemented: `core/sms.py` (send_sms/normalize_us_phone/is_configured via twilio==9.10.9); hourly digest scheduler sends an SMS alongside the email when prefs.sms_enabled + sms_phone (own dedupe key `{user}:{date}:sms:{freq}`); POST /api/notifications/sms-test one-off confirmation text; Settings "Send me a test text" button. STOP/HELP handled by Twilio at carrier level for the toll-free number (no custom webhook needed).

## Session update
- DONE: #5 Calendar Day/Week/Month toggle (segmented Month/Week/Day, prev/next nav, reuses /api/calendar range).
- DONE: Fundraiser page improvement — goal_amount field + public /f/<token> progress bar + Copy link. PATCH can clear goal (nullable).
- DEFERRED: #7 user-created custom event types (full-stack; next focused session).

## Session update 2
- DONE: Fundraiser external link — added optional "Fundraiser link (URL)" field on add/edit form (link_url on Fundraiser/Create/Update, nullable so it can be cleared). Share button now shares the ACTUAL external URL (not the app summary page). Tapping a fundraiser row opens a popup: "Open fundraiser link" (external browser via Linking) or "Edit details". If no link set, share/open prompts to add one. URLs auto-prefixed with https:// if missing scheme.
- Note: the old /f/<token> public summary page + /fundraisers/{id}/share endpoint remain but are no longer used by the app (harmless; can be retired later).

## Backlog — added (for later, NOT yet built)
- B1 (BUG): [DONE] Expenses ascending order across ALL screens — fixed backend /expenses sort to incurred_on asc.
- B2: [DONE — v2.3] User-created custom EVENT types AND custom EXPENSE categories — creatable inline from the create forms via a "+ New" option, saved household-wide, reusable/selectable later. Event types include a color; deleting a type keeps existing items' label as plain text. Calendar colors custom-typed events with their chosen color.
- B3: [DONE] Filter events AND expenses by athlete/team/type (combinable) — inline chip rows on Expenses, Schedule, Competitions.
- B4: [DONE] Calendar Day/Week/Month — added a "jump to date" header button (testID cal-jump) to jump directly to the day/week/month containing a chosen date (cross-platform: web HTML date picker, native DateTimePicker). Verified iteration_46.
- B6 (small): [DONE] Active-filters UI — new `ActiveFiltersBar` component shows applied-filter count + a "Clear all" pill on Expenses, Schedule, and Competitions tabs to reset stacked Athlete+Team+Type/Category filters in one tap. Verified iteration_46.
- B5 (small): [DONE] Renamed "Spent" → "Season Total" (Athletes cards, Athlete detail, FAQ).
- B6 (small): Active-filters UI — [DONE, see above under B4/B6 done entries]
- B7 (LARGE): Email auto-import ("TripIt for cheer") — parse cheer-related emails (hotel/flight bookings, competition registrations, gym invoices, payment receipts) and auto-create Competitions/travel, Expenses, and Payments. All parsed items land in a "Review & confirm" inbox before committing (never auto-commit blindly).
    - Phase 1 (recommended MVP): Forwarding inbox — unique per-user address (e.g. user@inbox.cheer-planner.com) via inbound email service (Postmark/SendGrid Inbound/Mailgun). Parse via known-sender templates + LLM extraction (Emergent key → structured JSON). Start with expenses + registrations.
    - Phase 2: Travel/hotels → attach dates + booking link to the matching Competition.
    - Phase 3 (optional, heavy): Gmail/Outlook OAuth auto-scan for zero-effort import. NOTE: Google restricted Gmail scopes require a CASA security assessment + privacy-policy obligations — main blocker, not the code.
    - Considerations: ~90%+ accuracy on known senders (confirm step covers the rest); LLM cost fractions of a cent/email; privacy is the key concern (Phase 1 avoids full-mailbox access).

## Session update 3 (bug fixes)
- Recurring/repeat events: verified already working in current code (backend expands series, calendar shows all occurrences). The user's report was against an older installed build; fixed once v1.1.0 ships.
- Multi-day events now split into one editable event per day (shared series_id) so each day can hold different links/times/notes. Editing/deleting prompts "This day only" vs "All days". Applied to new events + idempotent startup migration converts legacy multi-day docs on deploy. Files: routers/schedule.py, core/helpers.py (_date_range), server.py (startup migration), scripts/migrate_multiday_events.py, app/schedule/new.tsx.
