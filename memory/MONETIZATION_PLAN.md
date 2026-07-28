# CheerPlanner — Free vs Premium + Lifetime + RevenueCat: Implementation Plan (v1, awaiting approval)

STATUS: PLAN ONLY. No production code written yet. Awaiting user approval.

## 0. Architecture review (what exists today)
- **Auth**: custom JWT + bcrypt (`routers/auth.py`, `core/security.py`). Users have `team_access: bool`.
- **Household**: `households` collection `{id, member_user_ids[], owner_user_id, theme, custom_*}`. Nearly all
  data is household-scoped via `_household_user_ids()` (widens `user_id==me` → `user_id IN members`).
- **Team Hub**: gated by `require_team_access` (checks `user.team_access`). Owner delegates access
  (`routers/team_access.py`). Roster members are NOT app accounts (manual/CSV entry).
- **CONFLICT FOUND (must fix)**: Team Hub "invite by email" reuses `HouseholdInvite` and on join
  ADDS the invitee to `member_user_ids` (`household.py:join_household`). So Team Hub collaborators
  currently consume household seats — violates requirement #4. Phase 1 decouples this.

## 1. Central entitlement architecture (requirement #8, #23)
New collection `entitlements` (never overwrite a bool; append + resolve):
```
entitlement = {
  id, type: "subscription" | "lifetime" | "promo",
  source: "apple" | "google" | "admin_grant" | "code_redemption",
  scope: "household",                # premium always resolves at household level
  user_id,                           # the individual who owns/triggered it
  household_id,                      # the household currently benefiting (bound)
  status: "active" | "expired" | "revoked",
  plan: "monthly" | "annual" | "lifetime" | null,
  starts_at, expires_at (null = never),   # subscriptions carry renewal/expiry
  store_txn_id, revenuecat_id (subscriptions only),
  reason, label, note,               # e.g. "Beta Tester 2026"
  granted_by_admin_id, created_at, updated_at
}
```
**Resolver** `household_premium_status(household_id)` → `{is_premium, plan, source, expires_at}`:
1. If any ACTIVE lifetime entitlement is bound to this household → Premium (Lifetime). (highest priority)
2. Else if any ACTIVE subscription entitlement bound to this household and not expired → Premium.
3. Else Free.
Feature gates ask ONLY `is_premium` — never "does the user have an Apple subscription". Adding a new
source later (partner, promo) requires zero changes to feature checks.

- **Config-driven limits** (`core/plans.py`), served to client via `GET /api/entitlements/config`:
```
PLAN_LIMITS = { "free": {"household_members": 2}, "premium": {"household_members": 6} }
PRICING     = { "monthly": {...}, "annual": {..., "trial_days": 7} }  # display metadata only; store is source of truth
```
Changing 6→10 later is a one-line config edit — no permissions redesign.

## 2. Household vs Team Hub decoupling (requirement #3, #4)
- Household membership (`member_user_ids`) → counts against limit (Free 2 / Premium 6).
- Team Hub collaborators → NEW `team_hub_members` list on the household (or `team_hub_access[]`), separate
  from `member_user_ids`. Team Hub invites create a Team-Hub membership that does NOT consume a household seat.
- Keep separate concepts in DB: household membership, household roles, team-hub membership, team-hub roles,
  team-hub invitations. Roster people remain non-accounts (unchanged).
- Migration: existing `team_access=true` household members keep access; the buggy "invite adds to household"
  path is replaced by a team-hub-only invite.

## 3. Lifetime ownership model — RECOMMEND OPTION C (requirement #11, #12, #13)
**Option C: the individual USER owns the Lifetime entitlement; it grants Premium to their CURRENT household
(one bound household at a time).**
- Lifetime is account-based (survives reinstall/new device/re-login) — restored automatically on sign-in.
- Only ONE household benefits at a time (`bound_household_id`). Prevents one Lifetime seeding free Premium
  to multiple unrelated families.
Edge cases:
- Lifetime user invites household members → whole household is Premium (up to Premium seat cap) while they remain.
- Lifetime user LEAVES a household → binding moves with the user; the old household reverts to Free
  (re-resolve). No data deleted.
- Household ownership changes → premium follows the entitlement binding, not the owner flag.
- Lifetime user creates a different household → entitlement auto-rebinds to the household they're currently in
  (single active binding).
- Household deleted → entitlement persists on the user, rebinds when they next belong to a household.
- Two Lifetime users in one household → household is Premium (idempotent; both remain Lifetime individually).
- Lifetime user joins a household with an active paid sub → household stays Premium; we surface a notice that
  the paid sub is now redundant and how to cancel via the store (we never claim to cancel it ourselves).
- Paid subscriber later gets Lifetime → Lifetime takes priority in the resolver; we notify them their store sub
  may still renew unless cancelled in the store, with a link to store subscription management.
