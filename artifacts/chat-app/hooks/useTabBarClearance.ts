import { Platform } from "react-native";

/**
 * Height of the classic tab bar on web, where the navigator does not size the
 * bar for us, so app/(tabs)/_layout.tsx sets it explicitly.
 */
export const WEB_TAB_BAR_HEIGHT = 84;

/**
 * Height React Navigation gives the classic tab bar on native.
 *
 * The navigator would normally add the bottom safe-area inset on top of this,
 * but the app-wide footer below the navigator owns that inset instead, so
 * app/(tabs)/_layout.tsx passes `safeAreaInsets={{ bottom: 0 }}`.
 *
 * React Navigation sizes the bar from a constant of its own, so this number has
 * to stay at least as large. __tests__/NavigatorTabBarHeight.test.tsx and
 * __tests__/NavigatorTabBarHeight.test.android.tsx render the real navigator on
 * each platform and fail here if an upgrade makes either bar taller.
 */
export const NATIVE_TAB_BAR_HEIGHT = 64;

/**
 * Bottom room a tab screen must reserve for the classic tab bar.
 *
 * On Android, pre-iOS-26 and web the app falls back to the classic tab bar,
 * which is absolutely positioned so the iOS blur can show content behind it.
 * The bar therefore floats over every tab screen, and each screen's scrollable
 * content has to reserve room for it or its last control stays hidden behind
 * the bar at maximum scroll. (The liquid-glass `NativeTabs` branch handles
 * this itself.)
 *
 * The device's bottom inset is deliberately not part of this: the bar sits
 * above the app-wide footer, which is what clears the home indicator and the
 * Android gesture bar.
 *
 * @param extraSpacing Visual gap to leave between the content and the bar.
 * @returns The tab bar height plus the gap.
 */
export function useTabBarClearance(extraSpacing = 0): number {
  const tabBarHeight =
    Platform.OS === "web" ? WEB_TAB_BAR_HEIGHT : NATIVE_TAB_BAR_HEIGHT;

  return tabBarHeight + extraSpacing;
}
