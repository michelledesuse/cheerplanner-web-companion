import React from "react";
import { View, Image, StyleSheet } from "react-native";

import { BRAND } from "./PinPad";

/** Plain branded cover — shown while App Lock loads and in the app switcher. No app content. */
export default function BrandCover({ children }: { children?: React.ReactNode }) {
  return (
    <View style={s.cover} testID="applock-cover">
      <View style={s.logoWrap}>
        <Image source={require("@/assets/images/cheerplanner-mark.png")} style={s.logo} resizeMode="contain" />
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: BRAND.blue, alignItems: "center", justifyContent: "center", zIndex: 99999, elevation: 99999 },
  logoWrap: { width: 72, height: 72, borderRadius: 20, backgroundColor: BRAND.white, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  logo: { width: 52, height: 52 },
});
