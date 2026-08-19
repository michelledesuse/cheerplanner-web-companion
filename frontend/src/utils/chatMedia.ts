import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { TOKEN_KEY } from "@/src/api/client";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export type UploadedMedia = { media_id: string; kind: "image" | "video" | "audio"; content_type: string; name?: string };

export async function getAuthToken(): Promise<string> {
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  return typeof t === "string" ? t : "";
}

/** Authenticated URL a native <Image>/<Video> or web <img> can load directly. */
export function chatMediaUrl(mediaId: string, token: string): string {
  return `${BASE}/api/team/chat/media/${mediaId}?token=${encodeURIComponent(token)}`;
}

const _KIND_EXT: Record<string, string> = { image: "jpg", video: "mp4", audio: "mp3" };

/**
 * Download/save a chat attachment. On native we fetch it to the cache and open
 * the OS share sheet (Save Image / Save to Files) — no extra permission needed.
 * On web we trigger a normal browser download.
 */
export async function downloadChatMedia(media: { id: string; kind: string; name?: string; content_type?: string }): Promise<void> {
  const token = await getAuthToken();
  const url = chatMediaUrl(media.id, token);
  const raw = (media.name || `cheerplanner-${media.kind}-${media.id}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = /\.[a-z0-9]{2,4}$/i.test(raw) ? raw : `${raw}.${_KIND_EXT[media.kind] || "bin"}`;

  if (Platform.OS === "web") {
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }

  const FS: any = await import("expo-file-system/legacy");
  const Sharing: any = await import("expo-sharing");
  const dest = `${FS.cacheDirectory}${filename}`;
  const dl = await FS.downloadAsync(url, dest);
  if (dl.status && dl.status >= 400) throw new Error("Couldn't fetch the file.");
  if (!(await Sharing.isAvailableAsync())) throw new Error("Saving isn't available on this device.");
  await Sharing.shareAsync(dl.uri, { mimeType: media.content_type || undefined, dialogTitle: "Save media" });
}

/**
 * Upload a picked asset to the backend (which stores it in Object Storage).
 * Branches web vs native FormData shapes per the storage playbook.
 */
export async function uploadChatMedia(asset: {
  uri: string; mimeType?: string; fileName?: string;
}): Promise<UploadedMedia> {
  const token = await getAuthToken();
  const name = asset.fileName || asset.uri.split("/").pop() || "upload";
  const type = asset.mimeType || guessType(name);

  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri: asset.uri, name, type } as any);
  }

  const res = await fetch(`${BASE}/api/team/chat/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }, // never set Content-Type (boundary)
    body: form,
  });
  if (!res.ok) {
    let detail = "Upload failed.";
    try { detail = (await res.json()).detail || detail; } catch {}
    const err: any = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime",
    mp3: "audio/mpeg", m4a: "audio/m4a", wav: "audio/wav", aac: "audio/aac",
  };
  return map[ext] || "application/octet-stream";
}
