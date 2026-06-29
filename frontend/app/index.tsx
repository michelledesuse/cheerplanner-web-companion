import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

export default function Index() {
  const styles = useThemedStyles(makeStyles);
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/(tabs)/dashboard");
    else router.replace("/login");
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const makeStyles = () => ({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});
