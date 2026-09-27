import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useColors } from "@/hooks/useColors";

/** Breathing room above the copyright line, and below it when there is no inset. */
export const FOOTER_VERTICAL_PADDING = 8;

export function AppFooter() {
  const colors = useColors();
  const currentYear = new Date().getFullYear();

  // The footer is the bottom-most element of the app, below the navigator, so
  // it owns the device's bottom inset: the iOS home indicator and the Android
  // gesture/navigation bar. Padding by the inset keeps the copyright line
  // clear of that strip. The inset is 0 on web, so web layout is unchanged.
  const paddingBottom = useBottomClearance({
    source: "device",
    minimum: FOOTER_VERTICAL_PADDING,
  });

  return (
    <View
      testID="app-footer"
      style={[
        styles.footer,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom,
        },
      ]}
    >
      <Text style={[styles.text, { color: colors.mutedForeground }]}>
        © {currentYear}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: FOOTER_VERTICAL_PADDING,
  },
  text: {
    fontSize: 11,
    textAlign: "center",
  },
});
