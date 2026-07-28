import { useEffect } from "react";
import { View, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import MarketingHome from "@/src/components/MarketingHome";

export default function Index() {
  const styles = useThemedStyles(makeStyles);
  const { user, loading } = useAuth();
  const router = useRouter();
  // Logged-out WEB visitors see the marketing homepage (companion website).
  const showMarketing = Platform.OS === "web" && !loading && !user;

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/(tabs)/dashboard");
    else if (Platform.OS !== "web") router.replace("/login"); // native: straight to login
  }, [user, loading, router]);

  if (showMarketing) return <MarketingHome />;

  return (
    <View style={styles.container} testID="splash-screen">
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const makeStyles = () => ({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});