- Lifetime user accidentally purchases a sub → resolver already shows Lifetime; we detect the redundant active
  sub and show a "you already have Lifetime — manage/cancel your subscription here" notice.
- Attempt to move Lifetime between households → automatic single-binding + audit log; no manual transfer UI.

## 4. Lifetime codes (requirement #9, #10, #17)
New collection `lifetime_codes`:
```
{ id, code_hash (sha256, NOT plaintext), last4 (for admin display),
  status: "available" | "redeemed" | "disabled" | "revoked",
  label, note, expires_at (optional redemption deadline),
  created_by_admin_id, created_at,
  redeemed_by_user_id, redeemed_household_id, redeemed_at }
```
- Codes: cryptographically random (secrets), high entropy, single-use, validated SERVER-SIDE only.
- Stored HASHED (recommend yes). Admin sees label + last4, never the full stored value after generation
  (full plaintext shown once at generation time for distribution).
- Atomic redemption: `find_one_and_update({code_hash, status:"available"}, {status:"redeemed"})` to defeat
  race conditions; rate-limit + lockout on repeated bad attempts (anti-brute-force); users cannot list codes.
- Redemption creates a `lifetime` entitlement + an audit record.

## 5. Redemption experience — RECOMMEND WEB PORTAL (requirement #15) — Apple-verified
- VERIFIED (2026): For FREE lifetime access (no money changes hands), the safest, compliant path is a
  **CheerPlanner website redemption portal** that grants the backend entitlement; the app then reads it.
  This avoids any appearance of an external checkout for digital goods (3.1.1). Apple is phasing out
  legacy IAP promo codes (2026) toward offer codes, which are for paid IAP products — not our free grants.
- Flow: receive code → visit CheerPlanner web portal → sign in → enter code → server validates + grants →
  open app → app auto-recognizes Lifetime Premium.
- In-app: NO code entry field for Lifetime (keeps App Review clean). App only READS entitlement + offers
  "Redeem a code on the web" informational link. Direct admin grants need no code at all.

## 6. Admin system (requirement #10, #11, #18) — phased
- Add `is_admin: bool` to users (seed initial admin via script/env allowlist).
- Admin API (server-side, admin-guarded): search user/household, view premium status + source + history,
  grant Lifetime directly (record user/household/reason/label/note/admin), generate 1..N codes,
  list available/redeemed codes, disable/revoke unused codes, view redemption history + entitlement audit.
- Initial admin UI: a lightweight in-app Admin section (visible only to `is_admin`) covering grants + codes +
  status lookup. Web admin portal + web redemption portal = Phase 3.

## 7. Audit trail (requirement #19)
New collection `entitlement_events` — append-only:
`{id, entitlement_id, action: granted|redeemed|revoked|expired|rebound|purchased, user_id, household_id,
  source, reason, label, admin_id, at, meta}`. Never silently overwrite premium state.

## 8. RevenueCat + Apple IAP (requirement #16, #17, #22) — Phase 2
- General Premium entitlement in RevenueCat (name it e.g. `premium`); products map to it.
- Client uses PUBLIC SDK key only. Secret/webhook auth key stays server-side (backend .env), never in client,
  logs, or responses.
- Identity: RevenueCat `appUserID` = CheerPlanner `user_id` (login-provisioned).
- Sync: RevenueCat webhook → backend → upsert `subscription` entitlement bound to the purchaser's household.
- Household benefit: individual purchase binds to purchaser's current household (like Lifetime binding).
- Restore Purchases supported for subs; Lifetime does NOT depend on Restore (account-based).
- Handle expiration / cancellation / billing-issue grace: webhook updates status; grace keeps access until
  grace end. Offline/service-unreachable: use a short-lived signed cached-entitlement so a transient network
  failure never strips access; re-verify when back online.
- Whether Lifetime lives in RevenueCat: NO — Lifetime is managed exclusively by CheerPlanner backend
  entitlements (RevenueCat only handles store subscriptions). Resolver merges both.

## 9. Free vs Premium — FULL FEATURE SPLIT (requirement #6, #20) — plain list

FREE CHEERPLANNER (parent app — fully useful):
- Athletes, Competitions, Schedule, Calendar
- Expense tracking, Payment tracking, Fundraisers
- Packing lists, Basic in-app reminders + SMS reminders for the account holder's OWN deadlines
- Household: primary + 1 additional = 2 users total, shared/synced
- Limited Team Hub (see below)

PREMIUM CHEERPLANNER (Free + everything below):
- Full Team Hub (all tools, unlimited)
- Advanced roster management (custom columns, expanded fields, bulk ops, sizes/allergies/medical/host-bonding)
- Uniform/apparel size tracking, Paperwork tracking, Team payment tracking
- Volunteer/sign-up management, Attendance tracking, Team to-dos
- Spreadsheet import/export (CSV/Excel) across Team Hub
- Shareable parent links, Automated SMS reminders to roster parents (mass reminders)
- Additional household sharing (up to 6 total)
- Future Premium features

