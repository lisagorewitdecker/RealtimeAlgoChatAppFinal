import { describeMockedPackageGuard } from "../test-support/moduleContractMockGuard";

/**
 * Shows the unmocked suites' mocked-package check firing on the browser build
 * of the packages it watches.
 *
 * Three of the suites that lean on that check run here:
 * __tests__/ScreenModuleExports.test.web.ts,
 * __tests__/TabLayoutExports.test.web.ts and __tests__/WebTabBar.test.web.tsx,
 * the last of which renders the tab bar a browser draws out of real packages
 * and is the only run of that suite there is. This project resolves
 * differently from the two phone ones — `.web` sources first, `react-native`
 * aliased to react-native-web, jsdom underneath — and the check tells a
 * stand-in from the real module by asking this project for a package twice, so
 * the iOS proof in ModuleContractMockGuard.test.ts says nothing about whether
 * it still works here. test-support/moduleContractMockGuard.ts holds the proof
 * the three entry points share and explains what a project that collapsed
 * those two routes would get past.
 */

/**
 * The packages this run replaces, both of them ones a browser run of those
 * suites reads for real.
 *
 * @expo/vector-icons is the quietest stand-in of the lot: every screen test
 * mocks it, so it is the likeliest to end up mocked somewhere shared, and
 * test-support/webTabBar.tsx names the glyphs a rendered bar drew out of that
 * package's own map — against a stand-in it would name them out of the
 * invented map and pass. expo-blur ships a whole BlurView.web.js, so this
 * project resolves a source no phone run loads, and webTabBar's fill check
 * only tells a blur from a plain view while that source is the real one.
 *
 * A factory keeps each stand-in from being built out of the real module, so
 * the check has two genuinely different modules to tell apart, and both are
 * mocked here and nowhere else — the screen and tab bar tests mock them per
 * file, which is the practice those suites exist to sit outside of.
 */
jest.mock("@expo/vector-icons", () => ({
  Feather: { glyphMap: { "message-circle": 0xe001, user: 0xe002 } },
}));

jest.mock("expo-blur", () => ({ BlurView: () => null }));

describeMockedPackageGuard({
  expectedPlatform: "web",
  mockedPackages: ["@expo/vector-icons", "expo-blur"],
  // Left alone, and read for real by those suites on this platform.
  // react-native is the entry that proves the alias: jest.config.js maps it to
  // react-native-web for this project, and the check only passes it while both
  // routes follow that map to one module. expo-glass-effect is what answers
  // false in a browser and so sends the app down the classic tab bar branch
  // test-support/webTabBar.tsx renders.
  realPackages: ["react-native", "expo-glass-effect"],
});
