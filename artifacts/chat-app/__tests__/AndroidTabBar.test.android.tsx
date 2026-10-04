import React from "react";
import { render } from "@testing-library/react-native";
import { Platform } from "react-native";

import TabLayout from "../app/(tabs)/_layout";
import {
  TABS_ALREADY_SHIPPED,
  registeredTabScreens,
} from "../test-support/tabScreens";

/**
 * Covers the ClassicTabLayout branch as Android builds it, guarding what a
 * phone actually shows: Feather icons, theme tints, the opaque themed bar, a
 * style that leaves the bar height to the navigator, and the bottom inset
 * handed to the app-wide footer below the navigator. TabLayout.test.tsx checks
 * which branch is picked and what each one registers under jest's default
 * platform, and is unaffected by this file.
 *
 * The tabs are not listed here by hand. expo-router turns every route in
 * app/(tabs)/ into a tab whether or not _layout.tsx names it — a file,
 * profile.tsx, or a folder holding an index route, profile/index.tsx — so
 * this file checks whatever that directory holds (test-support/tabScreens.ts
 * finds both shapes) and requires the classic branch to register every tab it
 * finds, with a title and an icon Android can draw: a tab added later is
 * checked without anyone remembering to come back here, and an unregistered
 * one fails under its own name.
 *
 * jest.config.js sends this file to a second project built on
 * `jest-expo/android`: module resolution prefers `.android` sources, sources
 * are transformed for Android, and `Platform.OS` is `android` throughout —
 * including inside React Native's own `Platform.select`. Spoofing
 * `Platform.OS` on the default (iOS) project would only redirect the app's own
 * runtime reads, leaving everything the Expo SDK and React Navigation ship
 * specifically for Android out of the run.
 */

const mockColors = {
  background: "#0E1118",
  foreground: "#F4F6FA",
  mutedForeground: "#9AA4B5",
  card: "#171B24",
  border: "#343D4C",
  primary: "#5AA5FA",
  primaryForeground: "#FFFFFF",
  radius: 12,
};

type ScreenOptions = {
  tabBarActiveTintColor: string;
  tabBarInactiveTintColor: string;
  headerShown: boolean;
  tabBarStyle: Record<string, unknown>;
  tabBarBackground: () => React.ReactNode;
};

type NavigatorSafeAreaInsets = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type ScreenRegistration = {
  name: string;
  // A screen can be registered with no options at all, or with options that
  // leave out the title or the icon; that is the shipping gap these checks
  // exist to catch, so the capture types them as optional.
  options?: {
    title?: string;
    tabBarIcon?: (props: { color: string }) => React.ReactElement | null;
  };
};

const mockCaptured: {
  screenOptions: ScreenOptions | null;
  safeAreaInsets: NavigatorSafeAreaInsets | undefined;
  screens: ScreenRegistration[];
} = { screenOptions: null, safeAreaInsets: undefined, screens: [] };

jest.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => false,
}));

jest.mock("expo-router/unstable-native-tabs", () => {
  const NativeTabs = () => null;
  NativeTabs.Trigger = () => null;
  return { NativeTabs };
});

jest.mock("expo-router", () => {
  const ReactModule = require("react");
  const Tabs = ({
    screenOptions,
    safeAreaInsets,
    children,
  }: {
    screenOptions: ScreenOptions;
    safeAreaInsets?: NavigatorSafeAreaInsets;
    children: React.ReactNode;
  }) => {
    mockCaptured.screenOptions = screenOptions;
    mockCaptured.safeAreaInsets = safeAreaInsets;
    return ReactModule.createElement(ReactModule.Fragment, null, children);
  };
  Tabs.Screen = (registration: ScreenRegistration) => {
    mockCaptured.screens.push(registration);
    return null;
  };
  return { Tabs, Icon: () => null, Label: () => null };
});

jest.mock("expo-blur", () => ({
  BlurView: () => null,
}));

jest.mock("expo-symbols", () => ({
  SymbolView: ({ name }: { name: string }) => {
    const RN = require("react-native");
    return require("react").createElement(
      RN.Text,
      { testID: `symbol-${name}` },
      name,
    );
  },
}));

