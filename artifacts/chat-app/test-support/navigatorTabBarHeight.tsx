import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "expo-router/js-tabs";
import { fireEvent, renderRouter } from "expo-router/testing-library";

import TabLayout from "../app/(tabs)/_layout";
import { useTabBarClearance } from "../hooks/useTabBarClearance";

/**
 * Ties the room tab screens reserve for the classic tab bar to the height
 * React Navigation actually gives that bar.
 *
 * `useTabBarClearance` reserves a fixed number (`NATIVE_TAB_BAR_HEIGHT` /
 * `WEB_TAB_BAR_HEIGHT`) while the navigator sizes the bar from its own internal
 * constant plus whatever bottom inset it is handed. TabBarClearance.test.tsx
 * checks the screens against the app's constant, so both sides of that
 * comparison move together: a React Navigation or Expo SDK upgrade that grew
 * the bar past the reserved room would leave every test green while the last
 * control on Chats and Profile slid back under the bar on a phone.
 *
 * `describeNavigatorTabBarHeight` mounts the app's own `app/(tabs)/_layout.tsx`
 * in a real router, with probe screens standing in for Chats and Profile, and
 * compares the reserved clearance against the height that live navigator
 * produces — both the height it reports to its screens and the height it
 * paints. It fails when the library's bar grows, and equally when the layout
 * stops handing the bottom inset to the app-wide footer, which would add that
 * inset back into the bar.
 *
 * A jest run resolves modules and transforms sources for a single platform, so
 * one run can only measure one platform's bar — and React Navigation has
 * shipped platform-specific bar metrics before, while the classic bar is the
 * Android bar in production. The suite therefore lives here and runs twice:
 * __tests__/NavigatorTabBarHeight.test.tsx under jest's default iOS project and
 * __tests__/NavigatorTabBarHeight.test.android.tsx under the android project in
 * jest.config.js. Both measure what the library builds for their own platform,
 * so an Android-only bar change cannot hide behind a green iOS run, and the
 * failure names the platform that grew.
 *
 * Only the classic bar needs this: the liquid-glass `NativeTabs` branch keeps
 * its own content clear, so both entry points pin `isLiquidGlassAvailable` to
 * false. docs/tab-bar-clearance-check.md holds the matching phone procedure.
 */

/** An iPhone-sized bottom inset, which the app-wide footer owns, not the bar. */
const PHONE_FRAME = { x: 0, y: 0, width: 402, height: 874 };
const PHONE_INSETS = { top: 59, left: 0, right: 0, bottom: 34 };

const clearanceConstant =
  Platform.OS === "web" ? "WEB_TAB_BAR_HEIGHT" : "NATIVE_TAB_BAR_HEIGHT";

/** Theme both entry points feed the layout through their `useColors` mock. */
export const mockColors = {
  background: "#0E1118",
  foreground: "#F4F6FA",
  mutedForeground: "#9AA4B5",
  card: "#171B24",
  border: "#343D4C",
  primary: "#5AA5FA",
  primaryForeground: "#FFFFFF",
  radius: 12,
};

type RenderResult = ReturnType<typeof renderRouter>;
type TestElement = ReturnType<RenderResult["UNSAFE_getByProps"]>;

/** What a tab screen reserves, and what the navigator tells it to reserve. */
const observed: {
  reserved?: number;
  reported?: number;
  bottomInset?: number;
} = {};

function ProbeTabScreen() {
  observed.reserved = useTabBarClearance();
  observed.reported = useBottomTabBarHeight();
  observed.bottomInset = useSafeAreaInsets().bottom;
  return null;
}

/**
 * Mounts the app's tab layout and hands the tree a phone-sized safe area.
 *
 * expo-router's test root installs a safe-area provider whose insets are all
 * zero, so the inset has to arrive the way a device delivers it: through that
 * provider's own change event. Without it the bar could never be too tall for
 * the wrong reason, and the inset half of this guard would quietly do nothing.
 */
