import {
  describeNavigatorTabBarHeight,
  mockColors,
} from "../test-support/navigatorTabBarHeight";

/**
 * Runs the reserved-clearance guard against the classic tab bar React
 * Navigation builds for Android.
 *
 * The rest of the suite runs on jest-expo's default platform (iOS), so
 * NavigatorTabBarHeight.test.tsx only ever measures the iOS bar. React
 * Navigation has shipped platform-specific bar metrics before, and Android is
 * where the classic bar ships in production, so an Android-only increase would
 * leave that run green while the last control on Chats and Profile slid back
 * under the bar on Android phones.
 *
 * jest.config.js sends this file to a second project built on
 * `jest-expo/android`: module resolution prefers `.android` sources, sources
 * are transformed for Android, and `Platform.OS` is `android` throughout. The
 * navigator therefore builds its Android bar here and the suite measures that,
 * rather than restating the number the iOS run produced.
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

describeNavigatorTabBarHeight("android");
