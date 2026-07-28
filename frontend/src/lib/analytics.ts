import { Platform } from "react-native";
import { api } from "@/src/api/client";

/**
 * Privacy-conscious analytics. Fire-and-forget; never blocks the UI and never
 * sends personal/cheer-family data — only an allowlisted event name + a few
 * non-sensitive props (plan, feature, platform).
 */
export type AnalyticsEvent =
  | "paywall_view"
  | "upgrade_tap"
  | "plan_selected"
  | "trial_start"
  | "purchase_success"
  | "restore_tap"
  | "feature_gate_hit"
  | "code_redeemed";

export function track(name: AnalyticsEvent, props: Record<string, string> = {}) {
  try {
    api.post("/analytics/event", { name, props: { platform: Platform.OS, ...props } }).catch(() => {});
  } catch {
    // never throw from analytics
  }
}
