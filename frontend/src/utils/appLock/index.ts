/**
 * App Lock core — device-only passcode handling.
 *
 * - The passcode never leaves this module: it is only fed into the KDF and
 *   compared in constant time. It is never logged, sent to the API, or stored.
 * - Stored record: { salt, hash (PBKDF2 output), iterations, options }.
 * - Wrong attempts are counted in secure storage with escalating delays
 *   (survives restarts) but never lock anyone out permanently — "Forgot
 *   passcode" (sign out + sign back in) is always available.
 */
import { derive, randomSalt, DEFAULT_ITERATIONS } from "./kdf";
import { getItem, setItem, deleteItem, secureStoreKind } from "./secureStore";

const CONFIG_KEY = "cp_applock_v1";
const ATTEMPTS_KEY = "cp_applock_attempts_v1";

export const PIN_LENGTH = 6;
export const TIMEOUT_OPTIONS = [
  { seconds: 0, label: "Immediately" },
  { seconds: 60, label: "After 1 minute" },
  { seconds: 300, label: "After 5 minutes" },
  { seconds: 900, label: "After 15 minutes" },
];
export { secureStoreKind };

export type AppLockOptions = { biometric: boolean; timeout: number; privacy: boolean };
export type AppLockConfig = AppLockOptions & { enabled: true; salt: string; hash: string; iter: number; kdf: "pbkdf2-sha256"; v: 1 };
type Attempts = { fails: number; until: number };

const b64 = {
  enc(u: Uint8Array) {
    let s = "";
    u.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  },
  dec(s: string) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  },
};

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const isValidPin = (pin: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

export async function loadConfig(): Promise<AppLockConfig | null> {
  const raw = await getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return c?.enabled && c.salt && c.hash ? (c as AppLockConfig) : null;
  } catch {
    return null;
  }
}

async function saveConfig(c: AppLockConfig) {
  await setItem(CONFIG_KEY, JSON.stringify(c));
}

/** Set (or replace) the passcode, keeping existing options. */
export async function setPasscode(pin: string, prev?: AppLockConfig | null): Promise<AppLockConfig> {
  if (!isValidPin(pin)) throw new Error("Passcode must be 6 digits");
  const salt = randomSalt();
  const hash = await derive(pin, salt, DEFAULT_ITERATIONS);
  const cfg: AppLockConfig = {
    v: 1, enabled: true, kdf: "pbkdf2-sha256", iter: DEFAULT_ITERATIONS,
    salt: b64.enc(salt), hash: b64.enc(hash),
    biometric: prev?.biometric ?? false, timeout: prev?.timeout ?? 0, privacy: prev?.privacy ?? true,
  };
  await saveConfig(cfg);
  await deleteItem(ATTEMPTS_KEY);
  return cfg;
}

export async function updateOptions(cfg: AppLockConfig, patch: Partial<AppLockOptions>): Promise<AppLockConfig> {
  const next = { ...cfg, ...patch };
  await saveConfig(next);
  return next;
}

/** Fully remove App Lock from this device (passcode record + attempt counter). */
export async function clearAppLock() {
  await deleteItem(CONFIG_KEY);
  await deleteItem(ATTEMPTS_KEY);
}

// ---- rate limiting ---------------------------------------------------------
const FREE_TRIES = 5;
const DELAYS = [30, 60, 300, 900]; // seconds after the 5th, 6th, 7th, 8th+ wrong try

async function loadAttempts(): Promise<Attempts> {
  try {
    const raw = await getItem(ATTEMPTS_KEY);
    const a = raw ? JSON.parse(raw) : null;
    return { fails: Number(a?.fails) || 0, until: Number(a?.until) || 0 };
  } catch {
    return { fails: 0, until: 0 };
  }
}

/** Milliseconds until another attempt is allowed (0 = now). */
export async function retryWaitMs(): Promise<number> {
  const a = await loadAttempts();
  return Math.max(0, a.until - Date.now());
}

export async function resetAttempts() {
  await deleteItem(ATTEMPTS_KEY);
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; waitMs: number; remainingFree: number };

export async function verifyPasscode(pin: string, cfg: AppLockConfig): Promise<VerifyResult> {
  const a = await loadAttempts();
  const wait = a.until - Date.now();
  if (wait > 0) return { ok: false, waitMs: wait, remainingFree: 0 };
  const hash = await derive(pin, b64.dec(cfg.salt), cfg.iter);
  if (equal(hash, b64.dec(cfg.hash))) {
    await deleteItem(ATTEMPTS_KEY);
    return { ok: true };
  }
  const fails = a.fails + 1;
  const delay = fails >= FREE_TRIES ? DELAYS[Math.min(fails - FREE_TRIES, DELAYS.length - 1)] : 0;
  const until = delay ? Date.now() + delay * 1000 : 0;
  await setItem(ATTEMPTS_KEY, JSON.stringify({ fails, until }));
  return { ok: false, waitMs: delay * 1000, remainingFree: Math.max(0, FREE_TRIES - fails) };
}
