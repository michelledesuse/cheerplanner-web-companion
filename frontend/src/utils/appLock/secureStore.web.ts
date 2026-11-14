/**
 * App Lock secure storage — web.
 *
 * Browsers have no Keychain, so values are encrypted with AES-GCM using a
 * NON-EXTRACTABLE CryptoKey generated in this browser and kept in IndexedDB.
 * Page scripts can use the key but can never read its raw bytes, and nothing
 * goes to localStorage. Clearing the site's data deletes the key and the
 * record, which turns App Lock off (the user is told this when enabling it).
 */
const DB = "cheerplanner-applock";
const STORE = "kv";
const KEY_ID = "__wrap_key__";

export const secureStoreKind = "browser" as const;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

async function wrapKey(create: boolean): Promise<CryptoKey | null> {
  const existing = await tx<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID));
  if (existing || !create) return existing || null;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await tx("readwrite", (s) => s.put(key, KEY_ID));
  return key;
}

export async function getItem(key: string): Promise<string | null> {
  try {
    const rec = await tx<{ iv: Uint8Array; ct: ArrayBuffer } | undefined>("readonly", (s) => s.get(key));
    if (!rec) return null;
    const k = await wrapKey(false);
    if (!k) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv as BufferSource }, k, rec.ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  const k = (await wrapKey(true)) as CryptoKey;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(value));
  await tx("readwrite", (s) => s.put({ iv, ct }, key));
}

export async function deleteItem(key: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(key));
  } catch {
    /* already gone */
  }
}
