# RevenueCat — connected (not Emergent-provisioned) — 2026-09-29

## Current state
- Emergent OAuth connection: connection_state=connected, project_state=connected, rc_project_id=proj24890ce0
- IMPORTANT: `/setup` has NOT been run. The live app ships against its OWN pre-existing RevenueCat
  project/keys (frontend env `EXPO_PUBLIC_REVENUECAT_IOS_SDK_KEY`), entitlement identifier "premium",
  with REAL paying subscribers. Running `/setup` (provisions a `pro` entitlement + `default` offering +
  new Test/Apple/Play products) or swapping SDK keys could point the app at a DIFFERENT project than the
  one customers subscribed under → would break live billing. Do NOT run /setup or swap keys without the
  user's explicit decision to migrate.
- app.json: ios bundle=com.desuse.cheerplanner, android package=com.desuse.cheerplannerv1

## Architecture (as built, pre-Emergent-managed)
- Backend has an entitlements collection + RevenueCat webhook (routers/revenuecat_webhook.py) + /premium/status.
  Premium was gated on the backend flag. Webhook GRANTs on INITIAL_PURCHASE/RENEWAL/UNCANCELLATION/
  PRODUCT_CHANGE/NON_RENEWING_PURCHASE; it DROPS TRANSFER and unknown app_user_id (silent no-op) — root
  cause of "paid but locked" when a purchase happens before logIn (anonymous ID) or a webhook is missed.

## Fix applied 2026-09-29 (safe, additive, no billing config change)
- Frontend now ALSO honors the RevenueCat SDK entitlement on-device as source of truth:
  src/lib/revenuecat.ts: getPremiumEntitlementActive(), addPremiumStatusListener().
  src/context/PremiumContext.tsx: isPremium = backend is_premium OR sdkPremium (entitlements.active["premium"]).
  logIn(user.id) already runs on every auth path (AuthContext). No-ops on web/Expo Go.
- Effect: a genuine subscriber is unlocked on their device regardless of webhook delivery. Requires a new build/redeploy to reach users.

## Open decision for user
- Whether to migrate to the Emergent-managed RevenueCat model (client-side-only gating, run /setup).
  This is a larger migration touching live subscribers and must be a deliberate, separate effort.
