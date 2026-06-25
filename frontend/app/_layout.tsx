import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/AuthContext";
import { ThemeProvider, useTheme } from "@/src/context/ThemeContext";
import { colors } from "@/src/theme";

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

/**
 * Theme-reactive Stack. Subscribes to `version` from ThemeContext so the
 * navigation container re-paints (new content backgroundColor + child remount)
 * whenever the user picks a new theme in Settings → Appearance.
 *
 * The `key={version}` triggers a full subtree remount on theme change, which
 * is heavy-handed but guarantees every screen — even ones cached by
 * expo-router — picks up the new palette immediately.
 */
function ThemedStack() {
  const { version } = useTheme();
  return (
    <Stack
      key={version}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider>
          <ThemedStack />
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
