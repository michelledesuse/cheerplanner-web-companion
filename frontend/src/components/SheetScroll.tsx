import React, { ReactNode } from "react";
import { ScrollView, Dimensions, StyleProp, ViewStyle } from "react-native";

// Caps a popup/sheet body so it never exceeds the screen and always scrolls
// when its content is taller than the available space. Used to guarantee that
// every popup in the app is scrollable.
const MAX_H = Math.round(Dimensions.get("window").height * 0.85);

export function SheetScroll({
  children,
  style,
  contentContainerStyle,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={[{ maxHeight: MAX_H }, style]}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {children}
    </ScrollView>
  );
}
