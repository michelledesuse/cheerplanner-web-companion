import { Alert, Share } from "react-native";
import { api } from "@/src/api/client";

type ShareKind = "signup" | "roster" | "sizes";

const MESSAGES: Record<ShareKind, string> = {
  signup: "Sign up to help our team! Open this link (no app needed):",
  roster: "Please add your info to our team roster (no app needed):",
  sizes: "Please enter your sizes for our team (no app needed):",
};

/** Create (or reuse) a public share link and open the native share sheet. */
export async function shareTeamLink(kind: ShareKind, refId?: string): Promise<void> {
  try {
    const res = await api.post<{ token: string }>("/team/share", { kind, ref_id: refId ?? null });
    const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/public/s/${res.data.token}`;
    // Only pass `message` (not `url`) so the link isn't shown twice on iOS.
    await Share.share({ message: `${MESSAGES[kind]}\n${url}` });
  } catch (e: any) {
    Alert.alert("Couldn't create link", e?.response?.data?.detail || "Please try again.");
  }
}