jest.mock("@expo/vector-icons", () => ({
  Feather: ({ name, color, size }: { name: string; color: string; size: number }) => {
    const RN = require("react-native");
    return require("react").createElement(
      RN.Text,
      { testID: `icon-${name}`, style: { color, fontSize: size } },
      name,
    );
  },
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

const tabScreens = registeredTabScreens();

function renderTabLayout() {
  render(<TabLayout />);
  const { screenOptions, screens } = mockCaptured;
  if (!screenOptions) {
    throw new Error(
      "ClassicTabLayout did not render the classic Tabs navigator",
    );
  }
  return { screenOptions, screens };
}

/** One tab's registered title, looked up by name so a new tab cannot shift it. */
function titleOf(
  screens: ScreenRegistration[],
  route: string,
): string | undefined {
  return screens.find((screen) => screen.name === route)?.options?.title;
}

/** Draws one tab's icon the way the bar draws it, failing by name if it has none. */
function renderTabIcon(
  screens: ScreenRegistration[],
  route: string,
  color: string,
) {
  const tabBarIcon = screens.find((screen) => screen.name === route)?.options
    ?.tabBarIcon;

  if (!tabBarIcon) {
    throw new Error(
      `app/(tabs)/${route} has no <Tabs.Screen> with a tabBarIcon in ` +
        "ClassicTabLayout, so this check cannot draw its icon",
    );
  }

  const element = tabBarIcon({ color });
  if (element === null) {
    throw new Error(
      `app/(tabs)/${route} registers a tabBarIcon that draws nothing, so ` +
        "this check cannot inspect its icon",
    );
  }

  return render(element);
}

/** What a tab the layout titles and gives an Android icon reads as. */
function registeredReport(route: string): string {
  return `app/(tabs)/${route} has a <Tabs.Screen> with a title and a Feather icon`;
}

function registrationReport(
  route: string,
  screens: ScreenRegistration[],
): string {
  const screen = screens.find((candidate) => candidate.name === route);
  if (!screen) {
    return (
      `app/(tabs)/${route} has no <Tabs.Screen> in ClassicTabLayout — ` +
      "expo-router ships every route in app/(tabs)/ as a tab, so this one " +
      `reaches the Android bar with no icon and "${route}" as its label`
    );
  }

  const missing: string[] = [];

  const { title, tabBarIcon } = screen.options ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    missing.push("no title");
  }

  if (!tabBarIcon) {
    missing.push("no tabBarIcon");
  } else {
    // An icon that returns nothing cannot be handed to the renderer at all,
    // so the empty cases are settled before rendering the ones that draw.
    const element = tabBarIcon({ color: mockColors.primary });
    const icon = element == null ? null : render(element);
    if (!icon || icon.toJSON() === null) {
      missing.push("a tabBarIcon that draws nothing");
    } else if (icon.queryByTestId(/^symbol-/)) {
      // SF Symbols are an iOS drawing API; on Android the tab would be blank.
      missing.push("an SF Symbol Android cannot draw");
    }
  }

  return missing.length === 0
    ? registeredReport(route)
    : `app/(tabs)/${route} has a <Tabs.Screen> with ${missing.join(" and ")}`;
}

describe("classic tab layout on Android", () => {
  beforeEach(() => {
    mockCaptured.screenOptions = null;
    mockCaptured.safeAreaInsets = undefined;
    mockCaptured.screens = [];
  });

  it("runs on the platform this file exists to measure", () => {
    // Everything below only describes Android while this file's project in
    // jest.config.js keeps targeting Android. If that stopped being true the
    // suite would still run, against the wrong platform's tab bar.
    expect(`the suite is running on ${Platform.OS}`).toBe(
      "the suite is running on android",
    );
  });

  it("registers one tab per screen file, with the shipped tabs in order", () => {
    const { screens } = renderTabLayout();
    const registered = screens.map((screen) => screen.name);

    // Every per-tab check below passes vacuously if the directory read finds
    // nothing, so this is a floor for the discovery, not the list under test.
    expect(tabScreens).toEqual(expect.arrayContaining(TABS_ALREADY_SHIPPED));
    // Sorted both sides: a screen naming a route with no file registers a tab
    // the app cannot open, and belongs in this comparison too.
    expect([...registered].sort()).toEqual(tabScreens);
    // The bar's own order, which the directory listing cannot express.
    expect(
      registered.filter((route) => TABS_ALREADY_SHIPPED.includes(route)),
    ).toEqual(TABS_ALREADY_SHIPPED);
  });

  it.each(tabScreens)(
    "gives app/(tabs)/%s a title and an icon Android can draw",
    (route) => {
      const { screens } = renderTabLayout();

      expect(registrationReport(route, screens)).toBe(registeredReport(route));
    },
  );

  it("labels both tabs and draws the Feather icons Android ships with", () => {
    const { screens } = renderTabLayout();

    expect(
      TABS_ALREADY_SHIPPED.map((route) => titleOf(screens, route)),
    ).toEqual(["Chats", "Profile"]);

    const chats = renderTabIcon(screens, "index", mockColors.primary);
    expect(chats.getByTestId("icon-message-circle")).toBeTruthy();
    expect(chats.queryByTestId("symbol-message.circle")).toBeNull();

    const profile = renderTabIcon(
      screens,
      "profile",
      mockColors.mutedForeground,
    );
    expect(profile.getByTestId("icon-user")).toBeTruthy();
    expect(profile.queryByTestId("symbol-person.circle")).toBeNull();
  });

  it("tints the icons with the color the tab bar reports for each state", () => {
    const { screenOptions, screens } = renderTabLayout();

    expect(screenOptions.tabBarActiveTintColor).toBe(mockColors.primary);
    expect(screenOptions.tabBarInactiveTintColor).toBe(
      mockColors.mutedForeground,
    );

    const active = renderTabIcon(screens, "index", mockColors.primary);
    expect(active.getByTestId("icon-message-circle").props.style.color).toBe(
      mockColors.primary,
    );

    const inactive = renderTabIcon(
      screens,
      "profile",
      mockColors.mutedForeground,
    );
    expect(inactive.getByTestId("icon-user").props.style.color).toBe(
      mockColors.mutedForeground,
    );
  });

  it("paints an opaque themed bar instead of the iOS blur", () => {
    const { screenOptions } = renderTabLayout();

    expect(screenOptions.tabBarStyle.backgroundColor).toBe(
      mockColors.background,
    );
    expect(screenOptions.tabBarStyle.borderTopColor).toBe(mockColors.border);
    expect(screenOptions.tabBarBackground()).toBeNull();
  });

  it("leaves height and bottom padding to the navigator so it sizes the bar", () => {
    const { screenOptions } = renderTabLayout();

    expect(screenOptions.tabBarStyle.height).toBeUndefined();
    expect(screenOptions.tabBarStyle.paddingBottom).toBeUndefined();
  });

  it("hands the gesture bar inset to the app-wide footer below the navigator", () => {
    renderTabLayout();

    // Without this the navigator pads the bar by the inset a second time,
    // leaving a dead gap between the tab bar and the footer.
    expect(mockCaptured.safeAreaInsets?.bottom).toBe(0);
  });
});
