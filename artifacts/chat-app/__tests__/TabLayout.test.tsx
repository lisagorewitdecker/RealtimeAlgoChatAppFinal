import React from "react";
import { Platform } from "react-native";
import { render, within } from "@testing-library/react-native";

import TabLayout from "../app/(tabs)/_layout";
import {
  TABS_ALREADY_SHIPPED,
  registeredTabScreens,
} from "../test-support/tabScreens";

/**
 * Checks which tab bar the layout builds and what each branch registers.
 *
 * The tabs are not listed here by hand. expo-router turns every route in
 * app/(tabs)/ into a tab whether or not _layout.tsx names it — a file,
 * profile.tsx, or a folder holding an index route, profile/index.tsx — so a
 * tab added without a matching <NativeTabs.Trigger> and <Tabs.Screen> ships
 * with no icon and its route name as its label. This file reads that
 * directory (test-support/tabScreens.ts finds both shapes) and requires both
 * branches to register every tab it finds, with a name and an icon, so an
 * unregistered tab fails under its own name.
 *
 * The named checks pin what the tabs the app ships today look like; the
 * per-tab checks apply to any tab, including ones added later.
 */

const mockIsLiquidGlassAvailable = jest.fn();
const mockActiveTint = "#60BFFF";
const mockColors = {
  background: "#000000",
  foreground: "#FFFFFF",
  mutedForeground: "#CCCCCC",
  border: "#555555",
  primary: mockActiveTint,
  radius: 12,
};

jest.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => mockIsLiquidGlassAvailable(),
}));

jest.mock("expo-router/unstable-native-tabs", () => {
  const mockReact = require("react");
  const RN = require("react-native");

  const NativeTabs = ({ children }: { children?: unknown }) =>
    mockReact.createElement(RN.View, { testID: "native-tabs" }, children);
  NativeTabs.Trigger = ({
    name,
    children,
  }: {
    name: string;
    children?: unknown;
  }) =>
    mockReact.createElement(
      RN.View,
      { testID: `native-tab-${name}` },
      children,
    );

  return { NativeTabs };
});

jest.mock("expo-router", () => {
  const mockReact = require("react");
  const RN = require("react-native");

  const Icon = ({
    sf,
  }: {
    sf: string | { default?: string; selected?: string };
  }) => {
    const symbols = typeof sf === "string" ? { default: sf, selected: sf } : sf;
    return mockReact.createElement(
      RN.Text,
      {
        testID: "trigger-icon",
        defaultSymbol: symbols?.default,
        selectedSymbol: symbols?.selected,
      },
      `${symbols?.default} / ${symbols?.selected}`,
    );
  };

  const Label = ({ children }: { children?: unknown }) =>
    mockReact.createElement(RN.Text, { testID: "trigger-label" }, children);

  const Tabs = ({ children }: { children?: unknown }) =>
    mockReact.createElement(RN.View, { testID: "classic-tabs" }, children);
  Tabs.Screen = ({
    name,
    options,
  }: {
    name: string;
    options?: {
      title?: string;
      tabBarIcon?: (props: {
        color: string;
        focused: boolean;
        size: number;
      }) => unknown;
    };
  }) =>
    mockReact.createElement(
      RN.View,
      { testID: `classic-tab-${name}` },
      mockReact.createElement(
        RN.Text,
        { testID: "screen-title" },
        options?.title,
      ),
      // Wrapped so a screen registered without a tabBarIcon is told apart
      // from one whose icon renders nothing: the first has no wrapper at all,
      // the second an empty one.
      options?.tabBarIcon
        ? mockReact.createElement(
            RN.View,
            { testID: "screen-icon" },
            options.tabBarIcon({
              color: mockActiveTint,
              focused: false,
              size: 24,
            }),
          )
        : null,
    );

  return { Icon, Label, Tabs };
});

jest.mock("expo-symbols", () => {
  const mockReact = require("react");
  const RN = require("react-native");
  return {
    SymbolView: ({ name, tintColor }: { name: string; tintColor?: string }) =>
      mockReact.createElement(
        RN.Text,
        { testID: `symbol-${name}`, tintColor },
        name,
      ),
  };
});

jest.mock("@expo/vector-icons", () => {
  const mockReact = require("react");
  const RN = require("react-native");
  return {
    Feather: ({ name, color }: { name: string; color?: string }) =>
      mockReact.createElement(
        RN.Text,
        { testID: `feather-${name}`, color },
        name,
      ),
  };
});

