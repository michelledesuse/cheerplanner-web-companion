#====================================================================================================
## Iteration 53 — Roles & Team Hub Phase A+B (DONE, verified 10/10 backend + frontend). R1 roles (team_rep/staff), R2 Home→header button, R3 Team tab, R4 landing placeholder. Creds applereview@cheerplanner.app/Review2026!
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 16 — Phase B "Teams" backend validation (2026-01)

**Tester:** T1 (sub-agent) · **Scope:** backend only · **Result:** 14/14 pytest pass after a 1-line bug fix.

### Tests executed
File: `/app/backend/tests/test_teams_phase_b.py` (JUnit: `/app/test_reports/pytest/pytest_teams_phase_b.xml`)
1. ✅ POST /api/teams returns id/name/color/season
2. ✅ GET /api/teams scoped to household
3. ✅ PATCH /api/teams/{id} updates fields
4. ✅ POST /api/athletes role=athlete + 4 team_ids → 400 "An athlete can belong to at most 3 teams."
5. ✅ POST /api/athletes role=coach + 5 team_ids → 200
6. ✅ PATCH /api/athletes/{id} adding 4th team to a 3-team athlete → 400 (state unchanged on GET)
7. ✅ PATCH /api/competitions/{id} round-trips team_ids + team_meet_times + teams_to_watch
8. ✅ DELETE /api/teams/{id} cascades: stripped from athletes.team_ids, competitions.team_ids, and competitions.team_meet_times
9. ✅ POST /api/bulk-delete resource=teams returns {deleted:2}; teams no longer listed
10. ✅ Regression: athletes GET, competitions GET, expenses POST + bulk-delete, payments POST/DELETE all work

### Bug found & fixed (this run)
- **POST /api/competitions → 500** when payload omitted `team_ids` / `team_meet_times` / `teams_to_watch`. Phase B made these `Optional[List[...]] = None` on `CompetitionCreate` but the strict `Competition` response model rejects `None` for its typed-list fields. Fix applied at `/app/backend/server.py:1402`: `payload.model_dump(exclude_none=True)` (mirrors `create_team`). Re-tested green.

### Notes for main agent
- `server.py` is now 3206 lines (way over the 700-line guideline). Consider splitting into routers per resource.
- Inconsistent `model_dump()` patterns across handlers (exclude_none vs exclude_unset vs neither). The competitions bug came from this inconsistency.
- Frontend testing for Teams UI is the explicit follow-up — not touched this iteration.

## Iteration 17 — Cap removal regression (backend only)

- Suite: `/app/backend/tests/test_teams_phase_b.py` (23 tests, all passing).
- JUnit: `/app/test_reports/pytest/pytest_iter17.xml`.
- Report: `/app/test_reports/iteration_17.json`.
- Verified the 3-team cap is GONE:
  - `POST /api/athletes` role=athlete, team_ids of length 4 → **200** ✅
  - `POST /api/athletes` role=athlete, team_ids of length 10 → **200** ✅
  - `PATCH /api/athletes/{id}` 3-team athlete → 4 teams → **200**, `team_ids` length 4 ✅
  - `PATCH /api/athletes/{id}` → 8 teams → **200**, `team_ids` length 8 ✅
- Regression: Teams CRUD, team-delete cascade, `team_ids`/`team_meet_times`/`teams_to_watch` round-trip, `POST /api/competitions` without list fields (iter-16 fix holds), bulk-delete for teams / expenses / payments / fundraisers / schedule_events / competitions, role persistence on POST + PATCH, `/api/auth/me` all green.
- Updated: inverted `test_04` + `test_06` cap-assertions to expect 200; added `test_04b` (10 teams), `test_06b` (8 teams), `test_11` (competition without lists), `test_12` (role persistence), `test_13a-d` (bulk-delete on payments/fundraisers/schedule_events/competitions), `test_14` (auth/me).
- No backend issues found. Frontend changes (ColorField on `/app/teams.tsx`, athlete-form cap-warning removal) not tested per request.

## Iteration 18 — Waterfall payments + team multi-day meet times + calendar/ICS (backend only)