function renderTabNavigator(): RenderResult {
  const view = renderRouter(
    {
      "(tabs)/_layout": TabLayout,
      "(tabs)/index": ProbeTabScreen,
      "(tabs)/profile": ProbeTabScreen,
    },
    { initialUrl: "/" },
  );

  const safeAreaProviders = view.root.findAll(
    (node) => typeof node.props.onInsetsChange === "function",
  );
  const provider = safeAreaProviders.at(-1);
  if (!provider) {
    throw new Error(
      "No safe-area provider in the rendered tree accepts an insets change, " +
        "so this test can no longer put the navigator on a phone-sized screen",
    );
  }

  fireEvent(provider, "insetsChange", {
    nativeEvent: { frame: PHONE_FRAME, insets: PHONE_INSETS },
  });

  if (observed.bottomInset !== PHONE_INSETS.bottom) {
    throw new Error(
      `The tab screens see a bottom inset of ${String(observed.bottomInset)}, ` +
        `not the ${PHONE_INSETS.bottom} this test applied: the navigator is no ` +
        "longer reading the inset this test controls",
    );
  }

  return view;
}

/**
 * The height the rendered bar occupies: React Navigation puts it on the view
 * holding the tab list, merged with the app's own `tabBarStyle`.
 */
function paintedBarHeight(view: RenderResult): number {
  const tabList = view.UNSAFE_getByProps({ role: "tablist" });

  for (
    let ancestor: TestElement | null = tabList.parent;
    ancestor;
    ancestor = ancestor.parent
  ) {
    const height = StyleSheet.flatten(ancestor.props.style)?.height;
    if (typeof height === "number") {
      return height;
    }
  }

  throw new Error(
    "No ancestor of the tab list sets a numeric height, so the navigator no " +
      "longer sizes its bar the way this test measures it and this test needs " +
      "updating before it can guard the clearance again",
  );
}

/** What a covered bar reads as, naming the platform this run measured. */
function coveredReport(bar: string): string {
  return `the reserved clearance covers ${bar} on ${Platform.OS}`;
}

function clearanceReport(
  reserved: number,
  barHeight: number,
  bar: string,
): string {
  if (reserved >= barHeight) {
    return coveredReport(bar);
  }
  return (
    `the reserved clearance is ${reserved}dp but ${bar} on ${Platform.OS} is ` +
    `${barHeight}dp — raise ${clearanceConstant} in hooks/useTabBarClearance.ts ` +
    `to at least ${barHeight}`
  );
}

function reservedClearance(): number {
  const { reserved } = observed;
  if (reserved === undefined) {
    throw new Error("The probe tab screen never rendered inside the navigator");
  }
  return reserved;
}

/**
 * Registers the clearance-versus-navigator comparison for one platform.
 *
 * @param expectedPlatform The platform the calling file's jest project targets.
 */
export function describeNavigatorTabBarHeight(
  expectedPlatform: "android" | "ios",
): void {
  describe(`the reserved tab bar clearance covers the navigator's own bar on ${expectedPlatform}`, () => {
    beforeEach(() => {
      delete observed.reserved;
      delete observed.reported;
      delete observed.bottomInset;
    });

    it("runs on the platform this file exists to measure", () => {
      // Each entry point only measures another platform's bar if its project
      // in jest.config.js keeps targeting the platform it was written for. A
      // project that quietly stopped doing so would leave two runs measuring
      // the same bar, and both would still pass.
      expect(`the suite is running on ${Platform.OS}`).toBe(
        `the suite is running on ${expectedPlatform}`,
      );
    });

    it("reserves at least the height the navigator reports to its screens", () => {
      renderTabNavigator();

      const { reported } = observed;
      if (reported === undefined) {
        throw new Error("The navigator reported no tab bar height");
      }

      const bar = "the bar height the navigator reports";
      expect(clearanceReport(reservedClearance(), reported, bar)).toBe(
        coveredReport(bar),
      );
    });

    it("reserves at least the height the navigator paints the bar", () => {
      const view = renderTabNavigator();

      const bar = "the bar the navigator paints";
      expect(
        clearanceReport(reservedClearance(), paintedBarHeight(view), bar),
      ).toBe(coveredReport(bar));
    });
  });
}
