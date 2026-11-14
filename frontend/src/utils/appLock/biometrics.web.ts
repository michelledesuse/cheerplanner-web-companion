/** Biometrics aren't offered on web — the 6-digit passcode is used. */
export async function biometricSupport(): Promise<{ available: boolean; label: string }> {
  return { available: false, label: "Biometrics" };
}

export async function biometricAuthenticate(_prompt: string): Promise<boolean> {
  return false;
}