- Suite: `/app/backend/tests/test_iter18_waterfall_and_team_calendar.py` (16 tests).
- JUnit: `/app/test_reports/pytest/pytest_iter18.xml`.
- Report: `/app/test_reports/iteration_18.json`.
- **Result: 14 PASS / 2 FAIL** — two real backend bugs surfaced.

### PASS (14)
- Waterfall POST: $250 across 3 staggered-due expenses → Camp $50 + Gear $200 paid in full, Tuition still owed; paid flags auto-set; balance_due correct.
- Waterfall is order-agnostic: even when client sends `applied_expense_ids` in reverse order, server re-sorts by due_date.
- Waterfall POST $60/$300: earliest-due gets all $60; PATCH amount 60→300 covers both expenses and auto-flips both `paid=True`.
- TeamMeetTime: 2-entry multi-day round-trip with date / meet_time / performance_time / performance_location; partial-edit (Hall A → "Hall A (updated)", 16:00 → 15:30) round-trips; removing one entry leaves the other intact.
- Calendar feed: team_meet + team_performance items emitted with team color; subtitle includes 12-hour time + location; teams_to_watch emits cyan (#0EA5E9); bare-date entries emit a single performance-day marker.
- ICS export: timed VEVENTs present (DTSTART:20260612T140000, DTSTART:20260612T160000) for team_meet/team_performance.
- Regression: auth/me, athlete with 5 team_ids (cap-removal holds), team-delete cascade strips IDs from athletes.team_ids + competitions.team_ids + competitions.team_meet_times, POST /api/competitions without list fields, bulk-delete expenses.

### FAIL (2) — backend bugs for main agent
1. **PATCH /api/payments amount-decrease leaves stale `paid=True`.** After PATCH 60→300→60, Gear correctly reverts to unpaid but Tuition stays `paid=True` because `update_payment` (server.py:1509-1512) builds `affected_ids` only from the NEW updates, missing previously-covered expenses that drop out of the new allocation. Fix: union `existing['applied_expense_ids']` (and prior allocations) into `affected_ids` before the refresh loop.
2. **POST /api/payments silently drops client-supplied `allocations`.** `PaymentCreate` (server.py:259-265) has no `allocations` field, so FastAPI strips it; the waterfall branch then always overrides. Test posted 80/20 explicit split → server stored 100/0 waterfall. Fix: add `allocations: Optional[List[PaymentAllocation]] = None` to `PaymentCreate`.

### Minor (observed during cleanup)
- DELETE /api/payments does NOT refresh expense `paid` flags. Deleting a payment that fully covered an expense leaves the expense `paid=True` indefinitely.

### Notes
- server.py is now 3447 lines — still well above the 700-line guideline; consider router splits.
- Paid-flag refresh logic differs across create / update / delete payment handlers — central helper recommended.


---

## Iteration 19 — Payment Fix Verification (Jan 2026)

**All 4 verification scenarios + 16 regression tests PASS (20/20).**

### Fixes verified
- **A. POST /api/payments with explicit allocations** ✅
  Posted {amount:100, allocations:[{E1:80},{E2:20}]} — server preserves 80/20 split (no waterfall override). E1 balance=$20, E2 balance=$80, both paid=False. PaymentCreate now declares `allocations` field.
- **B. PATCH amount-decrease clears stale paid flags** ✅
  Started with $300 covering Tuition+Gear (both paid=True). PATCH amount=60 → Gear waterfalled to $60 (balance $140), Tuition dropped out (balance $100). BOTH paid_flag=False. Previously-covered expense_id is now unioned into `affected_ids` via the pre-update snapshot.
- **C. PATCH with explicit allocations override** ✅
  PATCH {amount:100, allocations:[50/50]} on a 300-waterfall payment → explicit override wins, balances reflect 50/50 (Tuition $50, Gear $150), no waterfall ran.
- **D. DELETE refreshes paid flags** ✅
  $50 payment fully covered Camp (paid=True). DELETE → Camp paid=False, balance restored to $50. `delete_payment` now snapshots applied/allocations BEFORE removal and refreshes flags.

### Regression
- `pytest backend/tests/test_iter18_waterfall_and_team_calendar.py` → **16/16 PASS** (re-run after fixes).
- `pytest backend/tests/test_iter19_payment_fixes.py` → **4/4 PASS**.

### Files added
- `/app/backend/tests/test_iter19_payment_fixes.py` (new)
- `/app/test_reports/iteration_19.json`
- `/app/test_reports/pytest/pytest_iter19.xml`

No production code modified by testing agent.

---

## Iteration 20 — Dashboard Aggregate Unification + Unapply Regression (backend only)

### Scope
- Verify P2 cluster: `/api/dashboard` now derives `unpaid_expense_balance` and `total_payments_ytd` from the canonical `_build_paid_map` PLUS the `paid=True` override (server.py:2348-2364).
- Confirm unapply round-trip (PATCH payment with `applied_expense_ids=[]` and `allocations=[]`) still flips the previously-covered expense's `paid` flag back to False (regression of iter-19 HIGH-1 fix).
- Confirm iter-18 (16 tests) and iter-19 (4 tests) regression suites remain GREEN.

### Test File
- `/app/backend/tests/test_iter20_dashboard_aggregates.py` (NEW, 7 tests)

### Results
| Scenario | Test | Result |
|---|---|---|
| A1 | paid=True expense contributes to Paid YTD & not Open Balance | ✅ PASS |
| A2 | Toggle e1 paid=True → ytd Δ=$300, open Δ=$0 | ✅ PASS |
| A3 | Toggle e1 paid=False → reverts to A1 deltas | ✅ PASS |
| B1 | $60 partial pay on e1 (waterfall) → ytd Δ=$60, open Δ=$240 | ✅ PASS |
| B2 | PATCH e2 paid=True with partial e1 → ytd Δ=$260, open Δ=$40 | ✅ PASS |
| C1 | $100 payment auto-marks e1 paid=True | ✅ PASS |
| C2 | PATCH payment {applied_expense_ids:[], allocations:[]} → e1 paid=False, balance=$100 | ✅ PASS |

### Regression
- `test_iter18_waterfall_and_team_calendar.py` — **16/16 PASS** ✅
- `test_iter19_payment_fixes.py` — **4/4 PASS** ✅
- `test_iter20_dashboard_aggregates.py` — **7/7 PASS** ✅
- **Total: 27/27 GREEN** (in 6.73s)

### Findings
- No regressions, no bugs, no fixes required.
- Dashboard tile values now agree symmetrically with per-athlete and Money-tab views — both read from the same `_build_paid_map` plus `paid=True` override.
- The `min(paid, amt)` clamp on server.py:2363 correctly defends against payment-overflow (so Paid YTD can never exceed total expense amount).
- Minor nit (pre-existing, not a bug): `total_payments` local var on server.py:2339-2341 is now dead code — value not used in response since `total_payments_ytd` now equals `paid_from_expenses`. Safe to delete later; not blocking.

### Artifacts
- `/app/test_reports/iteration_20.json`
- `/app/test_reports/pytest/pytest_iter20.xml`
- `/app/test_reports/pytest/pytest_iter20_regression.xml` (combined iter-18 + iter-19 re-run)


---

## Iteration 46 — Quick wins: Active-filters bar (B6) + Calendar date-jump (B4)

**Main agent implementation (needs frontend testing):**

### B6 — Active-filters UI
- New reusable component `/app/frontend/src/components/ActiveFiltersBar.tsx` — shows "<N> filter(s) applied" + a "Clear all" pill; renders nothing when count is 0.
- Wired into:
  - Expenses tab (`app/(tabs)/expenses.tsx`): counts athlete + team + category filters (team/category only on Expenses sub-tab). testIDs: `exp-filters-active-bar`, `exp-filters-clear-all`. Clear resets athleteFilter/teamFilter/categoryFilter.
  - Schedule tab (`app/(tabs)/schedule.tsx`): counts type + athlete + team. testIDs: `sched-filters-active-bar`, `sched-filters-clear-all`.
  - Competitions tab (`app/(tabs)/competitions.tsx`): counts athlete + team. testIDs: `comp-filters-active-bar`, `comp-filters-clear-all`.

### B4 — Calendar date-jump
- Calendar tab (`app/(tabs)/calendar.tsx`): new header button testID `cal-jump` (calendar icon). Web uses hidden HTML date input + showPicker(); native (iOS modal testID `cal-jump-done`, Android inline) uses @react-native-community/datetimepicker. Picking a date sets `selected` + `month` so month/week/day views jump to the chosen date.

**Test focus:** apply one/multiple filters on each of the 3 tabs → bar shows correct count → "Clear all" resets all chips to All and hides the bar. Calendar: tap jump button → pick a date → calendar navigates to it (all 3 views). Credentials: applereview@cheerplanner.app / Review2026!.

---

## Iteration 47 — Calendar jump BUG FIX + dropdown redesign (user-reported)

**User bug report:** (1) Picking a date in the jump picker showed events underneath but the calendar GRID did not navigate to that month. (2) User had to tap "Done" — wanted auto-apply. (3) Cosmetic: toggling Week→Day→Month didn't snap back. (4) User wants a DROPDOWN (month + year), NOT another month-scroll date picker.

**Fixes:**
- Root cause of (1): react-native-calendars `<Calendar>` only reads `current` on initial mount; changing it later doesn't move the grid. Fixed by adding `key={selected}` so the Calendar remounts to the selected month whenever a jump changes `selected`. (Swipe/onMonthChange only updates `month`, not `selected`, so swiping is unaffected.)
- Replaced the DateTimePicker / hidden HTML date input with a new dropdown component `/app/frontend/src/components/DateJumpDropdown.tsx`: a popover under the header with a **Month dropdown** and **Year dropdown**. Selecting an option jumps the calendar INSTANTLY (no Done). Translucent backdrop; close via X (cal-jump-close) or tapping outside.
- Removed @react-native-community/datetimepicker usage + unused Platform/Modal/Pressable/useRef imports + dead modal styles from calendar.tsx.

**testIDs:** cal-jump (header btn), cal-jump-panel, cal-jump-month, cal-jump-year, cal-jump-month-<0..11>, cal-jump-year-<YYYY>, cal-jump-close.

**Test focus:** Open Calendar → tap cal-jump → pick a Month and/or Year from the dropdowns → the calendar GRID must navigate to that month/year (selected day highlighted, month title updated) WITHOUT any Done tap. Verify no month-scroll wheel is shown (it should be dropdown lists). Regression: Month/Week/Day toggle still works; swiping months in Month view still works. Credentials: applereview@cheerplanner.app / Review2026!.

---

## Iteration 48 — B2/#7 Custom event & expense types (household-wide, inline add)

**Feature (needs backend + frontend testing):**

### Backend (household-scoped, shared across co-parents)
- Household model gained `custom_expense_categories: List[str]` and `custom_event_types: List[{id,label,color}]` (core/models.py).
- New endpoints (routers/household.py), all household-scoped:
  - GET  /api/household/custom-types → {expense_categories, event_types}
  - POST /api/household/custom-types/expense-category  {name} → dedupes vs built-ins+existing (400 on dup/empty)
  - DELETE /api/household/custom-types/expense-category (body {name})
  - POST /api/household/custom-types/event-type  {label,color} → returns {event_types, event_type:{id,label,color}}
  - DELETE /api/household/custom-types/event-type/{id}
  - GET /api/household now also returns the two custom lists.
- Calendar feed (routers/calendar.py) merges household custom_event_types colors so custom-typed schedule events render with their chosen color.
- NOTE: expense `category` and schedule `event_type` are free strings already, so existing items with a (now-deleted) custom type keep their label as plain text — matches the chosen delete behavior.

### Frontend
- New reusable `/app/frontend/src/components/AddTypeModal.tsx` (name input + optional color swatches).
- Expense form (app/expenses/new.tsx): category chips now include household custom categories + a dashed "+ New" chip (testID expense-cat-add) → AddTypeModal (name only). Long-press a custom category chip to delete it.
- Schedule form (app/schedule/new.tsx): event-type grid includes custom types + a dashed "+ New" button (testID type-add) → AddTypeModal (name + color swatch, testIDs add-type-name / add-type-color-<hex> / add-type-save). Long-press a custom type to delete.
- Schedule tab (app/(tabs)/schedule.tsx): row stripe color + Type filter row now include custom types.

**Credentials:** applereview@cheerplanner.app / Review2026!. Custom types are HOUSEHOLD-WIDE.

---

## Iteration 52 — S1 Timed SMS lead-time reminders (per-event offsets)

**Feature (backend + frontend, needs testing):**

### Backend
- Models (`core/models.py`): added `sms_reminder_offsets: List[int]` to `Competition`/`CompetitionCreate`/`CompetitionUpdate` (minutes before `booking_release_at`) and to flight `Booking`/`BookingCreate`/`BookingUpdate` (minutes before the check-in-open moment = 24h before each leg's departure). Allowed values 60/30/15/1.
- New helper `parse_local_datetime()` (`core/helpers.py`) — parses ISO and freeform `DD-MM-YYYY HH:MM` / `DD/MM/YYYY` flight times into a naive local datetime.
- Scheduler (`core/scheduler.py`): added a SECOND job `send_timed_sms_tick` running every minute (CronTrigger second=0). Existing hourly digest unchanged. The tick: for each user opted into SMS (sms_enabled + valid sms_phone), in their tz, checks household competitions (booking openings) and flight bookings (both legs' check-in windows) with non-empty offsets, and fires an SMS when `now` is within a tolerant 120s window of each `target - offset`. Per-offset dedupe via `sent_notifications` keys `{user}:comp:{id}:booking_open:{off}` and `{user}:booking:{id}:checkin_{out|ret}:{off}`. SMS-only.
- `routers/bookings.py`: coerce `sms_reminder_offsets` None→[] on create.

### Frontend
- New reusable `src/components/SmsReminderPicker.tsx` — multi-select chips (1 hr / 30 / 15 / 1 min before). testIDs `<prefix>-<value>`.
- Competition form (`app/competitions/new.tsx`): picker shown only when a Booking release datetime is set (testIDPrefix `comp-sms-offset`). Saved as `sms_reminder_offsets` (forced [] if no release datetime).
- Flight booking form (`app/bookings/new.tsx`): picker shown for flight type (testIDPrefix `flight-sms-offset`), saved on the booking.

**Test focus (DO NOT trigger real SMS to random numbers):**
1. Backend: create a competition with `booking_release_at` + `sms_reminder_offsets:[60,30,15,1]` → persists & round-trips on GET. Same for a flight booking. Verify non-flight bookings store []. Verify `parse_local_datetime` handles ISO + `DD-MM-YYYY HH:MM`. Verify offsets validation keeps only 60/30/15/1.
2. Backend scheduler unit-ish: `_valid_offsets`, `_due` window, dedupe key behavior (calling the tick twice doesn't double-record). You may monkeypatch `send_sms` to avoid real Twilio delivery and set a user's booking_release_at to (now + offset) in their tz to confirm a send is attempted + a `sent_notifications` row is written; second tick is a no-op.
3. Frontend: competition form — set a booking release datetime → picker appears → select chips → save → reopen shows them selected. Flight booking form — picker appears for flight type, hidden for hotel/car.

**Credentials:** applereview@cheerplanner.app / Review2026!

---


**Four backlog items implemented:**

### CAL-1 — Chronological day-event ordering (backend)
- `routers/calendar.py`: added `time` field to schedule-event calendar items (from `start_time`), and changed the final feed sort from `date`-only to `(date, HH:MM)` via `_extract_hhmm`. All-day items (no time) sort FIRST within a day, then timed items ascending. Verified via curl: 07-08 → hotel_stay(all-day), team_meet 01:00, competition 14:00, team_performance 14:30. The day/week lists on the Calendar tab consume the feed order, so they're now chronological everywhere.

### CAL-2 — Add Competition/Event from the Calendar tab (frontend)
- `app/(tabs)/calendar.tsx`: new header "+" button (testID `cal-add`) opens a bottom-sheet chooser (testIDs `cal-add-competition`, `cal-add-event`, `cal-add-cancel`, `cal-add-backdrop`) titled "Add to <selected date>". Picking Competition → `/competitions/new?date=<selected>`; Event → `/schedule/new?date=<selected>`.
- `app/competitions/new.tsx` + `app/schedule/new.tsx`: accept a `date` query param and prefill the event/start date with it.

### F2 — Home "Total due today" now includes overdue (backend + frontend)
- `routers/dashboard.py`: `due_today` changed from due-date `== today` to `<= today` (unpaid expenses + positive booking balances), so it now sums "due today + overdue". Verified via curl (due_today jumped to 1122.5 for the review account).
- `app/(tabs)/dashboard.tsx`: card subtitle updated to "Due today + overdue · expenses & travel".

### F1 — Filter-aware Open Balance / Paid YTD (frontend)
- `app/(tabs)/expenses.tsx`: `totals` now recompute from an athlete/team/category-SCOPED expense list (NOT the all/open/paid view toggle). When any scope filter is active, labels read "Open balance (filtered)" / "Paid YTD (filtered)". On the Payments tab only the athlete filter applies (team/category chips aren't shown there).

**Credentials:** applereview@cheerplanner.app / Review2026!

**Test focus:**
1. Calendar: day event list is in chronological order (all-day first, then by time) in Month/Week/Day views.
2. Calendar: tap "+" → chooser appears → "Competition" opens comp form with selected date prefilled; "Event" opens schedule form with selected date prefilled.
3. Home: "Total due today" card sums due-today + overdue unpaid expenses & travel; subtitle updated.
4. Expenses tab: applying athlete/team/category filter recalculates Open balance + Paid YTD to the filtered scope and shows "(filtered)" labels; clearing filters restores household totals. Payments tab: athlete filter also scopes the totals.

---


## Iteration 49 — Twilio SMS reminder SENDING enabled (toll-free approved)

**Feature (backend + frontend):**
- New `/app/backend/core/sms.py`: send_sms(to, body) via Twilio SDK (twilio==9.10.9), is_configured(), normalize_us_phone() → E.164. Never raises; no-op if Twilio env missing. Reads TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER from backend/.env (already set).
- Digest scheduler (core/scheduler.py): after the email digest, if prefs.sms_enabled + prefs.sms_phone, sends a compact SMS (_build_sms_body: count + up to 3 items + "Reply STOP to opt out") with its OWN dedupe key (`{user}:{date}:sms:{freq}`), independent of email. Only sends when the digest has items and the master switch/frequency/send-hour gating passes.
- New endpoint POST /api/notifications/sms-test — sends a one-off confirmation text to the user's saved number. Guardrails: 503 if Twilio not configured, 400 if not opted in / invalid number, 502 if Twilio send fails.
- Frontend settings/notifications.tsx: added a "Send me a test text" button (testID notif-sms-test) shown only when sms_enabled is on; calls the test endpoint and alerts success/failure.

**Test focus (DO NOT send to random real phone numbers — Twilio will attempt real delivery):**
- Backend: POST /api/notifications/sms-test WITHOUT opting in → 400 "Turn on SMS reminders first." Verify is_configured() true (server has creds). Verify normalize_us_phone via unit-style checks. Do NOT opt in a fake number and trigger a real send.
- Frontend: opting in shows the "Send me a test text" button; the SMS section/consent renders. (Do not actually submit a real send during automated test.)
- Credentials: applereview@cheerplanner.app / Review2026!.

## Iteration 61 — Sign-Up slot kinds (item/duty/time) + time_label. Backend 7/7, frontend all flows PASS.
## Iteration 62 — Owner-controlled Team Hub access delegation (replaces self-toggle). Backend 12/12, frontend PASS. Owner=household.owner_user_id (backfilled to first member). New: /api/team-access GET, PATCH /members/{id}, POST /invite, DELETE /invite/{id}. /household/join honors grant_team_access. New screen /app/frontend/app/team-access.tsx; Settings row settings-team-access -> /team-access.

## Iteration 63 — Team Hub spreadsheet import (roster/sizes/paperwork/payments, CSV+XLSX). Gated by team_access (403). Roster upserts by name; sizes/paperwork/payments auto-create unmatched members. Reuses /import/[kind]. Backend 27/27, frontend PASS. Privacy policy updated.

## Iteration 64 — Public share links (signup/roster/sizes) via FastAPI HTML page. 17/17 backend + browser PASS.
## Iteration 65 — Payment exempt member, roster bulk-delete, schedule scope=future, payment keyboard fix. 4/4 backend + frontend PASS.

## Iteration 66 — Individual payment reminders (Twilio), roster download+cleanup, public page palette+roster dropdown, full-slots-to-bottom. 7/7 backend + frontend PASS.

## Iteration 67 — Duplicate (signups/paperwork/payments) + per-member Amount Due. 7/7 backend + frontend PASS.
