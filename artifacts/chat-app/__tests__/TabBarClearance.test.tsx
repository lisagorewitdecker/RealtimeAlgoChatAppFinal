import React from "react";
import { act, render } from "@testing-library/react-native";
import {
  FlatList,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import ProfileScreen from "../app/(tabs)/profile";
import {
  NATIVE_TAB_BAR_HEIGHT,
  WEB_TAB_BAR_HEIGHT,
} from "../hooks/useTabBarClearance";
import {
  TABS_ALREADY_SHIPPED,
  screensUnderTabBar,
} from "../test-support/tabScreens";

/**
 * The classic tab bar (Android, pre-iOS-26 and web) is absolutely positioned,
 * so it floats over every tab screen. Each tab screen's scrollable content has
 * to reserve room for it or its last control stays hidden behind the bar at
 * maximum scroll.
 *
 * The screens are not listed here by hand. expo-router turns every route in
 * app/(tabs)/ into a tab — a file, profile.tsx, or a folder holding an index
 * route, profile/index.tsx — and a folder there holds routes of its own,
 * profile/details.tsx, which the router pushes inside that tab with the bar
 * still on screen. This file renders every route below that directory
 * (test-support/tabScreens.ts finds them): a tab or a screen inside one added
 * later is measured without anyone remembering to come back here, and one
 * that reserves nothing fails under its own path.
 *
 * The clearance is the bar height alone: the bar sits above the app-wide
 * footer, which is what covers the device's bottom inset, so the screens
 * reserve the same room whether or not the device reports one (the mock below
 * reports an iPhone-sized inset).
 */

const tabBarHeight =
  Platform.OS === "web" ? WEB_TAB_BAR_HEIGHT : NATIVE_TAB_BAR_HEIGHT;
const expectedClearance = tabBarHeight;

const mockColors = {
  background: "#000000",
  foreground: "#FFFFFF",
  mutedForeground: "#CCCCCC",
  card: "#0A0A0A",
  border: "#555555",
  primary: "#60BFFF",
  primaryForeground: "#000000",
  destructive: "#FF6060",
  online: "#00EE88",
  radius: 10,
};

const mockFetch = jest.fn();

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return {
    Feather: ({ name }: { name: string }) =>
      mockReact.createElement(RN.Text, null, name),
  };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("expo-router", () => {
  const mockReact = require("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
    // Screens run this on mount and every time they are shown again; outside
    // a navigator, running it once on mount is enough for these tests.
    useFocusEffect: (callback: () => void | (() => void)) =>
      mockReact.useEffect(callback, [callback]),
  };
});

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("token") }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => ({
    username: "Ada",
    avatarEmoji: "👩‍💻",
    userId: "user-1",
    isAdmin: false,
    refreshAdminAccess: jest.fn().mockResolvedValue(undefined),
    setUsername: jest.fn(),
    setAvatarEmoji: jest.fn(),
  }),
}));

jest.mock("@/contexts/SocketContext", () => ({
  useSocket: () => ({ isConnected: true, connectionError: null }),
}));

jest.mock("@/contexts/CryptoContext", () => ({
  useCrypto: () => ({ clearLocalKeys: jest.fn() }),
}));

// No tab screen reads this context today; it is mocked so one that starts to
// still renders here, because the screens under test are whatever the app
// registers rather than a list this file controls.
jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    fontScale: 1,
    highContrast: false,
    reduceMotion: false,
  }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

jest.mock("@/components/RoomCard", () => () => null);

const tabBarScreens = screensUnderTabBar();

type ScreenModule = { default?: unknown };

/** Loads a screen by its route path, the way the router loads it. */
function loadTabScreen(route: string): React.ComponentType {
  const screenModule = require(`../app/(tabs)/${route}`) as ScreenModule;
  const Screen = screenModule.default;

  if (
    Screen === null ||
    (typeof Screen !== "function" && typeof Screen !== "object")
  ) {
    throw new Error(
      `app/(tabs)/${route} default-exports ${String(Screen)} instead of a ` +
        "screen component, so this check cannot render it",
    );
  }

  return Screen as React.ComponentType;
}

type RenderResult = ReturnType<typeof render>;
type TestElement = ReturnType<RenderResult["UNSAFE_getByType"]>;

