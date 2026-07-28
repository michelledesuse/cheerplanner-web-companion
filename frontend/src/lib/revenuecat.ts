import { Platform } from "react-native";
import Constants from "expo-constants";

/**
 * RevenueCat client helper (Phase 2 — Apple IAP).
 *
 * The native SDK only works in a DEVELOPMENT/PRODUCTION build — NOT in Expo Go
 * or on web. Everything here is guarded so the app runs fine everywhere; on
 * unsupported runtimes the functions no-op and report "unavailable" so the
 * paywall gracefully falls back to display pricing.
 *
 * Only the PUBLIC iOS SDK key is used here (EXPO_PUBLIC_REVENUECAT_IOS_SDK_KEY).
 * Never put secret/webhook keys in the client.
 */
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_SDK_KEY || "";
const isExpoGo = Constants.appOwnership === "expo";

// Available only on a native build with a configured key (not Expo Go / web).
export const purchasesSupported = Platform.OS !== "web" && !isExpoGo;

let Purchases: any = null;
let configured = false;

function getSdk() {
  if (Purchases) return Purchases;
  try {
    // Lazy require so the native module is never touched on web / Expo Go.
    Purchases = require("react-native-purchases").default;
  } catch {
    Purchases = null;
  }
  return Purchases;
}

export function configureRevenueCat() {
  if (!purchasesSupported || !IOS_KEY) return false;
  const sdk = getSdk();
  if (!sdk) return false;
  try {
    if (!configured) {
      sdk.configure({ apiKey: IOS_KEY });
      configured = true;
    }
    return true;
  } catch {
    return false;
  }
}

export async function loginRevenueCat(userId: string) {
  if (!configureRevenueCat()) return;
  try { await getSdk().logIn(userId); } catch {}
}

export async function logoutRevenueCat() {
  if (!purchasesSupported) return;
  const sdk = getSdk();
  if (!sdk || !configured) return;
  try { await sdk.logOut(); } catch {}
}

export type RCPackage = { identifier: string; product: { title: string; priceString: string }; raw: any };

export async function loadOfferings(): Promise<{ monthly?: RCPackage; annual?: RCPackage } | null> {
  if (!configureRevenueCat()) return null;
  try {
    const offerings = await getSdk().getOfferings();
    const pkgs = offerings?.current?.availablePackages ?? [];
    const out: { monthly?: RCPackage; annual?: RCPackage } = {};
    for (const p of pkgs) {
      const wrapped: RCPackage = { identifier: p.identifier, product: { title: p.product?.title, priceString: p.product?.priceString }, raw: p };
      const t = (p.packageType || "").toUpperCase();
      const id = (p.product?.identifier || "").toLowerCase();
      if (t === "ANNUAL" || id.includes("annual")) out.annual = wrapped;
      else if (t === "MONTHLY" || id.includes("monthly")) out.monthly = wrapped;
    }
    return out;
  } catch {
    return null;
  }
}

export async function purchasePackage(pkg: RCPackage): Promise<{ ok: boolean; cancelled?: boolean }> {
  if (!configureRevenueCat()) return { ok: false };
  try {
    const res = await getSdk().purchasePackage(pkg.raw);
    return { ok: !!res?.customerInfo?.entitlements?.active?.["premium"] };
  } catch (e: any) {
    return { ok: false, cancelled: !!e?.userCancelled };
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!configureRevenueCat()) return false;
  try {
    const info = await getSdk().restorePurchases();
    return !!info?.entitlements?.active?.["premium"];
  } catch {
    return false;
  }
}
