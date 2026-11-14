/**
 * App Lock key derivation — native (iOS / Android).
 *
 * PBKDF2-HMAC-SHA256 with a per-passcode random 16-byte salt (pure JS via
 * @noble/hashes, so it runs in Expo Go and Hermes). The derived key is what we
 * keep in the Keychain / Keystore — never the passcode itself. The iteration
 * count is stored alongside the hash so it can be raised later without
 * breaking existing passcodes.
 */
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as Crypto from "expo-crypto";

// Tuned for Hermes on mid-range phones (~0.5–1s). Offline guessing is further
// limited by the Keychain/Keystore protecting the record itself.
export const DEFAULT_ITERATIONS = 30000;

export function randomSalt(): Uint8Array {
  return Crypto.getRandomBytes(16);
}

export async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, new TextEncoder().encode(pin), salt, { c: iterations, dkLen: 32 });
}
