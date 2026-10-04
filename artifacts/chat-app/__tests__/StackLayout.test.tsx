import React from "react";
import { render } from "@testing-library/react-native";

import RootLayout from "../app/_layout";
import {
  ROOT_STACK_ROUTES_ALREADY_SHIPPED,
  rootStackRoutes,
} from "../test-support/stackScreens";

/**
 * Checks that app/_layout.tsx configures every screen the root stack ships.
 *
 * The screens are not listed here by hand. expo-router ships a route for
 * every source file below app/ whether or not the layout names it in its
 * `<Stack>`, and a screen left out is pushed the way the stack pushes
 * anything it was not told about — a plain page sliding in from the side —
 * instead of opening and closing the way it was meant to. This file reads
 * app/ (test-support/stackScreens.ts names each child the way a
 * `<Stack.Screen name>` has to name it) and requires the layout to register
 * every screen it finds, so an unregistered one fails under its own path, the
 * way __tests__/TabLayout.test.tsx already does for the tabs.
 *
 * The presentations pinned below are what the screens the app ships today
 * open as; the per-screen check applies to any screen, including ones added
 * later.
 */

process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_stack_layout";

/** The testID this file's mock gives each registered screen. */
const STACK_SCREEN_PREFIX = "stack-screen-";

const mockReplace = jest.fn();

jest.mock("expo-router", () => {
  const mockReact = require("react");
  const RN = require("react-native");

  const Stack = ({ children }: { children?: unknown }) =>
    mockReact.createElement(RN.View, { testID: "root-stack" }, children);
  Stack.Screen = ({
    name,
    options,
  }: {
    name: string;
    options?: { presentation?: string };
  }) =>
    mockReact.createElement(RN.View, {
      testID: `stack-screen-${name}`,
      // Spelt out rather than left undefined, so a screen registered with no
      // presentation is told apart from one this mock failed to read.
      presentation: options?.presentation ?? "the stack's default",
    });

  return {
    Stack,
    useRouter: () => ({ replace: mockReplace }),
    useSegments: () => [],
  };
});

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

jest.mock("@expo-google-fonts/inter", () => ({
  Inter_400Regular: "Inter_400Regular",
  Inter_500Medium: "Inter_500Medium",
  Inter_600SemiBold: "Inter_600SemiBold",
  Inter_700Bold: "Inter_700Bold",
  useFonts: () => [true, null],
}));

// Signed in, verified and past setup: the one state in which the layout
// renders its <Stack> rather than a loading, blocked or sign-in screen.
jest.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

jest.mock("@/contexts/AppContext", () => ({
  AppProvider: ({ children }: { children: unknown }) => children,
  useApp: () => ({
    accessStatus: "ready",
    isReady: true,
    username: "Ada",
  }),
}));

jest.mock("@workspace/api-client-react", () => ({
  setAuthTokenGetter: jest.fn(),
  setBaseUrl: jest.fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  QueryClient: jest.fn(),
  QueryClientProvider: ({ children }: { children: unknown }) => children,
}));

jest.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children: unknown }) => children,
}));

jest.mock("react-native-keyboard-controller", () => ({
  KeyboardProvider: ({ children }: { children: unknown }) => children,
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));

jest.mock("@/contexts/SocketContext", () => ({
  SocketProvider: ({ children }: { children: unknown }) => children,
}));

jest.mock("@/contexts/CryptoContext", () => ({
  CryptoProvider: ({ children }: { children: unknown }) => children,
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  AccessibilityProvider: ({ children }: { children: unknown }) => children,
  useAccessibility: () => ({
    fontScale: 1,
    highContrast: false,
    reduceMotion: false,
  }),
}));

jest.mock("@/lib/clerkTokenCache", () => ({
  clerkTokenCache: {},
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#0d0d1a",
    foreground: "#f8fafc",
    mutedForeground: "#a5b4fc",
    border: "#343D4C",
    primary: "#6366f1",
    radius: 10,
  }),
}));

/**
 * How the screens the app ships today open, which the directory listing
 * cannot express: a presentation is a product decision rather than a
 * filename. A screen absent from here is registered without one and pushes as
 * a plain page, which is what the room screen, the setup screen and the tab
 * navigator want.
 */
const SHIPPED_PRESENTATIONS: Record<string, string> = {
  "admin-rooms": "modal",
  "call/[roomId]": "fullScreenModal",
  "new-room": "modal",
  "sandbox/[roomId]": "modal",
};

const stackRoutes = rootStackRoutes();

type RenderResult = ReturnType<typeof render>;

/** The screens the layout registered, by the name it gave each one. */
function registeredScreens(view: RenderResult): string[] {
  return view
    .queryAllByTestId(new RegExp(`^${STACK_SCREEN_PREFIX}`))
    .map((screen) =>
      String(screen.props.testID).slice(STACK_SCREEN_PREFIX.length),
    );
}

/** What a screen the layout registers reads as. */
function registeredReport(route: string): string {
  return `app/_layout.tsx registers ${route} in its <Stack>`;
}

function registrationReport(route: string, view: RenderResult): string {
  if (registeredScreens(view).includes(route)) return registeredReport(route);

  return (
    `app/_layout.tsx has no <Stack.Screen name="${route}"> — expo-router ` +
    "ships every route below app/ whether or not the layout names it, so " +
    "this screen opens the way the stack opens anything it was not told " +
    "about rather than the way it was meant to"
  );
}

/** How a registered screen opens, or why it opens no particular way. */
function presentationOf(route: string, view: RenderResult): string {
  const screen = view.queryByTestId(`${STACK_SCREEN_PREFIX}${route}`);
  if (!screen) return "nothing, since the layout does not register it";

  return String(screen.props.presentation);
}

describe("root stack layout", () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it("finds the screens the root stack ships", () => {
    // Every per-screen check below passes vacuously if the directory read
    // finds nothing, so this is a floor for the discovery, not the list under
    // test: a screen added later is checked without being added here.
    expect(stackRoutes).toEqual(
      expect.arrayContaining(ROOT_STACK_ROUTES_ALREADY_SHIPPED),
    );
  });

  it.each(stackRoutes)("configures app/%s in the root stack", (route) => {
    const view = render(<RootLayout />);

    expect(registrationReport(route, view)).toBe(registeredReport(route));
  });

  it("registers no screen the app ships no route for", () => {
    // The other half of the comparison: a <Stack.Screen> naming a route with
    // no file configures a screen nothing can open, and would otherwise sit
    // there unnoticed after the screen behind it was renamed or deleted.
    const view = render(<RootLayout />);

    expect(
      registeredScreens(view).filter((name) => !stackRoutes.includes(name)),
    ).toEqual([]);
  });

  it.each(Object.entries(SHIPPED_PRESENTATIONS))(
    "opens app/%s as a %s",
    (route, presentation) => {
      const view = render(<RootLayout />);

      expect(`app/${route} opens as ${presentationOf(route, view)}`).toBe(
        `app/${route} opens as ${presentation}`,
      );
    },
  );
});
