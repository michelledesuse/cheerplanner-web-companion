import axios, { AxiosInstance } from "axios";
import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import { storage } from "@/src/utils/storage";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export const TOKEN_KEY = "ct_auth_token";

export const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  const token = await storage.secureGet<string>(TOKEN_KEY, "");
  if (token && typeof token === "string") {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// Premium gate (402): route the user to the upgrade screen instead of failing
// with a confusing error. Detail is "premium_required:<feature>" or
// "limit_reached:<key>". Throttled so rapid calls don't stack prompts.
let lastPaywallAt = 0;
api.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error?.response?.status;
    if (status === 402) {
      const now = Date.now();
      if (now - lastPaywallAt > 1200) {
        lastPaywallAt = now;
        const detail: string = error?.response?.data?.detail || "";
        const isLimit = detail.startsWith("limit_reached");
        const title = isLimit ? "Free plan limit reached" : "Premium feature";
        const msg = isLimit
          ? "You've reached the Free plan limit. Upgrade to CheerPlanner Premium for unlimited access."
          : "This is a CheerPlanner Premium feature. Upgrade to unlock it.";
        Alert.alert(title, msg, [
          { text: "Not now", style: "cancel" },
          { text: "See Premium", onPress: () => { try { router.push("/premium" as any); } catch {} } },
        ]);
      }
    }
    return Promise.reject(error);
  }
);
