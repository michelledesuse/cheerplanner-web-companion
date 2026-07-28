# CheerPlanner — RevenueCat + Apple IAP setup (Phase 2)

Code is DONE. To make purchases actually work you must (1) set up App Store Connect,
(2) set up RevenueCat, (3) give me 2 keys, (4) generate a native build.

## A. App Store Connect (developer.apple.com → App Store Connect)
1. Apps → CheerPlanner → In-App Purchases / Subscriptions → create ONE Subscription Group
   named "CheerPlanner Premium".
2. In that group create TWO auto-renewable subscriptions (product IDs must match exactly):
   - `cheerplanner_premium_monthly`  — duration 1 month — $4.99
   - `cheerplanner_premium_annual`   — duration 1 year  — $39.99
   (Both MUST be in the same subscription group.)
3. On the ANNUAL product: add Introductory Offer → Free Trial → 1 Week (= 7-day trial).
4. Fill required localization + review screenshot; products can stay "Ready to Submit" for sandbox testing.
5. Create Sandbox tester accounts: Users and Access → Sandbox → Testers.

## B. RevenueCat (app.revenuecat.com)
1. Create a Project (e.g. "CheerPlanner").
2. Add an iOS App with your app's bundle identifier.
3. Entitlements → create entitlement with identifier EXACTLY: `premium`.
4. Products → add both App Store products above; attach BOTH to the `premium` entitlement.
5. Offerings → create/confirm an offering with identifier `default`; add two packages:
   Monthly (→ monthly product) and Annual (→ annual product).
6. Integrations → Webhooks → add webhook:
   - URL: https://<your-production-domain>/api/webhooks/revenuecat
   - Set an Authorization header value (a strong random secret you choose).
7. Project settings → API keys → copy the iOS **public** SDK key (starts with `appl_`).

## C. Keys I need from you (where they go)
1. RevenueCat iOS PUBLIC SDK key (`appl_...`)  → frontend/.env EXPO_PUBLIC_REVENUECAT_IOS_SDK_KEY
   (public, safe on client)
2. RevenueCat Webhook Authorization secret     → backend/.env REVENUECAT_WEBHOOK_AUTH
   (SERVER ONLY — never in the client)
Do NOT send me any RevenueCat SECRET API key (sk_...) unless we later need REST v2; keep it private.

## D. What's already built
- Backend: POST /api/webhooks/revenuecat (auth-verified, idempotent, maps app_user_id→user→household,
  handles INITIAL_PURCHASE/RENEWAL/UNCANCELLATION/PRODUCT_CHANGE→active, BILLING_ISSUE→grace,
  CANCELLATION→keep-until-expiry, EXPIRATION→revoke). Updates the household-bound `subscription`
  entitlement so the central resolver stays source of truth. Verified via simulated events.
- Client: react-native-purchases wired. appUserID = CheerPlanner user_id (logIn on auth, logOut on sign-out).
  Paywall loads live offerings + real prices, purchase monthly/annual, Restore Purchases. Lazy/guarded so
  Expo Go + web never touch the native module.
- Lifetime coexists: resolver prioritizes Lifetime > subscription; Lifetime users see a notice if they also
  have an active store sub (redundant, cancel in store).

## E. Testing (native build required — NOT Expo Go/web)
1. Deploy backend to production so the webhook URL is reachable; set REVENUECAT_WEBHOOK_AUTH.
2. Generate an iOS build (Emergent publish) and install via TestFlight.
3. Sign in with a Sandbox Apple ID; buy monthly → verify Premium unlocks + webhook updates DB.
4. Buy annual → verify 7-day trial → renewal. Cancel in sandbox → access persists until expiration.
5. Test Restore Purchases on a second device/reinstall.
