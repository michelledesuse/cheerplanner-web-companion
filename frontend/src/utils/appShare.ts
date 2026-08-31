import { Share, Platform } from "react-native";

/** Public link we invite people to. Update to the App Store URL once published. */
export const APP_SHARE_URL = "https://cheer-planner.com";

const SHARE_MESSAGE =
  "Check out CheerPlanner 📣🎀 — the app that keeps cheer season organized: " +
  "expenses, competition travel, packing lists, schedules & team chat, all in one place. " +
  `Get it here: ${APP_SHARE_URL}`;

/**
 * Opens the OS share sheet so the user can text/email the app to friends.
 * The native share sheet is the "pop-up". Returns true if a share happened.
 */
export async function shareApp(): Promise<boolean> {
  try {
    const result = await Share.share(
      {
        message: SHARE_MESSAGE,
        // iOS shows url separately; Android folds it into message.
        ...(Platform.OS === "ios" ? { url: APP_SHARE_URL } : {}),
        title: "Share CheerPlanner",
      },
      { subject: "You'll love CheerPlanner", dialogTitle: "Share CheerPlanner" }
    );
    return result.action === Share.sharedAction;
  } catch {
    return false;
  }
}
