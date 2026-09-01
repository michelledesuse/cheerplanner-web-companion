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

## Backlog — Timed SMS reminders (user request, future; SMS-ONLY)
- S1: [DONE — iteration_52] **Precise SMS lead-time reminders.** Per-event offsets (60/30/15/1 min before) on (a) stay-to-play booking opening (`Competition.booking_release_at`) and (b) flight check-in (opens 24h before each leg's departure). New every-1-minute scheduler job `send_timed_sms_tick` (digest stays hourly), user-tz interpretation via `parse_local_datetime`, per-offset dedupe in `sent_notifications`. SMS-only, gated on `sms_enabled`+`sms_phone`. Frontend `SmsReminderPicker` on competition + flight-booking forms. Verified backend 8/8 + frontend flows.


## Backlog — Filters & Home totals (user request, future)
- F1: [DONE — iteration_51] **Filter-aware summary totals on Expenses/Payments.** Open balance + Paid YTD now recompute from the active athlete/team/category SCOPE (not the all/open/paid status toggle); labels show "(filtered)" when a scope filter is active. Payments tab scopes by athlete.
- F2: [DONE — iteration_51] **Home "Total Due Today" card.** `/api/dashboard.due_today` now = unpaid expenses + positive booking balances with due date ≤ today (due today + overdue). Card subtitle updated to "Due today + overdue · expenses & travel". (Label kept as "Total due today" per user.)


## Backlog — Roles & Team Hub (user request, future)
- R1: [DONE — iteration_53] Added roles **Team Rep/Mgr** + **Staff** to the per-athlete role selector (now Athlete/Coach/Team Rep/Mgr/Staff). Backend `Athlete.role` Literal extended + validated (422 on invalid). Shared `src/utils/roles.ts` (labels/icons/STAFF_ROLES). Role badges show in the athletes list.
- R2: [DONE — iteration_53] **Home moved off the bottom tab bar** → a header **Home button** (`HomeButton`, testID `home-btn`) on every tab screen; routes to dashboard. Dashboard route kept (href:null) and remains the login/signup landing.
- R3: [DONE — iteration_53] **Team tab added** to the bottom bar (Athletes/Expenses/Comps/Schedule/Calendar/Team).
- R4: [IN PROGRESS — Phase C] **Team Hub tools.** Landing shipped (`app/(tabs)/team.tsx`). Roster = **DONE (iteration_54, extended this session)**: household-scoped CRUD + one-tap "Add from my household" import of athletes (household-member import removed — parents are NOT roster members). **Multi-team**: a member has `team_ids` (list) and can belong to multiple teams. Roster list groups by role with visible section headers in order **Coaches → Staff & Reps → Athletes**, sorted by last then first name; under "All teams" a member shows once per team. Contact rule: coaches/staff/reps show OWN phone/email; athletes show PARENT phone/email (`routers/roster.py`, `app/team/roster.tsx` + `roster-new.tsx`).
  REFRAMED (user): the Hub centers on the roster with attachable, trackable data + a combined export. Remaining tools:
    - **Payment Tracking** = **DONE (iteration_54)** — tracking-only ledger. Optional expected amount per person; each person records a VARIABLE actual amount + payment method (Cash/Check/Venmo/Zelle/CashApp/PayPal/Card/Other + free-text) + date paid + note. `method` added to TeamPaymentEntry; `_roster_total` excludes parents (`routers/team_payments.py`, `app/team/payment.tsx` + `payments.tsx`). **Owes/short indicator (iteration_59):** summary returns outstanding/short_count/unpaid_count; list card shows an amber "N owe · $X short" pill, detail shows an outstanding banner + per-person "owes $X" tags. (NOTE: Team Hub payment model is `TeamPaymentEntry` — renamed from PaymentEntry to fix a name collision that had broken the money `/api/payments`.)
    - **Sizes** = **DONE (iteration_55)** — one shared household spreadsheet-style sheet over the roster. Default columns (Shirt, Tank, Sports bra, Shorts, Shoes, Sweatshirt, Jacket, Ring); coaches can add/rename/delete custom columns. Free-text value per member per column. Team-filterable; parents excluded. Includes a **size tally** (per-item breakdown: each size value + count, plus "Not set", respecting the team filter) via the stats icon in the header. Backend `routers/sizes.py` (`/api/team/sizes*`, single sheet per household), frontend `app/team/sizes.tsx`. 11/11 pytest.
    - **Paperwork / Other** = **DONE (iteration_56)** — multiple named sheets, fully-custom items (add/rename/delete), checkbox + optional note per member per item, team-filterable, parents excluded. Completion tally per item. Backend `routers/paperwork.py` (`/api/team/paperwork*`), frontend `app/team/paperwork.tsx` (list) + `app/team/paperwork-sheet.tsx` (grid + per-member modal). 13/13 pytest + frontend e2e.
    - **Sign-Up Sheet** [BACKLOG — user request, "for later"] — parents sign up to volunteer or bring items for events (e.g. snacks, decorations, chaperone slots). Coaches/reps create a sheet with slots/items + qty needed; parents claim slots. Scoped to team/event. Shown as a COMING SOON card in the Team Hub tool list.
- R5: [TODO — Team Hub] **Custom tracking lists (spreadsheet-style checklists over the roster).** Named list + a "type" (Attendance, Stay-to-Play, Sizes, Paperwork, Payment), rows = roster, user-defined columns (checkbox / short text / date), editable grid, per-list progress. Payment/Sizes/Paperwork trackers above can be implemented as built-in list "types" on this same engine.
- R6: [TODO — Team Hub] **Custom Roster Export / combined view.** Let staff pick which columns to include (contact fields, sizes, paperwork status, payment status, any tracking-list columns) and optionally filter/scope by a competition or event, then view them together and **download** (CSV/PDF via existing `routers/exports.py`). Example: for one competition, pull sizes + waiver status + team-bonding payment status into a single downloadable sheet.
  NOTE: this is a larger multi-phase effort; scope each tool separately when picked up. Likely household/team-scoped and gated by role (rep/mgr/coach/staff).
- Team Hub ROLE GATING: [DONE — iteration_55] Team tab stays visible, but the Hub tools only render when the household has ≥1 person marked Coach/Team Rep/Mgr/Staff (`STAFF_ROLES` check against `/athletes` in `app/(tabs)/team.tsx`). Otherwise a locked card explains how to unlock + a shortcut to add a staff person. Also renamed landing tools: Payment Tracking, Sizes, Paperwork/Other, Custom Roster Export.

  DECISIONS (confirmed by user):
    - A "Team" is NOT the existing household — it's a separate shared group. For NOW, the Hub is a private workspace for coaches/mgr/rep/staff to track info they need handy. FUTURE: grant parents/athletes read-only access to view items the staff update.
    - Access: parents/athletes are READ-ONLY (future); for now Hub is staff-only.
    - Gifts & Meals ledger is TRACKING ONLY — no real payments are sent/received in-app. FUTURE: when the TripIt-style email/receipt lookup (B7) lands, the hub manager can forward Venmo/other payment receipts into the app to be auto-tracked.
  BUILD PLAN: Phase A (roles R1) + Phase B (nav R2+R3) together first (low-risk, visible); then Phase C (R4) tool-by-tool starting with Roster (foundation for ledger + waivers).

- Offline support (user question, phased): Phase 1 = local read-cache (AsyncStorage/expo-sqlite) so screens render with no connection; Phase 2 = offline write queue + sync engine with conflict resolution (multi-member households). Larger effort — do in phases.
- 1. Schedule Event: add an explicit start/end date range (multi-day event, e.g. Choreography Jul 1–Jul 5), offered IN ADDITION to the existing recurring-event option.
- 2. Add "Fundraiser" as a selectable schedule Event type.
- 3. Let users create/manage their own custom event types (persisted per household).
- 4. In-app autofill: remember previously used values (locations, addresses, providers, categories, team names, etc.) and suggest them in form fields.
- 5. Calendar tab: toggle to view Day / Week / Month.
- 6. Home tab: "Total Due Today" card = sum of all expenses + travel costs due today.

## Session update 10 (Team Hub links + reminders + sign-up download + roster text)
- DONE (iter75, backend 15/15): Attach multiple links `{label,url}` (ExternalLink) to Team Hub **Payment trackers** (per tracker), **Sign-up sheets** (per sheet), and **Paperwork items** (per item). Reuses the existing `LinksEditor` + `cleanLinks`. Persisted on create + edit for all three (`/api/team/payments`, `/api/team/signups`, `/api/team/paperwork/{id}/items`).
- DONE: Reminder texts now include ALL links for that item/sheet/tracker via `core/sms.join_links()`. Payments `/remind` appends "Pay here: …". NEW `POST /api/team/paperwork/{sheet}/items/{item}/remind` (texts each roster person still MISSING that item, "Complete it here: …"). NEW `POST /api/team/signups/{id}/remind` (texts roster people who haven't claimed any slot, "Sign up here: …"). All athlete texts → parent phone; staff → own phone. Gated `mass_sms_reminders` (bypassed pre-launch). Twilio is LIVE.
- DONE: **Download sign-up list** — on the sign-up sheet detail (Edit sheet modal → "Download list"): exports CSV of Slot/Type/Time/Qty needed/Signed up by/Qty/Note via `exportAoa`.
- DONE: **Roster "Text" chip** per member (testID `roster-text-<id>`) opens the native Messages app pre-filled (athlete→parent phone, staff→own); web shows an info alert (sms: not supported). One at a time, go down the list.
- Frontend files: app/team/payments.tsx, payment.tsx, signup-sheet.tsx, paperwork-sheet.tsx, roster.tsx. Verified links UI renders; backend tests `/app/backend/tests/test_iter75_links_and_reminders.py`.
- DONE (follow-ups): (1) **Last reminded** timestamp — `last_reminded_at` set on the tracker/sheet/paperwork-item whenever a reminder actually sends (sent>0); shown as "Last reminded {date/time}" under each reminder button. Verified end-to-end (Twilio magic number). (2) **Downloads offer both formats** — the sign-up sheet download now has Excel (.xls) + CSV (.csv) buttons (roster & Team Hub export already offered both).

## Session update 11 (Seasons + Sign-up "remind who signed up")
- DONE (iter76, backend 32/32): **Seasons** — new `seasons` collection + `/api/seasons` CRUD, activate (one active/household), rollover (multi-season membership via $addToSet), delete (detaches `season_ids`, promotes next active). Added `season_ids` to Athlete/Team/Competition/ScheduleEvent (+Create/Update). List endpoints accept `?season_id=` (includes unassigned items). Scoped edit fork via `apply_scoped_update` in core/helpers (edit_scope this/forward/all) wired into athletes/teams/competitions PATCH (events use recurrence scope). Frontend: `SeasonContext` + `SeasonProvider`, `/seasons` management screen, `SeasonBar` on dashboard, Settings → Seasons row, list filtering (athletes/comps/schedule/teams), auto-assign active season on create.
- DONE (iter76): Sign-up **remind-claimed** — `POST /api/team/signups/{id}/remind-claimed` texts everyone who signed up with a summary of what they signed up for; sign-up Edit modal now has two reminder buttons (not-signed-up vs signed-up).

## REMAINING for this batch (in progress)
- [x] Photos: multiple photos on events, competitions, sign-up sheets, payment trackers, paperwork, fundraisers (internal galleries DONE). Public roster share link: parent uploads ONE athlete/staff photo — DONE (iter77): `RosterMember.photo`, public `/submit` accepts base64 (client-resized ≤600px), renders in internal roster avatar + coach can add/change/remove in roster edit form.
- [x] Season filtering extended to Expenses, Payments, Fundraisers — DONE (iter77): `season_ids` on Expense/Payment/Fundraiser (+bulk), list endpoints accept `?season_id=` via `season_query` (tagged items show only under their season; untagged always show), auto-tagged with active season on create. Frontend passes `filterSeasonId` on Expenses tab + Fundraisers. (athletes/staff/events/competitions/teams already season-scoped.)
- [x] Seasons Phase C2: per-item SeasonPicker (multi-attach) in detail/edit forms + the this/forward/all scope PROMPT UI — DONE (iter78): new `src/components/SeasonPicker.tsx` wired into athlete/competition/schedule/team edit forms; scope selector (this/forward/all → backend edit_scope) shown only when an item spans >1 season. Backend apply_scoped_update already handled forking.
- [x] Template management UI: edit/delete user-created packing-list templates — DONE (iter77b): Templates picker gained a "Manage" mode (rename via inline input, delete with confirm) for non-default templates; CheerPlanner Standard is locked. Wired to existing PATCH/DELETE /api/packing-templates.
- [x] FAQ + setup guide: add subscription info + current adjustments — DONE (iter77b): FAQ got a new "Membership & subscription" section (Free vs Premium, $4.99/mo & $39.99/yr + 7-day trial, restore, household-wide, lifetime codes); fixed the outdated "no in-app purchases" answer; updated Team Hub access answer (owner-controlled) & packing template answer. Setup Guide got step 17 (Seasons) + step 18 (Go Premium) and refreshed packing/templates copy.
- [ ] UI-consistency review across Team Hub + Parent Portal (requested last).

## Session update 14 (music playback fix + season filter visibility + roster request-info, iter80)
- FIX (**Team Music playback**): stream endpoint now supports HTTP **Range** (200 + `Accept-Ranges: bytes` for full, **206 Partial Content** for ranges) — iOS AVPlayer/expo-audio requires this; also `setAudioModeAsync({playsInSilentMode:true})` so it's audible on silent. Verified 200/206 byte-exact.
- FIX (**"where do I filter by season?"**): the `SeasonBar` picker was only on the Dashboard — now also rendered on **Athletes, Competitions, Expenses, and Schedule** tabs (they already filtered by the active season).
- NEW (**Request info link**): per-member completion link for someone already on the roster but missing info. `kind="roster_member"` share link pre-fills their current info; `POST /api/team/roster/{id}/request-info {base_url, send}` — texts the link via Twilio if a phone is on file, otherwise the roster row's "Request info" sheet offers Copy/Share. Token is reused on repeat. SMS guarded (400 when no phone). Verified iter80 (12/12 pytest + frontend).


- DONE: **App-wide button/chip color standardized to CheerPlanner blue (`accent`)** — swapped interactive `colors.primary`/`c.primary` → accent across ~35 files (Parent Portal was navy, Team Hub blue). Root cause of prior mismatch: theme mutates `accent` but never `primary`, so primary buttons ignored custom themes. Now all CTAs follow the user's custom Appearance color.
- DONE: **Schedule tab UX** — smaller header Add/Select buttons; Type filter row gained a dashed "+ Type" add-chip (opens AddTypeModal) + a right chevron scroll-hint on overflow (FilterChipRow now supports `onAdd`/overflow detection).
- DONE: **Seasons dates → MM-DD-YYYY** via shared `DateField` (ISO storage, MM-DD-YYYY display) on create/edit + row display; **keyboard no longer covers inputs** (Create/Edit modals wrapped in KeyboardAvoidingView).
- DONE: **Seasons screen now theme-following** — converted its static `StyleSheet.create` to `useThemedStyles(makeStyles)` (was frozen at default accent).
- DONE: **Splash screen re-branded** — app.json expo-splash-screen now uses `cheerplanner-logo-full.png` on white (was the Emergent "e" splash). REQUIRES a native rebuild/publish to take effect; not visible in Expo Go/web preview.
- Tested iter79 (frontend): no red screens, buttons blue + theme-following, schedule add-type + seasons keyboard/date fixes verified.


- DONE: **Seasons Phase 2** — `SeasonPicker` (multi-select season chips + this/forward/all scope selector) on athlete/competition/schedule/team edit forms. Scope maps to backend `edit_scope`; only shown when item is in >1 season.
- DONE: **Schedule conflict detection** — Schedule tab flags events on the same date with overlapping start/end times: amber badge "Overlaps with <title>" (household-wide) or "<athlete> double-booked" (shared athlete). Client-side in `app/(tabs)/schedule.tsx` (testID schedule-conflict-<id>).
- DONE: **Team Music** (Team Hub, FREE) — `routers/music.py`: chunked base64 upload → GridFS (bucket team_music), token-auth streaming (`GET /api/team/music/{id}/stream?token=`), list/patch/delete, 15MB cap. Frontend `app/team/music.tsx` (upload via expo-document-picker, playback via expo-audio, attach to teams/competitions, edit/delete) + Team Hub tool card. Models TeamTrack/Init/Update; startup indexes. Backend 8/8 pytest (iter78).
- FIX: `POST /api/schedule` no longer 500s when photos/season_ids/athlete_ids/links omitted (None→[] normalization).
- NATIVE-BUILD NOTE: expo-audio playback + DocumentPicker upload are best tested on a real device/TestFlight build; web preview verifies UI only.


- Companion WEBSITE that shares the SAME backend/database so users can use CheerPlanner on desktop or phone. Ranked HARDEST/largest: reuses existing FastAPI API + JWT auth, but is effectively a full second frontend (all screens, auth, responsive web UI). Bigger than offline support. Do as a dedicated multi-phase project.
- **REAL-TIME SYNC (user request, for website phase):** When building the companion website, implement real-time listeners so the website AND the mobile app feel like ONE fluid experience — a change on either surface reflects instantly on the other. Approach options: WebSockets (FastAPI `WebSocket` endpoints broadcasting per-household updates) and/or MongoDB Change Streams (watch collections filtered by household, push diffs to connected clients). Scope: both web and mobile subscribe to household-scoped update channels; on create/update/delete, broadcast the changed resource so all clients (web + phones in the same household) live-update without manual refresh. Bundle this into the companion-website multi-phase project.

## Backlog — Calendar (user request)
- CAL-1: [DONE — iteration_51] Chronological day event ordering. `/api/calendar` now sorts by `(date, HH:MM)`; schedule items carry `time` from `start_time`; all-day (no-time) items sort first, then timed ascending. Day/Week lists consume the sorted feed.
- CAL-2: [DONE — iteration_51] Add Competition / Schedule event from the Calendar tab. Header "+" (testID cal-add) opens a chooser sheet → routes to `/competitions/new?date=<sel>` or `/schedule/new?date=<sel>`, both prefilling the selected day.

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

## Session update 4 (Team Hub — sign-ups + access delegation)
- DONE: Sign-Up Sheet slot types — slots now have a `kind` (item | duty | time) with an optional `time_label` for time slots. Add/Edit slot modals show a Type selector; time field appears only for time slots. Backend models + /api/team/signups/{id}/slots endpoints + export utility (SheetJS xlsx) support the new fields. Verified iteration_61 (7/7 backend, frontend all flows).
- DONE: Team Hub access delegation — replaced the per-login "I'm team personnel" self-toggle with OWNER-controlled delegation. Household now has owner_user_id (backfilled to first member for legacy households). Only the owner can grant/revoke team_access per household member and invite people by email (code-based invite with grant_team_access; /household/join honors it). New router routers/team_access.py (GET /api/team-access, PATCH /members/{id}, POST /invite, DELETE /invite/{id}); new screen app/team-access.tsx; Settings row -> /team-access; Team tab copy updated. Verified iteration_62 (12/12 backend, frontend PASS).
- NOTE (roster data-flow, per user Q): Team Hub rosters are entered by personnel themselves (manual add or CSV/spreadsheet import). Roster members are NOT linked to parent app accounts; parents do NOT need the app.
- NEXT (P1): Upload spreadsheets into Team Hub tools (import roster/sizes/paperwork from a file).

## Session update 5 (Team Hub spreadsheet import + privacy)
- DONE: Spreadsheet upload into Team Hub — added 4 import kinds to the existing import framework: roster, team_sizes, team_paperwork, team_payments (CSV + Excel). Reuses /import/[kind] screen (template download -> pick file -> preview -> commit). Team kinds gated by team_access (403 otherwise). Sizes/paperwork/payments match people by name; unmatched -> auto-created roster members (warning). Roster import creates OR updates by name and auto-creates teams. Entry points: Roster 'Import from spreadsheet' button; Sizes/Paperwork/Payments header cloud-upload icons. Verified iter63 (27/27 backend, frontend PASS).
- DONE: Privacy Policy screen updated (settings/privacy.tsx) with Team Hub, uploaded-files, and sharing sections; last-updated July 21, 2026.

## Backlog — requested, NOT yet built
- SHARE-LINK (LARGE): Read-only/public shareable web link per sheet so parents fill their own info WITHOUT the app. Sign-ups: everyone sees everyone's entries. Roster & Sizes: each parent sees ONLY their own entry. Submissions AUTO-APPLY (coach can edit later). Confirmed by user.
- TEAM-MUSIC (later): Upload team music to share with the team.
- MASS-REMINDERS (later): Automated server-sent reminders to roster parents (needs Twilio + parent phone consent). Today only a manual 1-tap 'Text who owes' SMS composer exists for payments; account-holder SMS/email reminders exist for own deadlines.
- Access model: kept owner-explicit grant (no sub-roles). Athletes only get Team Hub if owner grants their login.

## Session update 6 (share links, payments/roster/schedule enhancements + keyboard bug)
- DONE: Public share links (iter64) — parents fill in Team Hub tools without the app via a server-rendered HTML page at /api/public/s/{token}. Sign-ups public (everyone sees claims, guest name-based); Roster & Sizes private per-parent. Auto-apply. In-app share buttons: signup-share, roster-share, sizes-share. New router share.py; util src/utils/shareLink.ts. SignupClaim gained guest_name. Verified 17/17 backend + browser.
- DONE: Payment tracker keyboard bug — Edit/New tracker modals wrapped in KeyboardAvoidingView so keypad no longer hides Save. (iter65)
- DONE: Payment trackers — exempt a member ('Not required to pay'); excluded_member_ids drop out of totals/owes. New PUT /api/team/payments/{id}/member/{mid}/exclude. (iter65)
- DONE: Roster bulk delete — 'Select' mode + checkboxes + POST /api/roster/bulk-delete. (iter65)
- DONE: Schedule recurring edit/delete now offers This event only / This and all future events / All events in series (new scope=future). Start/end date & time editable. (iter65)

## Backlog — requested, NOT yet built
- TEAM-MUSIC (later): Upload team music to share with the team.
- MASS-REMINDERS (later): Automated server-sent reminders to roster parents (needs Twilio + parent phone consent). Manual 1-tap 'Text who owes' exists for payments.
- Known RN-Web limitation: Alert.alert confirmations (bulk-delete, non-series schedule delete) don't fire on web preview but work on native iOS/Android.

## Session update 7 (Phase 1 of big batch + reminder bug fix)
- BUG FIX: Payment reminder texts now go to EACH owing person individually via Twilio (was only reaching the 1st). New POST /api/team/payments/{id}/remind uses core/sms.send_sms per member (athletes -> parent phone). Twilio already configured in .env. Verified iter66 (no real texts sent in test).
- DONE: Roster page decluttered — 3 stacked buttons moved into a ⋯ actions menu (roster-actions). Added Roster DOWNLOAD (CSV + Excel) via exportAoa. Fixed squished team-filter chips.
- DONE: Public share pages restyled to app blue palette (#007CFF).
- DONE: Public sign-up page 'Your name' is now a dropdown of roster names + 'Other (type name)'.
- DONE: Fully signed-up slots sink to the bottom (in-app AND public page).

## REMAINING from the big batch (build next, in order)
Phase 1 leftover:
- Duplicate sign-up sheets & Team Hub spreadsheets (paperwork, payments).
- Reorder the sign-up sheets list (manual order).
Phase 2:
- Payment 'amount due': tracker-level default + PER-MEMBER custom amount due; show Due / Paid / Balance. (user: enable both)
- Attendance check-off tool.
- Link schedule events <-> sign-up sheets.
- To-do lists (Team Hub + attached to competitions & events).
Phase 3:
- Expanded roster fields (preferred name, sizes, contact, food/other allergies, medical, host-bonding opt-in) + custom columns.
- Block a granted user from a specific spreadsheet (per-item, per-user hiding).

## Session update 8 (Phase 1+2+3 batch + iter68/69)
- DONE (iter68): To-Do Lists verified (Team Hub /team/todos, Competition + Schedule event scopes). Backend GET/POST/PATCH/DELETE /api/todos.
- DONE (iter68): Reorder sign-up sheets — swap-vertical toggle + up/down chevrons; POST /api/team/signups/reorder; new sheets float to top (order=min-1); SignupSheet gained order + event_id.
- DONE (iter68): Attendance tool — /team/attendance (list+create) & /team/attendance-session (roster grid: present/absent/excused, mark-all-present, team filter). Backend routers/attendance.py; AttendanceSession model. iter69: sessions are now EDITABLE (title+date) via PATCH /api/team/attendance/{id}.
- DONE (iter68): Link schedule events <-> sign-up sheets — EventSignups component on schedule event edit screen; GET /api/team/signups?event_id filters; creates sheets with event_id.
- DONE (iter68): Expanded roster fields (preferred_name, food_allergies, other_allergies, medical_concerns, host_bonding_opt_in) + custom columns (roster_columns collection; /api/roster/columns CRUD; member.custom map).
- DONE (iter68): Block a granted user from a specific sheet — routers/blocks.py (GET /api/team/blocks/{resource}/{resource_id}, PUT /api/team/blocks?blocked=). sheet_blocks collection. Filters payment/paperwork/signup/attendance lists + 403 on get. Owner-only UI via SheetAccessButton (hidden for solo owners via useCanManageAccess).
- DONE (iter69): Sizes on the in-app roster Add/Edit screen (inputs per size column, saved via NEW atomic PUT /api/team/sizes/values) AND on the public roster share link (parents fill roster info + sizes together). Fixed a HIGH race bug where per-column concurrent PUTs dropped values — replaced with a single batched write.

## Session update 9 (multi-select filters, calendar type filter, multi-attach)
- DONE: Multi-select filters everywhere (Schedule type/athlete/team, Expenses athlete/team/category, Competitions athlete/team, Roster team) via a multi-select `FilterChipRow` (selectedIds[]/onToggle/onClear, optional hideAll) + `src/utils/filters.ts`.
- DONE: Calendar 'Event types' multi-select filter (built-in + user custom types); backend /api/calendar schedule items now carry `event_type`.
- DONE: Payment trackers, Sign-up sheets, Attendance sessions can attach to MULTIPLE competitions + events (competition_ids[]/event_ids[]). Both directions: `AttachSection` on each tool's edit screen; `LinkedTools` at the bottom of Competition detail + Schedule event screens (attach/detach/open). Sizes intentionally excluded. Old single links migrated to arrays.
- DONE: 'Upload sizes from spreadsheet (CSV/Excel)' added to Roster ⋯ menu (routes to existing /import/team_sizes).
- app.json version bumped to 1.1.9 (was stuck at 1.1.2 causing App Store Connect to show 1.1.2).

## Backlog — Companion website (cheer-planner.com)
User owns cheer-planner.com (Squarespace DNS), currently a Google Sites landing page. Decision: REPLACE
Google Sites with our marketing homepage + full web app on cheer-planner.com. COMPLIANCE: privacy policy,
contact-us, AND SMS/text-messaging consent pages MUST stay at their EXACT current URLs (Apple + Twilio A2P).
Get exact current paths from user before building W2.
- W1 (DONE): Desktop-responsive web app. app/(tabs)/_layout.tsx now renders a persistent left sidebar
  (src/components/WebSidebar.tsx) on wide web (Platform.OS==='web' && width>=900) and hides the bottom tab bar;
  content capped at maxWidth 1400. Mobile/native unchanged (bottom tabs). Sidebar: Home/Athletes/Expenses/
  Competitions/Schedule/Calendar/Team Hub + Reminders/Settings + Plan chip + user. Verified at 1280px.
- W2 (DONE): Public marketing homepage + legal pages replacing Google Sites.
  * app/index.tsx: logged-out WEB visitors see src/components/MarketingHome.tsx (hero, 6 feature cards,
    CTAs sign up / App Store, redeem link, footer). Native → /login; logged-in → /(tabs)/dashboard.
  * Public routes (no auth): /privacy (VERBATIM match), /text-messaging-opt-in (REBUILT VERBATIM from the
    user-provided live HTML: brand header, "How opt-in is collected", in-app phone mockup with toggle +
    disclosure, exact consent blockquote, message types/frequency + sample, opt-out, privacy link), /contact.
  * Shared src/components/StaticPage.tsx (StaticPage/LegalSection/P). Root _layout has NO auth guard so public
    pages load without login. Verified /privacy + marketing home render publicly at wide width.
  * DEPLOY NOTE: point BOTH apex (cheer-planner.com) and www at the deployment so /privacy & /text-messaging-opt-in
    resolve (Apple + Twilio A2P compliance URLs).
- W3 (DONE — iter74): True real-time sync via authenticated WebSockets. Backend broadcasts an
  `invalidate` event to household rooms after every successful mutating HTTP request
  (core/realtime.py ConnectionManager + rooms_for_user; routers/realtime.py WS /api/ws?token=;
  server.py http middleware, excludes /api/ws,/webhooks,/analytics,/auth). Frontend
  src/context/RealtimeContext.tsx (RealtimeProvider in app/_layout.tsx) connects on login,
  auto-reconnects (backoff + AppState foreground), bumps a `rev` counter per invalidate; hook
  useRealtimeRefetch(load) re-runs a screen's loader when rev changes AND the screen is focused.
  Wired into 15 screens: dashboard, expenses, athletes, competitions, schedule, calendar,
  reminders, roster, team payments, sizes, paperwork, signups, attendance, household, fundraisers.
  Verified: WS connects on login; a mutation in session B live-updated session A's focused Home
  widget ($240→$282) with no manual refresh; no RealtimeContext console errors.

## Backlog — Monetization (pending user decisions)
- Free vs Premium tiers via RevenueCat + Apple/Google IAP. APPROVED plan in /app/memory/MONETIZATION_PLAN.md.
- User approvals (locked): Free Team Hub split as proposed; Lifetime ownership = Option C; grandfathering =
  keep-all-members-block-new-adds; admin = in-app first (web portal Phase 3).

### Phase 0 — Entitlement foundation (DONE, invisible/safe)
- `core/plans.py` — PLAN_LIMITS (free household_members=2 / premium=6, Team Hub Free caps), PRICING display
  metadata ($4.99/mo, $39.99/yr+7d trial), PREMIUM_TEAM_HUB_FEATURES set. Config-driven (change limits w/o redesign).
- `core/entitlements.py` — `resolve_household_premium(household_id)` (Lifetime > active Sub > Promo > Free),
  `get_household_premium(user_id)`, append-only `log_entitlement_event(...)` audit helper.
- Collections: `entitlements`, `entitlement_events` (+ startup indexes in server.py). Models: Entitlement, PremiumStatus.
- API: `GET /api/entitlements/me` (household premium status), `GET /api/entitlements/config` (limits + pricing).
- Everyone resolves to Free (no entitlement docs yet); NOTHING gated. Verified: Free default, lifetime→Premium,
  expired sub→Free. No user-visible change, no data migration needed (Free is the default).

### Phase 1 — IN PROGRESS
- 1a DONE: Household ↔ Team Hub decoupling. `Household.team_hub_member_user_ids[]` (separate from
  member_user_ids). Team Hub invites now add collaborators there (NOT household seats). New helper
  `_team_hub_scope_user_ids` (aliased into roster/attendance/team_payments/sizes/paperwork/signups/todos —
  backward-compatible; identical output when no collaborators). team_access.py exposes/removes collaborators.
  auth delete cleans collaborator refs + entitlements. Verified: roster + team-access still work.
- 1b DONE: Admin system. `users.is_admin` seeded from `ADMIN_EMAILS` (cheerplanner@gmail.com) at startup.
  `require_admin` guard + `code_hash` (sha256+REDEMPTION_PEPPER). routers/admin.py: users/search (+premium
  status), users/{id}/entitlements, lifetime/grant, lifetime/revoke, codes/generate (plaintext once, stored
  hashed+last4), codes list, codes disable/enable, self-premium-toggle (test). Frontend app/admin/index.tsx.
  Verified: admin gating (403 non-admin), generate, race-safe single-use redeem (200/400), search, revoke.
- 1c DONE: routers/premium.py — GET /premium/status, POST /premium/redeem (rate-limited 5/min, atomic
  find_one_and_update, expiry-in-filter, generic errors). Web redemption portal app/redeem.tsx (web only).
  Plan status/paywall app/premium.tsx (Free→pricing $4.99/$39.99+7d trial+computed SAVE%, Lifetime→no
  renewal, Sub→manage link). Settings "Membership" section (Plan row + Admin row if is_admin). Verified UI render.
- 1d DONE (tested iter73, 30/30): core/gating.py (assert_premium 402 "premium_required:<f>", assert_under_count
  402 "limit_reached:<key>"). Gated: sizes (columns/values), paperwork (create/duplicate), team_payments
  (create/duplicate/remind=mass_sms), roster custom columns, spreadsheet import (team kinds, preview+commit),
  parent share links, signup sheets (>1 free), attendance sessions (>1 free), roster athletes (>36) + personnel
  (>4). Reads NOT gated (free users still see existing data). Frontend: axios 402 interceptor → Alert → /premium;
  Team Hub landing shows PREMIUM badge + lock on payments/sizes/paperwork/export for Free (tap → /premium).
  Household member-limit enforcement INTENTIONALLY DEFERRED (user: enforce at go-live). Review account
  applereview granted Lifetime (admin_grant "Apple App Review") so App Review sees full app.
  KNOWN minor (non-blocking, from testing): get_household_premium does a lazy rebind write per call (cheap);
  spreadsheet_export flag has no backend gate yet (frontend blocks via /premium) — wire when export backend lands.

### Phase 2 — RevenueCat + Apple IAP (CODE DONE, needs keys + native build to function)
- Backend: routers/revenuecat_webhook.py POST /api/webhooks/revenuecat (Authorization shared-secret verify,
  idempotent via rc_processed_events, maps app_user_id→user→household). Event rules: INITIAL_PURCHASE/RENEWAL/
  UNCANCELLATION/PRODUCT_CHANGE→active, BILLING_ISSUE→grace, CANCELLATION→no-op(keep till expiry),
  EXPIRATION→revoke. entitlements.apply_subscription_event upserts one household-bound `subscription`
  entitlement (source=apple). plans.PRODUCT_PLAN_MAP (monthly/annual). config.REVENUECAT_WEBHOOK_AUTH.
  Verified via simulated events (auth 401, purchase→annual active, idempotent replay, cancel keeps, expire revokes).
- Client: react-native-purchases + expo-dev-client installed. src/lib/revenuecat.ts (guarded: purchasesSupported
  = native && !ExpoGo && key; lazy require so web/Expo Go never load native module). AuthContext logIn/logOut set
  appUserID=user_id. premium.tsx paywall loads live offerings/prices, buy monthly/annual, Restore Purchases;
  Lifetime users see redundant-store-sub notice (status.has_store_subscription).
- ENV placeholders: frontend EXPO_PUBLIC_REVENUECAT_IOS_SDK_KEY (public), backend REVENUECAT_WEBHOOK_AUTH.
- SETUP GUIDE: /app/memory/REVENUECAT_SETUP.md. NEEDS FROM USER: RC iOS public SDK key + webhook secret;
  App Store Connect products (cheerplanner_premium_monthly/annual, same group, 7-day trial on annual).
  Purchase flow CANNOT be tested in Expo Go/web — requires TestFlight/native build.

### Phase 3 — Analytics (DONE), Google Play/promos/web admin portal (FUTURE)
- Analytics (privacy-conscious, DONE): routers/analytics.py POST /api/analytics/event (allowlisted event names
  + allowlisted prop keys only {plan,feature,platform,source} — drops any PII), GET /api/analytics/summary
  (admin: event counts, feature_gate_hits by feature, plan split, premium_households, lifetime/subs active,
  codes_redeemed). Client src/lib/analytics.ts track() fire-and-forget. Events fired: paywall_view + upgrade_tap
  + plan_selected + purchase_success (premium.tsx), feature_gate_hit (client.ts 402 interceptor, with feature),
  code_redeemed (redeem.tsx). Admin screen shows analytics snapshot. Verified: event insert, PII rejection,
  admin summary 200.
- FUTURE: Google Play billing, promotional offers, web admin portal, trial_start/trial_to_paid (needs store data).
### Phase 2 — RevenueCat + Apple IAP + TestFlight.  ### Phase 3 — analytics, Google Play, promos, web admin portal.

## Session update 12 (Seasons → Team Hub tools)
- DONE (iter81, backend 24/24 + frontend PASS): **SeasonBar extended to all Team Hub tools + season-scoped data.** Choice 1a — a roster member's season is DERIVED from their team's season (`roster_season_query` in core/helpers): member shows in a season if any of their teams is in that season OR they have no team (unassigned always shows). `GET /api/roster` accepts `?season_id=`. Added `season_ids` to `PaymentTracker`/`PaperworkSheet`/`SignupSheet`/`AttendanceSession`; sheets stamped with the active season on create and filtered via `season_query` (legacy/no-season sheets always visible). List endpoints `/api/team/{payments|paperwork|signups|attendance}` accept `?season_id=`; summary `member_total` scoped to the season's roster; `/remind` endpoints only text in-season members. Detail responses now include `season_ids`. Frontend: `<SeasonBar/>` on roster/payments/paperwork/signups/attendance/sizes (passes `filterSeasonId`); detail screens (payment/paperwork-sheet/signup-sheet/attendance-session) fetch the sheet first then load roster scoped to the sheet's season so member rows match the summary. Sizes grid follows the season-filtered roster.

## Session update 13 (Team Music surfaced everywhere + misc UX)
- DONE: **Tardy attendance status** — 4th status (P/T/A/E) on the mark screen + "N tardy" pill and summary count on the session list. Backend `AttendanceMarkPayload` + `_summary` updated.
- DONE: **Bottom-sheet overflow fixes** — Sizes "Size tally", Paperwork "Completion" tally, and the Packing-list Template picker now cap sheet height and flex-scroll (lower options reachable).
- DONE: **Multi-select template delete** — Manage templates mode has per-row checkboxes, Select all/Clear all, and a "Delete N" bar (bulk delete via parallel DELETEs); per-row rename/single-delete retained.
- DONE: **Team Music surfaced outside the Music tab** — new reusable `src/components/AttachedMusic.tsx` (inline play/pause mini-player + attach/detach picker). Embedded inside `LinkedTools` so it shows in "Attached Team Hub tools" on competition + schedule-event detail; and added to the Team edit modal (team_ids). Backend: added `event_ids` to `TeamTrack`/`TeamTrackInit`/`TeamTrackUpdate` and `event_id` filter to `GET /api/team/music`. Verified live on competition + team surfaces (render, attach picker, unlink). Audio decode itself already proven in the Music tab.

## Session update 14 (Roster text broadcast + hide sheets from a person)
- DONE (iter82, backend 19/19 + frontend PASS): **Personalized text broadcast to the roster.** New `routers/broadcast.py`: `POST /api/team/broadcast/send` (dry_run supported for a safe preview) texts one message per PARENT (parent_phone + "Hi <parent_first_name>,"), falling back to member phone/first_name for staff; dedupes by phone; recipient modes all/team/members. Attach **links** (ExternalLink), **Team Music** tracks, and **photo attachments** — music/attachments delivered as public no-login links via `public_media` docs served at `GET /api/public/media/{token}` (HTML player/image) + `/raw` (Range/206). `POST /api/team/broadcast/attachment` uploads a photo (≤6MB) to the `broadcast_media` GridFS bucket. New screen `app/team/broadcast.tsx` (compose + Review&send dry-run confirm) reachable from Roster ⋯ menu → "Message parents (text)". ⚠️ Twilio LIVE — only dry_run used in tests.
- DONE: **Hide a sheet from a Team Hub person.** Surfaced the existing `routers/blocks.py` via new `src/components/ManageAccessButton.tsx` (owner-only people icon) on the payment/signup/paperwork/attendance detail screens — toggles per-member Hidden/Visible; blocked members no longer see that tracker/sheet in their lists. Hardened PUT /api/team/blocks to reject blocking the owner. (Renders null when the household has no other members.)
- Follow-up: to fully verify "blocked viewer can't see it", invite a 2nd Team Hub member (household was solo in test).

## Session update 18 (Team Forms + roadmap "In Development")
- DONE (iter86, backend 10/10 + frontend PASS): **Custom Team Forms** — new Team Hub tool (`routers/team_forms.py`, `app/team/forms.tsx` + `form-detail.tsx`, card in `app/(tabs)/team.tsx`).
  - Coaches build named forms with typed questions: single-choice, multi-select, yes/no, number, short text, paragraph. Questions edited in the detail screen (add/edit/delete; options for choice/multi; required toggle).
  - **Lock Form** toggle freezes submissions & edits — enforced on coach upsert AND public submit (HTTP 400 when locked).
  - **Coach fills responses in-app** per member (one-tap chips for choice/yesno/multi); parents fill via **public share link** (`share.py` kind="form", pre-filled with prior answers, no app) or get the link via **SMS** (`POST /api/team/forms/{id}/remind`, texts non-responders).
  - **Real-time tally** mirrors the Sizes tally: choice/yesno/multi → value+count rows, number → total/avg, text/paragraph → answer list; plus a per-member response list with green-check status. Season-scoped (SeasonBar) + hide-from-member via `ManageAccessButton resource="form"`. Forms attachable to competitions/events (competition_ids/event_ids). Collections `team_forms` + `team_form_responses` (startup indexes).
- DONE: Roadmap — added **Custom Team Forms** as an **In Development** item; renamed the roadmap `in_progress` status label from "In progress" → "In Development" everywhere (badge + filter chip). Also added planned items Website Companion (In Development) + In-App Team Chat (Planned) earlier.

- DONE (iter85, backend 17/17 + frontend PASS): Extended the community roadmap (`routers/roadmap.py`, `app/settings/roadmap.tsx`):
  - **Notify on Ship** — when an admin PATCHes an item's status to `completed`, `_notify_shipped` writes a `roadmap_notifications` doc for every upvoter. `GET /api/roadmap/notifications` (unseen) + `POST /api/roadmap/notifications/seen`; screen shows a dismissible "It shipped! 🎉" banner.
  - **Comment Threads** — `roadmap_comments` collection; `GET/POST /api/roadmap/{id}/comments`, `DELETE /api/roadmap/comments/{cid}` (author or admin). `comment_count` returned per item; card has a 💬 chip opening a comments modal.
  - **Sort & Filter** — Community Suggestions sort toggle Most-voted/Newest; Planned Features status filter chips All/In progress/Planned/Shipped (client-side).
  - **Merge Duplicates (admin)** — `POST /api/roadmap/{target}/merge {source_id}`: combines votes (de-duped per user), moves comments, recomputes target upvotes from vote rows, deletes source. Admin "Merge" chip → picker of other suggestions.
  - Added planned items **Website Companion** (in_progress) and **In-App Team Chat** (planned). Startup indexes added for roadmap_comments + roadmap_notifications.

- DONE (iter84, backend 16/16 + frontend PASS): **Settings → "Suggest a Feature" section** → row "Feature Roadmap & Voting" opens `/app/frontend/app/settings/roadmap.tsx`. Community roadmap with: **Planned Features** (admin-managed, status badges In progress/Planned/Shipped), **Community Suggestions** (any user types + submits an idea; author auto-upvotes), and an **Upvote button on every item** (toggle, count persisted). Backend `routers/roadmap.py`: `GET /api/roadmap` (planned+suggestions+is_admin, each with upvotes + voted), `POST /api/roadmap/suggestions`, `POST /api/roadmap/{id}/vote` (toggle, one vote/user via unique index roadmap_votes[item_id,user_id]); admin-only `POST /api/roadmap/planned`, `PATCH`/`DELETE /api/roadmap/{id}`. Admins see a header "+" (add planned) and per-item Status-cycle/Delete chips; non-admins don't. Collections `roadmap_items` + `roadmap_votes` (startup indexes in server.py). So the operator can track most-popular requests by upvote count.

- FIX: Roster row "Text"/call now sanitizes the phone (strips spaces/parens/dashes, keeps leading +) so the native Messages/dialer opens reliably; added a body-less sms: fallback. openMemberCall added for the call chip. (Device/Expo Go only — not testable on web preview.)
- DONE: **Delivery summary** — POST /api/team/broadcast/send now returns failed_recipients[{name,phone}] + no_phone list; composer shows a Delivery Summary modal (Sent/Failed/No-phone counts + names) after sending.
- DONE: **Saved message templates** — broadcast_templates collection + GET/POST/DELETE /api/team/broadcast/templates; composer has Templates (load/delete) and Save actions.
- DONE: **Broadcast history** — GET /api/team/broadcast/history; new screen app/team/broadcast-history.tsx (reachable from composer header clock icon) lists past texts with sent/failed pills and an expandable Failed / No-phone breakdown.
- Verified: authenticated CRUD of templates + history + dry_run send all 200; UI screenshots confirm composer templates modal, template load, history list + expanded detail. Twilio NOT triggered (dry_run only).

## Session update 19 (Bug fix: event photos wouldn't save + version 2.0.0 + demo account)
- FIXED: Adding a photo to an event (or any PhotoGallery entity) failed on the LIVE app with a long spinner + "Could not save". Root cause: photos were stored as FULL-RESOLUTION base64 inline (no resize, quality 0.5), producing multi-MB request bodies that exceed the production ingress body-size limit (preview accepts 5MB so it didn't repro there). Fix in `src/components/PhotoGallery.tsx`: pick without base64, then `expo-image-manipulator` resizes the longest edge to <=1280px + recompresses JPEG q0.5 to base64 (~150-250KB each). Applies to events, competitions, payments, paperwork, sign-ups, fundraisers. Added dep expo-image-manipulator@14.0.8. REQUIRES REDEPLOY to reach the live app.
- App version bumped to 2.0.0 (iOS build 114, Android versionCode 2) in app.json.
- Team Forms deadline "Clear" fixed (send "" not null).
- Marketing/demo account `demo@cheerplanner.app` / `CheerDemo2026!` (Free plan, Blue & White "cheerplanner" theme) seeded via scripts/seed_marketing_demo.py for clean App Store screenshots.

## Session update 20 (Twilio webhook path correction + Restore Purchases)
- CLARIFIED (no code change): The Twilio inbound/status webhook paths are `/api/twilio/inbound` and `/api/twilio/status` (router prefix "/api" + "/twilio/..."), NOT `/api/webhooks/twilio/...` as the earlier handoff summary stated. Verified 200/204 on BOTH preview and production (https://spirit-finance-2.emergent.host). User's replies weren't arriving because Twilio was pointed at the wrong `/webhooks/` path. Production domain = https://spirit-finance-2.emergent.host.
- Restore Purchases now always shows on the Membership/paywall screen on iOS/Android even during the free launch period (app/premium.tsx), gated by purchasesSupported (native only) — for App Store compliance.
- Reminder to user: they exposed their production Mongo Atlas string in chat; advised to email support@emergent.sh to rotate it.

## Session update 21 (Roster: multiple caretakers + Adult Athlete + Date of Birth)
- DONE (iter88, backend 7/7 + frontend PASS): Roster athletes now support richer contacts.
  - **Model** (core/models.py): new `Caretaker` model {first_name,last_name,relationship,phone,email,include_in_texts}. RosterMember/Create/Update gained `caretakers[]`, `dob` (MM/DD/YYYY text), `adult_athlete` (bool), `parent_relationship`, `parent_include_in_texts` (bool, default True). Primary caretaker stays in legacy `parent_*` fields; additional caretakers (max 3) go in `caretakers[]`.
  - **Broadcast** (routers/broadcast.py `_resolve_context`): per athlete, texts every opted-in caretaker (primary via parent_include_in_texts + each caretaker via include_in_texts) PLUS the athlete's own phone when `adult_athlete` is on. Phones normalized + deduped. Non-athletes still text their own phone.
  - **Public share link** (routers/share.py): roster_member GET `/data` returns the new fields; `/submit` persists caretakers[], dob, adult_athlete, parent_relationship, parent_include_in_texts. Public HTML form (_JS_ROSTER) has DOB, Adult Athlete checkbox, Caretaker 1 relationship dropdown + include-in-texts, and dynamic "+ Add another caretaker" (max 3 more).
  - **Roster form** (roster-new.tsx): DOB input, Adult Athlete Switch (reveals athlete phone input), Caretaker 1 with relationship chips + include-in-texts Switch, add/remove caretaker cards (max 3 additional).
  - **List + Exports**: roster.tsx card shows DOB / relationship / "+N more caretakers" / "Adult athlete"; CSV/XLSX (roster.tsx + team/export.tsx) include DOB, Parent Relationship, Other Caretakers columns.
- Note (no code change): "Hide tracker from personnel" already works — it only lists personnel that exist in the Team Hub; user simply hadn't added personnel yet.

## Session update 22 (Apple paywall compliance + transparent logo)
- Logo: removed white background from assets/images/cheerplanner-logo.png (now RGBA/transparent via edge-connected flood fill; original backed up at /app/cheerplanner-logo.orig.bak.png).
- Paywall (app/premium.tsx) Apple compliance — per user choice 1b, non-premium users ALWAYS see the real plans regardless of monetizationActive (free-launch shown as a banner above). Required elements now on-screen: Subscription Titles ("CheerPlanner Premium — Annual/Monthly"), Price & Duration ("$39.99 / year", "$4.99 / month" + "Auto-renews yearly/monthly"), Legal Links (Terms of Use (EULA) → https://www.apple.com/legal/internet-services/itunes/dev/stdeula/ , Privacy Policy → /privacy), auto-renew disclosure text, and Restore Purchases (native builds only via purchasesSupported). Prices confirmed correct as-is. Verified on demo@cheerplanner.app. Needs redeploy to reach TestFlight/App Store build.

## Session update 23 (Team Forms links/photos + Music-on-calendar + per-event SMS reminders)
- DONE (iter89, backend 4/4 + frontend PASS):
  A) Team Forms attachments: FormCreate/FormUpdate gained `links[]` (ExternalLink); `photos[]` already existed. team_forms create/update/duplicate persist links; public share `/data` for a form now returns photos[]+links[]; public _JS_FORM renders photos as <img> and links as anchors. form-detail.tsx has a "Photos & links" editor (PhotoGallery + LinksEditor + Save button testID form-attach-save).
  B) Music on calendar: calendar.py builds music_comp_ids/music_event_ids from db.team_music (scope=_team_hub_scope_user_ids, status ready) and sets `has_music` on competition + schedule items. calendar.tsx shows a musical-notes badge on cards (testID event-music-<id>), an amber (#F59E0B) dot on the month grid, and a '🎵 Music' legend entry.
  C) Per-event SMS reminders: added `event_reminder_offsets: List[int]` to Competition(+Create/Update) and ScheduleEvent(+Create/Update); schedule create normalizes None->[]. scheduler.py timed-SMS tick now fires event-date reminders for competitions (event_date+event_time) and schedule events (date+start_time) at offsets, to the owner's sms_phone (requires sms_enabled), deduped via keys comp/sched:...:event_reminder:<off>. Allowed offsets {60,30,15,1}. UI: SmsReminderPicker added to competitions/new ("Text me before this competition", prefix comp-event-sms-offset) and schedule/new ("Text me before this event", prefix schedule-event-sms-offset).
- Recipient decision: reminders go to the account owner's saved SMS reminder number (not whole team). Can expand to team later if requested.

## Session update 24 (Team Hub switcher + active-hub scoping)
- DONE (iter90, backend 18/18 + frontend verified): Coaches invited to multiple TEAMS (hubs) can switch between them.
  - Concept: a "hub" = a team, represented by the rep/manager's household; coaches are collaborators (team_hub_member_user_ids). Hub display name is owner-editable (Household.hub_name; fallback "<Owner first name>'s Team").
  - Per-user active hub: users.active_hub_id (plain field on user doc; no User model). Drives ALL Team Hub scoping.
  - core/helpers.py: added _accessible_hubs, _resolve_active_household, _hub_owner_id; REWROTE _team_hub_scope_user_ids to scope to the ACTIVE hub's household members + owner ONLY (collaborators are authorised to view but do NOT own hub data — prevents cross-hub bleed). This replaced the old find_one-picks-first behaviour.
  - Create-anchoring: every Team Hub create now stamps user_id = active hub owner (via _hub_owner_id) across roster, sizes, paperwork, team_forms, signups, attendance, todos, music, team_payments, broadcast (+ scheduled/templates/messages). Ensures data created by a coach lands in the correct hub and stays isolated.
  - New router routers/hubs.py (prefix /api/team/hubs): GET (list), POST /active {hub_id} (403 if not a member), PATCH /{hub_id} {name} (owner-only rename). Registered in server.py.
  - Frontend: src/components/TeamHubSwitcher.tsx (pill testID team-hub-switcher + bottom-sheet with radio switch + owner rename) mounted at top of app/(tabs)/team.tsx. Switching persists server-side; other hub screens reflect the active hub on next focus (scope is server-side).
  - Verified via API: switching active hub shows only that hub's roster and hides the other's; creates anchor to hub owner. Regression: all Team Hub tools load/CRUD fine for single-hub owner.

---

## BACKLOG (requested "for later" — not yet built)

### Backlog A: Household Privacy Controls (per-member) — ✅ DONE (iter92)
- Per-member visibility toggles for **Expenses/Payments** and **Travel/Bookings** only (confirmed scope).
- Per-member (each household member configured individually), NOT a kids/adults mode.
- Enforce in UI AND at backend/API so hidden data is truly private.
- Route through auth/integration playbook (access-control change). Medium feature.

### Backlog B: Community Reviews of Cheer-Friendly Places (global, cross-account) — ✅ DONE (iter93)
- GLOBAL shared data (like Community Roadmap): a reviewer in Dallas posts; a user in California sees it, independent of households/accounts.
- Submit a place: name, city/location, category, 1–5 star rating, written review. Show rolled-up average rating per place.
- Browse/filter by city + category so users find spots near a competition.
- Safeguards: one rating per user per place (editable), report/flag for moderation. Medium feature.
- Reviewer identity (user choice per review): **Anonymous** OR **First name + Last initial**.
- Categories (seed list): Restaurants/Eateries, Coffee Shops, Hotels/Lodging, Things to Do, Gyms/Practice Facilities, Shopping/Malls, Hair & Makeup Artists, Hairpieces, Makeup (lipstick/blush/foundation/etc), Training Programs, Competitions, Other.
- Users may ADD categories; ADMIN can then reorganize. Mirror Roadmap admin powers: admin can ADD categories AND COMBINE/merge duplicate places (same merge UX as the Community Roadmap).

---

## BACKLOG (Seasons follow-ups — requested "to do later", iter97)
- **Carry More Forward**: Extend rollover to also copy staff/personnel, packing-list templates, and Team Form + sign-up-sheet STRUCTURES (definitions only, not submissions/responses) into the new season.
- **Unassigned Group**: In any season-filtered list view, show out-of-range (no matching season) records under a tidy "Unassigned" section with a hint to extend a season's dates or tag manually. (Currently these only surface under "All seasons".)
- **Lock Past Seasons**: Make a non-active/historical season a TRUE read-only view (hard-block create/edit/delete on its records), beyond the current visual banner signal.
- **Season Header Chip**: Add the active-season indicator to the app header for one-tap switching from anywhere (not just the per-screen SeasonBar).

## Session update 19 (Team Chat — Named Channels, verified iter103)
- DONE (backend 7/7 + frontend PASS): **Named Channels (multiple named chats per team).**
  - Backend `routers/team_chat.py`: `GET/POST /api/team/chat/channels`, `GET/POST /api/team/chat/channels/{cid}/messages`. `chat_channels` collection {id, household_id, name, kind(team|athlete), member_user_ids[], created_by, family_view, created_at}. Team admins (team_access) see ALL channels (oversight); members see channels they're in; family members see athlete channels (family_view). Creator is always added; channels including a minor athlete auto-set kind='athlete' + family_view=true. Channel↔main-thread isolation via `channel_id` (main thread filters channel_id:None; channels filter channel_id:cid). `_channel_or_403` → 404 (wrong hub), 403 (post by non-member/non-admin).
  - **Policy change (user-confirmed):** regular PARENTS (plain household members, not personnel) now ALSO join the main team thread AND can create/join channels. `require_chat_access` allows household members after the athlete-approval gate; `_chat_hub` resolves parents to their active/shared household. `supervised` flag now derived from `chat_athlete_user_ids` membership (parents are NOT flagged supervised). Minor-athlete chat still gated on guardian approval, group-only, no DMs.
  - Frontend `app/team/chat.tsx`: header is a channel switcher (chat-channel-switcher) → channels modal (chat-channels-modal) listing main thread (chat-channel-main) + all channels + "＋ New chat" (chat-new-channel); new-chat modal (chat-new-name + member checkboxes + chat-create-channel) creates & auto-switches into the channel. Thread is channel-aware (msgBase), reloads on channel change; "Seen by N" shown on main thread only (receipts are hub-wide).
  - Test updated: `test_team_chat.py` — a fresh non-personnel login now sees its OWN empty hub (200, []) instead of 403 (old "personnel-only" gate), per the new parents-in-chat policy. New `tests/test_team_chat_named_channels_ext.py` (4 cases).

## Session update 20 (Team Hub — Join Code + Pending Members + Role Assignment)
- NEW feature (backend verified, tests/test_team_members_flow.py PASS):
  - **One reusable team join code** per hub (`households.team_join_code`). Owner-only: `GET /api/team/join-code`, `POST /api/team/join-code/rotate`. Existing household/athlete invite flows UNCHANGED.
  - **Join**: `POST /api/team/join {code}` (any user) → creates `team_members` doc (status="pending", role=null) + a `team_join_notifications` doc for the owner. Rejects owner/existing personnel/dupes.
  - **Pending members get GROUP-CHAT-ONLY**: chat access wired via `team_members` in `team_chat.py` `_chat_hub` (resolves joiner to the team hub), `_participant_users`, and media auth. All other Team Hub tools stay `require_team_access` → 403 for pending members.
  - **Owner queue + badge**: `GET /api/team/members` (pending+active w/ names, roles, linked athlete), `GET /api/team/members/pending-count` → {count, is_owner} for the Team-tab badge. `GET /api/team/members/athletes` for parent-linking.
  - **Role assignment** `POST /api/team/members/{uid}/assign-role {role, athlete_roster_id?, athlete_name?}`:
    - coach/staff → `team_access=True` + `team_hub_member_user_ids` + roster entry (role) + active_hub_id set.
    - athlete → roster athlete (existing or new) + `athlete_chat_links` (chat_enabled) + `chat_athlete_user_ids`.
    - parent → linked as guardian (parent_email or caretaker) on an athlete's roster entry (existing or newly created).
    - Sets team_members.status="active"; marks join notification read.
  - **Remove** `POST /api/team/members/{uid}/remove` → deletes team_members doc, revokes team_hub/chat_athlete membership, drops team_access if no other hub.
  - Frontend: `app/team/members.tsx` (owner: code share/rotate, New Members queue, assign-role modal with role chips + athlete pick/new, active list, remove). `(tabs)/team.tsx`: owner "Members" tool card with pending badge; locked screen "Have a team code?" → join modal → POST /team/join.
  - Note: minors joining via the general team code get chat during the pending window (per explicit user decision that new joiners land in group chat). Existing athlete-invite approval gate is unchanged.

## Session update 21 (Chat: download media + schedule posts)
- **Download media**: any chat participant can save an image/video/audio attachment. `src/utils/chatMedia.ts#downloadChatMedia` (native: expo-file-system/legacy downloadAsync -> expo-sharing share sheet "Save Image/Save to Files"; web: anchor download). Download button added to every media type in `src/components/ChatMediaView.tsx` (testID chat-media-download).
- **Schedule posts (coaches/staff/reps/hub admins only = team_access/is_admin)**:
  - Backend `routers/team_chat.py`: `POST /api/team/chat/scheduled {text, media_id?, channel_id?, scheduled_at}` (future-time + guidelines + profanity + media/channel validation, `_poster_or_403`), `GET /api/team/chat/scheduled`, `DELETE /api/team/chat/scheduled/{id}` (creator or hub owner/admin). Collection `scheduled_messages` {status scheduled|sending|sent|canceled|error}.
  - Scheduler `core/scheduler.py#send_scheduled_chat_tick` (CronTrigger second=0): posts due messages into `team_messages` (with stored channel_id/media/mentions), marks sent, and broadcasts a realtime `invalidate` so clients refetch live. `realtime.rooms_for_user` now includes team_members so pending members get live updates.
  - Frontend `app/team/chat.tsx`: clock button in composer (canModerate only, testID chat-schedule) → schedule modal (chat-schedule-modal) with text + iOS compact / Android date+time DateTimePicker + preview; "N scheduled posts" pill (chat-scheduled-pill) → list modal (chat-scheduled-list) with cancel. Posts to the currently-open thread (main or active channel).
- Tests: tests/test_team_chat_scheduled.py PASS (schedule, past-time 400, non-coach 403, list/cancel, tick posts due). Download is share-sheet based (validated in earlier media tests; UI button added).

## Session update 22 (Parent → multiple children)
- Fix: a Parent can now be linked to MULTIPLE athletes in one role assignment. `POST /api/team/members/{uid}/assign-role` accepts `athlete_roster_ids: [..]` (+ optional `athlete_name` for a new child); the parent is set as a recognized guardian (parent_email or caretaker) on EACH child, so ParentGuard approval works for every child. team_members stores `athlete_roster_ids`; `/team/members` shows all linked child names. Frontend `app/team/members.tsx`: parent role now uses a MULTI-select (checkboxes) athlete picker (+ new-name field). Backward compatible with singular `athlete_roster_id`. Tests: tests/test_parent_multi_child.py PASS; test_team_members_flow.py still PASS.

## Session update 23 (Custom reminder text + broadcast scroll fix)
- Broadcast (Message parents) already supported custom text + saved templates + history/resend — confirmed, no change needed there.
- Form "Remind": now editable before sending. `POST /api/team/forms/{id}/remind` accepts optional `message`; body = "Hi {first}, {message} {link}" when provided (else default). Frontend `app/team/form-detail.tsx`: Remind opens a compose modal (form-remind-modal / form-remind-text / form-remind-send) prefilled with a default, so coaches can add context/due date. Verified via API (200).
- Broadcast scroll fix: `KeyboardAvoidingView` now has `keyboardVerticalOffset={88}` on iOS + `showsVerticalScrollIndicator`/`persistentScrollbar` and larger paddingBottom, so the Send button is reachable with the keyboard open and long messages.
- TODO/backlog: global "visible scrollbar on all pages" is a larger multi-screen sweep — only broadcast addressed so far.

## Session update 24 (SEC-003: public share link hardening)
- share.py `_get_link` now enforces a 30-day expiry (SHARE_LINK_TTL_DAYS) from created_at for BOTH /public/share/{token}/data and /submit (expired -> 404). Manual revoke already exists: DELETE /api/team/share/{link_id} (sets active=False).
- Public roster_member payload no longer exposes sensitive child data: dob, food_allergies, other_allergies, medical_concerns, and parent contact (parent_first/last/phone/email/relationship, caretakers) are returned blank. Non-sensitive fields (name, role, team, sizes) still returned; the public form starts blank for the removed fields and parents can still submit them. No other share behavior changed. Verified via API.

## Update (2026-08-31)
- **Share this app**: `shareApp()` util + Settings → Community "Share CheerPlanner" row opens the OS share sheet with the app link (word-of-mouth).
- **Rate this app**: global `RatePromptProvider` (app/_layout.tsx) shows an "Enjoying CheerPlanner?" modal after (a) checking off the LAST packing-list item for an upcoming competition, or (b) completing a NEW payment. Rate-limited to once per rolling 14 days via AsyncStorage key `rate_prompt_last_shown_at`; taps the native store review (expo-store-review) which only appears on real device/build. Verified by testing agent.
- **Pinned messages (Team Hub chat)**: personnel/admins can pin/unpin messages (long-press → Pin). Pinned bar at top of chat + "Pinned messages" modal with Unpin. Backend: POST /api/team/chat/messages/{id}/pin, GET /api/team/chat/pinned (scoped by hub + channel_id). Minors/non-personnel can view pinned but cannot pin (403). Verified on preview.
- All above are PREVIEW-only until next redeploy.

## Update (2026-08-31) — Athlete Scouting Reports (Team Hub)
- Backend router `routers/scouting.py` (collections: skills, athlete_skills, skill_reviews). Categories: tumbling/stunting/jumps. Levels: on_deck, spotted, unassisted, routine_ready, hit_zero.
- Endpoints: GET/POST/PATCH/DELETE /api/team/scouting/skills; GET /api/team/scouting/overview; GET /api/team/scouting/report/{roster_id}; PUT .../skill/{skill_id} (coach); POST .../request-review (athlete/parent); GET /api/team/scouting/review-requests + POST /{id}/dismiss (coach).
- Permissions (ParentGuard pattern): coach edits; coach+athlete+linked parent view. Athlete match via athlete_chat_links; parent via household scope or guardian_email.
- Share: new share-link kind "scouting" (share.py + models ShareLink/ShareLinkCreate). Public HTML page renders first+last-initial on screen and FULL NAME on Print/Save PDF (for tryouts).
- Frontend: Team Hub tool + review badge + viewer button (team.tsx); screens app/team/scouting.tsx, scouting-report.tsx, scouting-skills.tsx, scouting-requests.tsx; util src/utils/scouting.ts.
- Verified end-to-end on preview (coach CRUD/assess, athlete request->coach resolve, permissions 403s, share link + public page). PREVIEW-only until redeploy. No scouting demo data in seed scripts yet.

## Session (Jun 2026) — Skill Library bulk upload + auto-seed, Calendar parity + personal import
- Removed 🎀 emoji from Scouting Reports header (scouting.tsx).
- Scouting bulk upload: GET /api/team/scouting/skills/template?fmt=csv|xlsx (Category,Level,Skill Name) + POST /api/team/scouting/skills/import (CSV/XLSX, alias mapping, level clamp 1-7, skip dupes/invalid). Frontend header buttons skills-template-btn / skills-import-btn.
- Scouting selection model: coach sees ALL library skills; setting a level = "adds" skill to that athlete's report, clearing (level="") removes it. Athlete/parent/public share see ONLY selected (level set) skills. Report UI: dashed "Add" chip for unselected, "Remove from report" button.
- Auto-seed standard catalog: /app/backend/data/skill_catalog.json (216 skills). _ensure_library(household) seeds once (household flag skill_library_seeded) on first coach access (list_skills/overview/report). Never re-seeds after coach edits. Fix: used `h is None` (projected dict can be {} → falsy).
- Team "Practice Calendar" renamed to "Calendar" (team.tsx + calendar.tsx). Event form upgraded to parent-Schedule parity: event_type (built-in + custom via /household/custom-types), DateField/TimeField pickers, location, address, recurrence (daily/weekly/biweekly/monthly + DOW + until), notes, staff Edit. Backend stores event_type/address; _occurrences gained daily + fixed weekly byweekday (Sun=0..Sat=6 → Python weekday).
- Import team events to personal /schedule: POST /api/team/calendar/import-to-personal {event_id} + /import-all-to-personal. Whole recurring series imported (team recurrence → RecurrenceRule); dedupe via imported_from_team_event_id on schedule_events. UI: event-import-personal ("Add to my calendar") + calendar-import-all header button.
- Verified: iter107 (bulk+selection 7/7), iter108 (calendar form 7/7), iter109 (auto-seed+import 7/7). Creds: coach.casey@cheerplanner.app / CheerDemo2026!, demo@cheerplanner.app / CheerDemo2026!, parent.taylor@cheerplanner.app / CheerDemo2026!.

## Session (Jun 2026) cont. — Tumbling Standing/Running, AI Coaching Assistant
- Tumbling catalog replaced with coach's Standing/Running list. Added `sub_category` ("standing"/"running") to skills (tumbling only; stunting/jumps=""). No-repeat rule applied PER sub-category. scripts/rebuild_tumbling.py migrated catalog (196 total: tumbling 67, stunting 84, jumps 45) + all households (name-matched to preserve assessments). Skill Library + Report show Standing/Running sub-headers per Tumbling level; add(+) per sub-group; drag tracks sub_category. Verified iter111 (7/7).
- Multi-select bulk level in Report: PUT /api/team/scouting/report/{roster}/skills/bulk. UI Select mode + bulk level picker. Report/bulk pop-ups wrapped in ScrollView. Verified iter110.
- Skill dedupe (earlier): scripts/dedupe_skill_levels.py (keep lowest level).
- AI Coaching Assistant (routers/coach_ai.py, coach/staff only via require_team_access):
  - Chat: Perplexity sonar-pro at https://api.perplexity.ai/chat/completions (PERPLEXITY_API_KEY in .env). Strict server-side topic classifier (max_tokens>=16) hard-declines off-topic; cheer-only SYSTEM_PROMPT; citation markers stripped via regex; history in db.coach_ai_messages.
  - Flyer: OpenAI gpt-image-1 via emergentintegrations + EMERGENT_LLM_KEY (dall-e-3 NOT supported by key). Stored to Object Storage + chat_media; POST /team/coach-ai/flyer/{id}/post-to-chat inserts team_messages. NOTE: Emergent key budget currently exhausted (max $0.001) -> flyer returns 402 "add balance"; user must top up Universal Key.
  - Frontend: app/team/coach-ai.tsx (Ask/Flyer tabs). Team Hub tool card 'AI Coaching Assistant' (coach-only, in unlocked branch). Verified iter112 (10/10 backend + frontend).
- Perplexity Router API option (frontier models via creator/model slugs) available if user wants model-swapping; current sonar-pro chosen for live web grounding.

## Session cont. — Flyer logo/photo uploads
- AI flyers now accept an uploaded team logo + up to 3 photos. Backend routers/coach_ai.py: POST /team/coach-ai/flyer accepts base64 `logo` + `photos[]`; generates the AI flyer (gpt-image-1) then composites with Pillow (_composite_flyer): logo on a white rounded plate top-center, photos as a bottom row with white borders/rounded corners. Prompt hints reserve top/bottom space. Bad/undecodable images are skipped; compositing failure falls back to plain flyer. Unit-tested offline (PIL). Frontend app/team/coach-ai.tsx: expo-image-picker (perm-handled) "Upload logo" + up to-3 "Photos" pickers, thumbnails w/ remove. NOTE: live generation still blocked by Emergent key Max budget $0.001 cap (pending support raise); compositing verified via unit test + UI via screenshot.

## Session cont. — Assistant Coach (app-help) + Flyer templates/gallery/logo memory
- Emergent Universal Key budget cap was raised by support → flyer generation (gpt-image-1) now works end-to-end incl. logo/photo composite + post-to-chat (verified 200).
- Assistant Coach: NEW persistent, app-wide help widget for ALL signed-in users (any tier). routers/assistant.py: POST /api/assistant/chat + /api/assistant/history. Role-aware (team_access→coach; athlete_chat_links→athlete; else parent). Uses EMERGENT_LLM_KEY + Claude Haiku 4.5 (anthropic/claude-haiku-4-5) via emergentintegrations LlmChat (follows system prompt, no web search — replaced flaky Perplexity classifier). Only answers how-to-use-CheerPlanner; declines off-topic + redirects cheer-technique to Team Hub AI Coaching Assistant. History in db.assistant_messages. Frontend: src/components/AssistantCoachWidget.tsx = floating help-buoy FAB (bottom-right) + bottom-sheet chat, mounted in app/_layout.tsx ThemedStack; hidden when logged out and on /team/coach-ai. Verified end-to-end (login→FAB→sheet→role-aware answer) + curl (coach/parent/athlete + decline).
- Flyer enhancements (routers/coach_ai.py): style presets classic/bold/glam (STYLE_PROMPTS) via `style` field; Logo Memory (db.flyer_settings per household, GET /team/coach-ai/settings, auto-prefill); Save Flyers gallery (db.flyers with 256px JPEG thumb; GET /team/coach-ai/flyers + GET /team/coach-ai/flyers/{id} full image). Frontend coach-ai.tsx FlyerMode: Style chips, ★ Saved flyers gallery modal (tap→load full→post-to-chat), logo prefill. All verified via curl + screenshot.

- Assistant Tips: help widget shows a contextual "Did you know?" card that changes per screen (pickTip by pathname) in AssistantCoachWidget.tsx. Verified: Athletes screen shows the athlete tip.
- Assistant Coach knowledge expanded: APP_GUIDE in routers/assistant.py now fully maps main tabs (Home/Athletes/Schedule/Calendar/Expenses/Competitions/Reminders/Team) and every Settings section (Plan/subscription+Universal Key, Notifications, Appearance/theme, Family Sharing/Household, Team Hub Access, Import/Export CSV+ICS, Seasons/Teams/Competitions/Fundraisers, Community Reviews, Roadmap, Help/FAQ/Contact/Privacy, Sign out, Delete Account) + Team Hub tools. Verified accurate answers for theme, expense export, subscription. Help FAB shrunk 56->44 and icon changed help-buoy->star; DEFAULT_TIP wording updated.
- Guided Tour: src/components/GuidedTour.tsx = one-time first-run walkthrough (4 steps: welcome, tabs highlight, Team Hub, star help button highlight) mounted in _layout ThemedStack; persisted via storage key cp_guided_tour_seen_v1; Skip/Back/Next. Verified shows on first login.
- Guided Tour role-tailored: step 3 differs by role (coach: Scouting Reports + Flyers via Team Hub; parent/athlete: RSVP to team events + track Expenses). Uses user.team_access. Verified coach variant live.

## Session update 19 (Import personal competitions/events INTO Team Hub — iter112)
- DONE: Coaches/staff/reps can IMPORT their personal Competitions + upcoming Schedule events from the parent portal INTO the Team Hub calendar. New multi-select modal (`ImportFromPersonalModal` in `app/team/calendar.tsx`) opened by the header `albums-outline` button (testID `calendar-import-personal`, staff-only). Lists competitions + events from GET `/api/team/calendar/importable`; checkbox multi-select; 4 include toggles (travel/teams_to_watch/packing_list/links, default ON). Imports via POST `/api/team/calendar/import-from-personal-bulk` {items:[{source,id}], include} → {imported, already, skipped}. Idempotent per `imported_from_personal_id`. Backend refactored: extracted `_import_from_personal_one(...)` helper reused by the single + bulk endpoints; both 403 for non-staff. Verified iter112 (7/7 backend pytest + frontend E2E; test events cleaned up).

## Session update 20 (Change recurrence pattern on an existing series — iter113)
- DONE: On the personal Schedule tab, editing an event that belongs to a recurring series now lets you change the recurrence PATTERN (frequency, days-of-week, repeats-until), not just field values. Previously the Repeat section was hidden for series edits. Now it's shown + pre-filled with a hint that changing it rebuilds the series. New backend `POST /api/schedule/{event_id}/reschedule-series?anchor=series_start|this` (payload = ScheduleEventCreate): regenerates the whole series from the new rule via `_expand_recurrence`, preserving the series_id; omitting `recurrence_rule` collapses the series to a single standalone event. Frontend (`app/schedule/new.tsx`): tracks the original rule signature; a pattern change on save opens a new "Update recurring series?" confirm modal (testIDs `reschedule-confirm`/`reschedule-cancel`) → calls reschedule-series; field-only edits still use the existing This/Future/All scope chooser (no regression). Verified: backend direct test (weekly→daily regen preserves series_id; collapse-to-single) + frontend E2E iter113 (all 5 scenarios pass).

## Session update 21 (Team Forms: reorder/remove questions + duplicate form — iter114)
- DONE: Team Form question management — on the form detail screen (`app/team/form-detail.tsx`) each question row now has up/down arrows (testIDs `form-q-up-<i>`/`form-q-down-<i>`) to REORDER (swaps + PATCH `/team/forms/{id}` with the reindexed `questions` array; server re-stamps `order`). Remove (× / `form-del-q-<i>`) and edit already existed. Added a "Use the arrows to reorder questions" hint. DUPLICATE FORM — the Team Forms list (`app/team/forms.tsx`) gained a per-card copy icon (testID `form-duplicate-<id>`) that calls the existing `POST /team/forms/{id}/duplicate` (copies name "(copy)", description, questions, links, attachments, season; NOT responses/lock/deadline) then opens the new form. Verified: backend API test (reorder/remove/duplicate) + frontend screenshot (arrows + copy icon render).

## Session update 22 (Flyer Generator → Google Imagen 4, staff-only paid) 
- Replaced OpenAI gpt-image-1 with **Google Imagen 4** in the Coach Assistant flyer generator (routers/coach_ai.py). Uses emergentintegrations `GeminiImageGeneration(api_key=GEMINI_API_KEY)`, model from env `IMAGEN_MODEL` (default `imagen-4.0-fast-generate-001`). Requires the USER's own Google Gemini API key (Universal Key does NOT cover Imagen). Key stored in backend/.env as GEMINI_API_KEY. Imagen is text-to-image only, so uploaded logo/photos are still composited on afterward with Pillow (_composite_flyer, unchanged). Robust error mapping: model-not-found→503 "enable billing + Generative Language API"; auth→503; quota→429.
- New flyer inputs: **team_name** field + **auto_layout** toggle ("Let AI design the layout") in _flyer_prompt. Frontend app/team/coach-ai.tsx: Team name TextInput (flyer-team), Let-AI-design checkbox (flyer-auto-layout).
- **Logo library**: uploaded logos saved (downscaled 400px, sha256-deduped, keep last 24) in db.flyer_logos via async _remember_logo. GET /api/team/coach-ai/logos. Frontend logo picker now offers "Upload logo" OR "Choose saved" (flyer-logo-choose → logo gallery modal flyer-logos). Existing flyer_settings "last logo" prefill kept.
- **Media Library**: renamed "Saved flyers" gallery → "Media Library" (link flyer-saved-open). Added DELETE /api/team/coach-ai/flyers/{id} (staff only; removes db.flyers + db.chat_media + storage object via new core/storage.py delete_object). Per-item trash button in gallery (flyer-saved-del-<id>) + "Delete from Media Library" under the live preview (flyer-delete). Verified 200 + DB cleanup.
- **Post-to-chat + deletion**: unchanged post-to-chat. Chat deletion already satisfies requirement — team_chat delete_message allows sender OR team_access admin in-hub OR platform admin; parents/athletes (no team_access) can only delete own → cannot delete coach-posted flyers.
- STATUS: All code + non-generation flows verified (endpoints, UI screenshots, delete). LIVE Imagen 4 generation BLOCKED: user's Gemini key project shows zero imagen/predict models (billing not yet active). App returns the correct guidance message; will work once billing propagates. Key confirmed by user: AQ.Ab8RN6Jeomca0reB9rB0d7_H2h9jhERjZzQr4NQmzFdgAVkLcw.
