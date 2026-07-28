import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/AuthContext";
import { PremiumProvider } from "@/src/context/PremiumContext";
import { RealtimeProvider } from "@/src/context/RealtimeContext";
import { ThemeProvider, useTheme } from "@/src/context/ThemeContext";

// Keep the native splash visible from cold start until icon fonts register.
SplashScreen.preventAutoHideAsync();

// Renders the navigator inside ThemeProvider so the screen background tracks
// the active theme live. react-native-screens captures `contentStyle` once, so
// we also wrap the Stack in a themed View that repaints on every palette change.
function ThemedStack() {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />
    </View>
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
          <PremiumProvider>
            <RealtimeProvider>
              <ThemedStack />
            </RealtimeProvider>
          </PremiumProvider>
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