/** The containers a tab screen can scroll its content in. */
const SCROLL_CONTAINERS: ReadonlyArray<{ type: unknown; label: string }> = [
  { type: FlatList, label: "FlatList" },
  { type: SectionList, label: "SectionList" },
  { type: ScrollView, label: "ScrollView" },
];

function scrollContainerLabel(node: TestElement): string | null {
  return (
    SCROLL_CONTAINERS.find((candidate) => candidate.type === node.type)
      ?.label ?? null
  );
}

/** The scroll containers holding the screen's own content. */
function outermostScrollContainers(view: RenderResult): TestElement[] {
  const containers: TestElement[] = [];

  const visit = (node: TestElement): void => {
    if (scrollContainerLabel(node) !== null) {
      // A list renders a scroll view of its own, so the search stops at the
      // outer container: that is the one carrying the screen's content style.
      // A horizontal scroller runs sideways under nothing and is left out.
      if (node.props.horizontal !== true) containers.push(node);
      return;
    }

    for (const child of node.children) {
      if (typeof child !== "string") visit(child);
    }
  };

  visit(view.UNSAFE_root);
  return containers;
}

/** The first rendered view of a screen, which is what it draws into. */
function outermostView(node: TestElement): TestElement | null {
  if (typeof node.type === "string") return node;

  for (const child of node.children) {
    if (typeof child === "string") continue;
    const view = outermostView(child);
    if (view) return view;
  }

  return null;
}

/** The bottom room a style reserves, or null when it sets none to read. */
function bottomPaddingOf(style: StyleProp<ViewStyle>): number | null {
  const paddingBottom = StyleSheet.flatten(style)?.paddingBottom;
  return typeof paddingBottom === "number" ? paddingBottom : null;
}

type Reservation = {
  /** Where the screen reserves its bottom room, for the failure message. */
  where: string;
  /** How much it reserves there, or null when it reserves nothing readable. */
  reserved: number | null;
};

function reservationsOf(view: RenderResult): Reservation[] {
  const containers = outermostScrollContainers(view);

  if (containers.length > 0) {
    return containers.map((container) => ({
      where: `in its ${String(scrollContainerLabel(container))} content`,
      reserved: bottomPaddingOf(container.props.contentContainerStyle),
    }));
  }

  // A tab screen that does not scroll still has to keep its last control out
  // from under the bar, and the room then belongs on the view it draws into.
  const screenView = outermostView(view.UNSAFE_root);
  return [
    {
      where: "on its outermost view (it renders no scroll view or list)",
      reserved: screenView ? bottomPaddingOf(screenView.props.style) : null,
    },
  ];
}

function clearanceMet(route: string): string {
  return `app/(tabs)/${route} reserves at least ${expectedClearance}dp below its content`;
}

function clearanceReport(route: string, view: RenderResult): string {
  const shortfalls = reservationsOf(view).filter(
    ({ reserved }) => reserved === null || reserved < expectedClearance,
  );

  if (shortfalls.length === 0) return clearanceMet(route);

  const details = shortfalls
    .map(({ where, reserved }) =>
      reserved === null
        ? `no bottom room this check can read ${where}`
        : `${reserved}dp ${where}`,
    )
    .join(", and ");

  return (
    `app/(tabs)/${route} reserves ${details}, short of the ` +
    `${expectedClearance}dp the classic tab bar covers — reserve ` +
    "useTabBarClearance() at the bottom of the screen's content"
  );
}

describe("tab screens reserve room for the classic tab bar", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        rooms: [{ id: "room-1", name: "General", userCount: 2, createdAt: 1 }],
      }),
    });
    (globalThis as { fetch: unknown }).fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it("finds the screens the app registers under the tab bar", () => {
    expect(tabBarScreens).toEqual(expect.arrayContaining(TABS_ALREADY_SHIPPED));
  });

  it.each(tabBarScreens)(
    "keeps app/(tabs)/%s clear of the tab bar",
    async (route) => {
      const Screen = loadTabScreen(route);

      const view = render(<Screen />);
      await act(async () => {});

      expect(clearanceReport(route, view)).toBe(clearanceMet(route));
    },
  );

  it("keeps the delete account button inside the profile scroll content", async () => {
    const view = render(<ProfileScreen />);
    await act(async () => {});

    // The control that was previously half-hidden behind the bar.
    expect(view.getByTestId("delete-account-button")).toBeTruthy();
  });
});
