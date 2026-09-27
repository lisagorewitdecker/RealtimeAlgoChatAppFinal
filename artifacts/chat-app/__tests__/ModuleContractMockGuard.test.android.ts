import { describeMockedPackageGuard } from "../test-support/moduleContractMockGuard";

/**
 * Shows the unmocked suites' mocked-package check firing on the Android build
 * of the packages it watches.
 *
 * Two of the suites that lean on that check run here:
 * __tests__/ScreenModuleExports.test.android.ts and
 * __tests__/TabLayoutExports.test.android.ts, each reading what
 * `jest-expo/android` resolves rather than what the iOS run found. The check
 * tells a stand-in from the real module by asking this project for a package
 * twice, and both routes are this project's own resolution, so the iOS proof
 * in ModuleContractMockGuard.test.ts says nothing about whether it still
 * works here. test-support/moduleContractMockGuard.ts holds the proof the
 * three entry points share and explains what a project that collapsed those
 * two routes would get past.
 *
 * Nothing about Android needs a native module to be answered for here: the
 * four packages below all load their own JavaScript, so unlike the two
 * contracts this file needs no stubbed TurboModule registry.
 */

/**
 * The packages this run replaces, both of them ones an Android run of those
 * two suites reads for real: expo-haptics is on
 * test-support/screenModuleContract.ts's list and expo-blur on
 * test-support/tabLayoutModuleContract.ts's, and both ship platform-specific
 * sources, so Android resolves something the iOS proof never loaded. A factory
 * keeps each stand-in from being built out of the real module, so the check
 * has two genuinely different modules to tell apart.
 *
 * Both are mocked here and nowhere else — the screen and tab bar tests mock
 * them per file, which is the practice those two contracts exist to sit
 * outside of — so neither of them is affected by what this run installs.
 */
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
}));

jest.mock("expo-blur", () => ({ BlurView: () => null }));

describeMockedPackageGuard({
  expectedPlatform: "android",
  mockedPackages: ["expo-haptics", "expo-blur"],
  // Left alone, and read for real by the same two suites on this platform:
  // react-native is the first entry on both contracts' lists, and expo-crypto
  // is on the screen contract's.
  realPackages: ["react-native", "expo-crypto"],
});
