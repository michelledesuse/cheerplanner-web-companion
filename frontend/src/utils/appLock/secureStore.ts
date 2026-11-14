/**
 * App Lock secure storage — native. iOS Keychain / Android Keystore-backed
 * storage via expo-secure-store, restricted to this device and only readable
 * while the device is unlocked (never synced to iCloud / backups).
 */
import * as SecureStore from "expo-secure-store";

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStoreKind = "keychain" as const;

export async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, OPTS);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTS);
}

export async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, OPTS);
  } catch {
    /* already gone */
  }
}
