/**
 * Biometric unlock (Face ID / Touch ID / Android biometrics) — native.
 * Uses the OS prompt only; CheerPlanner never sees or stores biometric data.
 */
import * as LocalAuthentication from "expo-local-authentication";

export async function biometricSupport(): Promise<{ available: boolean; label: string }> {
  try {
    const [hw, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const T = LocalAuthentication.AuthenticationType;
    const label = types.includes(T.FACIAL_RECOGNITION) ? "Face ID / Face Unlock"
      : types.includes(T.FINGERPRINT) ? "Touch ID / Fingerprint" : "Biometrics";
    return { available: hw && enrolled, label };
  } catch {
    return { available: false, label: "Biometrics" };
  }
}

export async function biometricAuthenticate(prompt: string): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel: "Use passcode",
      fallbackLabel: "Use device passcode",
      disableDeviceFallback: false, // device passcode is the OS-level fallback
    });
    return r.success;
  } catch {
    return false;
  }
}
