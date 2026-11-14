/**
 * App Lock key derivation — web. Uses the browser's native WebCrypto PBKDF2
 * (SHA-256) with a random 16-byte salt; much faster than JS, so we can afford
 * a far higher iteration count.
 */
export const DEFAULT_ITERATIONS = 310000;

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    256,
  );
  return new Uint8Array(bits);
}
