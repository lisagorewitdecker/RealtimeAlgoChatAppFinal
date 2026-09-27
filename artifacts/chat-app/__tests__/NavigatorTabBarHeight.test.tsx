import {
  describeNavigatorTabBarHeight,
  mockColors,
} from "../test-support/navigatorTabBarHeight";

/**
 * Runs the reserved-clearance guard against the classic tab bar React
 * Navigation builds for iOS — the platform jest-expo's default project
 * targets, so this is the run that happens with no extra configuration.
 *
 * NavigatorTabBarHeight.test.android.tsx runs the same measurement against the
 * Android bar, which is the one production ships the classic layout to.
 * test-support/navigatorTabBarHeight.tsx holds the suite both share and
 * explains what it guards.
 */

jest.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => false,
}));

jest.mock("expo-blur", () => ({ BlurView: () => null }));

jest.mock("expo-symbols", () => ({ SymbolView: () => null }));

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

describeNavigatorTabBarHeight("ios");