jest.mock("expo-blur", () => {
  const mockReact = require("react");
  const RN = require("react-native");
  return {
    BlurView: (props: Record<string, unknown>) =>
      mockReact.createElement(RN.View, { testID: "blur-view", ...props }),
  };
});

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

const fallbackIconTestIds =
  Platform.OS === "ios"
    ? { index: "symbol-message.circle", profile: "symbol-person.circle" }
    : { index: "feather-message-circle", profile: "feather-user" };

const tabScreens = registeredTabScreens();

type RenderResult = ReturnType<typeof render>;

/** A branch of the layout, named the way a failure should point at it. */
type Branch = {
  /** The function in app/(tabs)/_layout.tsx that builds this tab bar. */
  layout: string;
  /** What registering a tab in it looks like in that source. */
  element: string;
  /** The testID prefix this file's mock gives each registered tab. */
  testIdPrefix: string;
};

const NATIVE_BRANCH: Branch = {
  layout: "NativeTabLayout",
  element: "<NativeTabs.Trigger>",
  testIdPrefix: "native-tab-",
};

const CLASSIC_BRANCH: Branch = {
  layout: "ClassicTabLayout",
  element: "<Tabs.Screen>",
  testIdPrefix: "classic-tab-",
};

/** The tabs a branch registered, in the order it rendered them. */
function registeredTabs(view: RenderResult, branch: Branch): string[] {
  return view
    .queryAllByTestId(new RegExp(`^${branch.testIdPrefix}`))
    .map((tab) => String(tab.props.testID).slice(branch.testIdPrefix.length));
}

/** What a tab the layout names and gives an icon reads as. */
function registeredReport(route: string, branch: Branch): string {
  return (
    `app/(tabs)/${route} has a ${branch.element} in ${branch.layout} with ` +
    "a name and an icon"
  );
}

function unregisteredReport(route: string, branch: Branch): string {
  return (
    `app/(tabs)/${route} has no ${branch.element} in ${branch.layout} — ` +
    "expo-router ships every route in app/(tabs)/ as a tab, so this one " +
    `reaches the bar with no icon and "${route}" as its label`
  );
}

function incompleteReport(
  route: string,
  branch: Branch,
  missing: string[],
): string {
  return (
    `app/(tabs)/${route} has a ${branch.element} in ${branch.layout} with ` +
    missing.join(" and ")
  );
}

/** Text a tab can actually be read by, rather than an empty or missing one. */
function hasText(element: { props: { children?: unknown } } | null): boolean {
  const text = element?.props.children;
  return typeof text === "string" && text.trim() !== "";
}

function nativeRegistrationReport(route: string, view: RenderResult): string {
  const trigger = view.queryByTestId(`${NATIVE_BRANCH.testIdPrefix}${route}`);
  if (!trigger) return unregisteredReport(route, NATIVE_BRANCH);

  const missing: string[] = [];

  if (!hasText(within(trigger).queryByTestId("trigger-label"))) {
    missing.push("no <Label> text");
  }

  const icon = within(trigger).queryByTestId("trigger-icon");
  const symbol: unknown = icon?.props.defaultSymbol;
  if (typeof symbol !== "string" || symbol === "") {
    missing.push("no <Icon sf> symbol");
  }

  return missing.length === 0
    ? registeredReport(route, NATIVE_BRANCH)
    : incompleteReport(route, NATIVE_BRANCH, missing);
}

function classicRegistrationReport(route: string, view: RenderResult): string {
  const screen = view.queryByTestId(`${CLASSIC_BRANCH.testIdPrefix}${route}`);
  if (!screen) return unregisteredReport(route, CLASSIC_BRANCH);

  const missing: string[] = [];

  if (!hasText(within(screen).queryByTestId("screen-title"))) {
    missing.push("no title");
  }

  const icon = within(screen).queryByTestId("screen-icon");
  if (!icon) {
    missing.push("no tabBarIcon");
  } else if (icon.children.length === 0) {
    missing.push("a tabBarIcon that draws nothing");
  }

  return missing.length === 0
    ? registeredReport(route, CLASSIC_BRANCH)
    : incompleteReport(route, CLASSIC_BRANCH, missing);
}

/** The shipped tabs' own order, which the directory listing cannot express. */
function shippedOrder(tabs: string[]): string[] {
  return tabs.filter((tab) => TABS_ALREADY_SHIPPED.includes(tab));
}

