import { describeWebTabBar, mockColors } from "../test-support/webTabBar";

/**
 * Renders the classic tab bar the way a browser builds it, and checks the tabs
 * a user sees: the Chats and Profile labels, their Feather icons, the plain
 * view behind the bar and the height the bar is given.
 *
 * jest.config.js sends this file to the project built on `jest-expo/web`:
 * module resolution prefers `.web` sources, `react-native` is aliased to
 * `react-native-web`, and the tree renders into jsdom — the build the Replit
 * preview serves and server/serve.js hands out. __tests__/TabLayout.test.tsx
 * and __tests__/AndroidTabBar.test.android.tsx cover the same layout as the
 * two phones build it. test-support/webTabBar.tsx holds the suite and explains
 * what a browser-only regression would otherwise get past.
 *
 * Only what jsdom cannot supply is stood in for here.
 */

/**
 * A browser gets the icon font from the bundler, which registers the file and
 * adds the @font-face rule the glyphs need. Jest has no bundler, so
 * @expo/vector-icons finds no asset to load and draws every icon as an empty
 * box while it waits. Reporting the font as loaded is that bundler's side of
 * the deal, and the glyphs the icons then draw are the real ones.
 */
jest.mock("expo-font", () => {
  const actual = jest.requireActual("expo-font");
  return { ...actual, isLoaded: () => true };
});

/**
 * The app's theme reads the system color scheme and the user's accessibility
 * preferences through a provider this render does not mount, so the suite
 * feeds the layout one fixed palette and asserts the colors against it.
 */
jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

describeWebTabBar();