## 10. Free vs Premium — TEAM HUB SPLIT (requirement #5, #26.6) — plain list (approve exact split)

FREE TEAM HUB (enough to see the value, not the power):
- Team Hub is VISIBLE and openable (not hidden)
- Create 1 team
- Roster up to 10 people, basic fields only (name, role, contact); NO custom columns, NO expanded
  medical/allergy/host-bonding fields
- 1 Sign-up sheet (create + claim) so they feel the collaboration
- Attendance: view only OR 1 session (proposed: allow 1 session to demo it)
- Team to-dos: 1 list
- NO sizes / paperwork / team-payment trackers (show as locked previews with upgrade CTA)
- NO spreadsheet import/export
- NO shareable parent links
- NO automated/mass SMS reminders
- NO additional Team Hub collaborators (single manager)

PREMIUM TEAM HUB (everything, unlimited):
- Unlimited teams, unlimited roster, custom columns + all expanded fields
- Unlimited sign-up sheets, attendance sessions, to-do lists
- Sizes, paperwork, and team-payment trackers (unlimited)
- Spreadsheet import/export (CSV/Excel)
- Shareable parent links
- Automated/mass SMS reminders to roster parents
- Multiple Team Hub collaborators (separate from household seats)

## 11. Paywall + status screens (requirement #20, #21)
- Free users SEE premium features (locked previews), not hidden. Tapping a locked feature → clean,
  non-intrusive paywall. Existing Free functionality keeps working.
- Paywall shows Monthly $4.99/mo and Annual $39.99/yr (Annual = better value; compute savings % from live
  product prices, never hard-coded), 7-day trial on Annual where applicable. Lifetime users bypass entirely.
- Settings/Account plan card: "CheerPlanner Free" / "Premium — Monthly" / "Premium — Annual" /
  "Premium — Lifetime Access" (Lifetime shows no renewal date; sub shows renewal date).

## 12. Existing users & grandfathering (requirement #24) — DECIDE
- Migration assigns ALL existing users to Free (create Free-tier baseline; no data touched).
- Households currently ABOVE the new Free limit (>2 members): NO members/data are ever deleted.
- RECOMMEND: "grandfather in place" — over-limit households keep ALL current members and full function,
  but cannot ADD a new household member until they either drop under the limit or go Premium.
  (Flag `grandfathered_member_cap = current_count` so they're never worse off.)

## 13. Analytics (requirement #25) — Phase 3, privacy-conscious
- Event-only, no sensitive cheer-family data: paywall_view, upgrade_tap, trial_start, purchase,
  trial_to_paid, lifetime_grant, code_redeemed, plan_selected(monthly/annual), feature_gate_hit(feature).
- No PII beyond an anonymous user/household id. Present exact event list before adding.

## 14. What I need FROM YOU (requirement #24)
- Phase 1 (no store): nothing — I can build entitlements, gating, admin, codes, web redemption with placeholders.
- Phase 2 (RevenueCat/Apple): App Store Connect paid-apps agreement active; the RevenueCat PUBLIC SDK key +
  the RevenueCat webhook/secret (server-side); confirmation of product IDs (below); your Apple account to
  create the products (I'll give exact click-by-click steps).
- Recommended product IDs: `cheerplanner_premium_monthly`, `cheerplanner_premium_annual` in one subscription
  group `CheerPlanner Premium`; RevenueCat entitlement id `premium`; offering `default` with monthly + annual
  packages; 7-day free trial as an introductory offer on the annual product.

## 15. Phasing (requirement #27) — change few systems at a time
- **Phase 0 — Foundation (safe, invisible)**: entitlements + resolver + config + migration (everyone Free,
  NOTHING blocked yet) + audit collection. Ship + verify no regressions.
- **Phase 1 — Gating + Admin + Lifetime (no store)**: household/Team-Hub decoupling, feature gates + paywall
  UI (informational), configurable limits + grandfathering, admin (direct grants + code gen/list/disable),
  hashed single-use codes, web redemption portal, status screen, audit.
- **Phase 2 — Subscriptions**: RevenueCat + Apple IAP, purchase/restore, webhook→entitlement, grace/expiry,
  cached-entitlement offline safety, TestFlight sandbox testing.
- **Phase 3 — Polish**: analytics, Google Play, promo offers, web admin portal.

## 16. TestFlight testing (requirement #25 of #26)
- Sandbox testers in App Store Connect; sign in with sandbox Apple ID; verify monthly/annual purchase,
  7-day trial, restore, expiration (accelerated sandbox renewals), cancellation, billing-retry/grace, and
  Lifetime-coexists-with-sub notices — all before production release.