describe("tab layout", () => {
  beforeEach(() => {
    mockIsLiquidGlassAvailable.mockReset();
  });

  it("finds the tab screens the app ships", () => {
    // Every per-tab check below passes vacuously if the directory read finds
    // nothing, so this is a floor for the discovery, not the list under test.
    expect(tabScreens).toEqual(expect.arrayContaining(TABS_ALREADY_SHIPPED));
  });

  describe("when liquid glass is available", () => {
    beforeEach(() => {
      mockIsLiquidGlassAvailable.mockReturnValue(true);
    });

    it("builds the native tab bar and registers one trigger per tab screen", () => {
      const view = render(<TabLayout />);

      expect(view.queryByTestId("native-tabs")).toBeTruthy();
      expect(view.queryByTestId("classic-tabs")).toBeNull();
      // Sorted both sides: a trigger naming a route with no file registers a
      // tab the app cannot open, and belongs in this comparison too.
      expect([...registeredTabs(view, NATIVE_BRANCH)].sort()).toEqual(
        tabScreens,
      );
      expect(shippedOrder(registeredTabs(view, NATIVE_BRANCH))).toEqual(
        TABS_ALREADY_SHIPPED,
      );
    });

    it.each(tabScreens)(
      "gives app/(tabs)/%s a native label and icon",
      (route) => {
        const view = render(<TabLayout />);

        expect(nativeRegistrationReport(route, view)).toBe(
          registeredReport(route, NATIVE_BRANCH),
        );
      },
    );

    it("labels the native tabs Chats and Profile", () => {
      const { getByTestId } = render(<TabLayout />);

      expect(
        within(getByTestId("native-tab-index")).getByTestId("trigger-label")
          .props.children,
      ).toBe("Chats");
      expect(
        within(getByTestId("native-tab-profile")).getByTestId("trigger-label")
          .props.children,
      ).toBe("Profile");
    });

    it("keeps the default and selected SF Symbols for each native tab", () => {
      const { getByTestId } = render(<TabLayout />);

      const chatsIcon = within(getByTestId("native-tab-index")).getByTestId(
        "trigger-icon",
      );
      const profileIcon = within(getByTestId("native-tab-profile")).getByTestId(
        "trigger-icon",
      );

      expect(chatsIcon.props.defaultSymbol).toBe("message.circle");
      expect(chatsIcon.props.selectedSymbol).toBe("message.circle.fill");
      expect(profileIcon.props.defaultSymbol).toBe("person.circle");
      expect(profileIcon.props.selectedSymbol).toBe("person.circle.fill");
    });
  });

  describe("when liquid glass is unavailable", () => {
    beforeEach(() => {
      mockIsLiquidGlassAvailable.mockReturnValue(false);
    });

    it("builds the classic tab bar and registers one screen per tab screen", () => {
      const view = render(<TabLayout />);

      expect(view.queryByTestId("classic-tabs")).toBeTruthy();
      expect(view.queryByTestId("native-tabs")).toBeNull();
      expect([...registeredTabs(view, CLASSIC_BRANCH)].sort()).toEqual(
        tabScreens,
      );
      expect(shippedOrder(registeredTabs(view, CLASSIC_BRANCH))).toEqual(
        TABS_ALREADY_SHIPPED,
      );
    });

    it.each(tabScreens)(
      "gives app/(tabs)/%s a classic title and icon",
      (route) => {
        const view = render(<TabLayout />);

        expect(classicRegistrationReport(route, view)).toBe(
          registeredReport(route, CLASSIC_BRANCH),
        );
      },
    );

    it("titles the classic tab screens Chats and Profile", () => {
      const { getByTestId } = render(<TabLayout />);

      expect(
        within(getByTestId("classic-tab-index")).getByTestId("screen-title")
          .props.children,
      ).toBe("Chats");
      expect(
        within(getByTestId("classic-tab-profile")).getByTestId("screen-title")
          .props.children,
      ).toBe("Profile");
    });

    it("renders a tinted icon for each classic tab", () => {
      const { getByTestId } = render(<TabLayout />);

      const chatsIcon = within(getByTestId("classic-tab-index")).getByTestId(
        fallbackIconTestIds.index,
      );
      const profileIcon = within(
        getByTestId("classic-tab-profile"),
      ).getByTestId(fallbackIconTestIds.profile);

      expect(chatsIcon.props.tintColor ?? chatsIcon.props.color).toBe(
        mockActiveTint,
      );
      expect(profileIcon.props.tintColor ?? profileIcon.props.color).toBe(
        mockActiveTint,
      );
    });
  });
});
