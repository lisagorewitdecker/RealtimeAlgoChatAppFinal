import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Platform } from "react-native";

import RoomScreen from "../app/room/[roomId]";
import AiPanel from "../components/AiPanel";
import { AppFooter, FOOTER_VERTICAL_PADDING } from "../components/AppFooter";
import { ErrorFallback } from "../components/ErrorFallback";
import { useBottomClearance } from "../hooks/useBottomClearance";
import { WEB_HOME_BAR_INSET } from "../lib/webHomeBar";
import {
  bottomPaddingOf,
  loadStackScreen,
  measuredStackScreens,
  reservedBottomRoom,
  staleExclusions,
} from "../test-support/bottomClearance";
import {
  STACK_SCREENS_ALREADY_SHIPPED,
  stackScreens,
} from "../test-support/stackScreens";

/**
 * These surfaces end at the bottom edge of the window, where the home
 * indicator floats over whatever they draw last. Each one reserves bottom room
 * through the shared `useBottomClearance` hook; this file renders the real
 * surfaces and fails when one stops reserving that room.
 *
 * The screens are not listed here by hand. expo-router makes a route out of
 * every source file below app/, so this file measures every stack route
 * test-support/bottomClearance.ts finds: a screen added later is measured
 * without anyone remembering to come back here, and one that reserves nothing
 * fails under its own path. The tab screens are measured by
 * __tests__/TabBarClearance.test.tsx instead, since the tab bar covers their
 * bottom edge rather than the home indicator.
 *
 * Rendered by name below are the surfaces that are no route of their own — the
 * assistant panel, the error screen and the app-wide footer — and the room
 * screen's states a plain render does not reach. Every stack screen reserves
 * the same inset, so they all share one constant below and differ only in the
 * minimum and gap each one asks for.
 *
 * This is the run that measures the build a phone loads, where the inset is
 * the one the platform reports. __tests__/BottomClearance.test.web.tsx
 * measures the same surfaces in the build a browser loads, where the room
 * depends on the browser: a phone browser floats the bar over the page, and a
 * desktop browser floats nothing there and must be left no strip of empty
 * space.
 */

const BOTTOM_INSET = 34;

/** What every screen reserves: the reported inset, or the web home bar. */
const deviceOrWebInset =
  Platform.OS === "web" ? WEB_HOME_BAR_INSET : BOTTOM_INSET;
/** What the platform reports, which is all the app-wide footer reserves. */
const deviceInset = BOTTOM_INSET;
/** Only the home bar the browser omits, for a surface inside a host screen. */
const webInset = Platform.OS === "web" ? WEB_HOME_BAR_INSET : 0;

const shippedScreens = stackScreens();
const measuredScreens = measuredStackScreens();

const mockColors = {
  background: "#0d0d1a",
  foreground: "#f8fafc",
  mutedForeground: "#a5b4fc",
  secondary: "#1e1b4b",
  card: "#171B24",
  border: "#343D4C",
  primary: "#6366f1",
  primaryForeground: "#ffffff",
  muted: "#242938",
  destructive: "#ef4444",
  accent: "#22d3ee",
  radius: 10,
};

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockGetToken = jest.fn();
const mockHandlers = new Map<string, (payload?: unknown) => void>();
const mockSocket = {
  on: jest.fn((event: string, handler: (payload?: unknown) => void) => {
    mockHandlers.set(event, handler);
  }),
  off: jest.fn(),
  emit: jest.fn(),
};
const mockFetch = jest.fn();
const mockRefreshAdminAccess = jest.fn();

/**
 * The real hook, watched: a screen that reserves no bottom room at all never
 * calls it, which reads as a clearer failure than the 0dp it would leave
 * behind.
 */
jest.mock("@/hooks/useBottomClearance", () => {
  const actual =
    jest.requireActual<typeof import("../hooks/useBottomClearance")>(
      "../hooks/useBottomClearance",
    );

  return { ...actual, useBottomClearance: jest.fn(actual.useBottomClearance) };
});

const reserveBottomRoom = useBottomClearance as jest.MockedFunction<
  typeof useBottomClearance
>;

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
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
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Error: "error", Success: "success" },
}));

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

jest.mock("expo-router", () => {
  const mockReact = require("react");
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ roomId: "room-42", roomName: "Compiler room" }),
    // The room screen re-reads the moderator role whenever it is shown;
    // outside a navigator that is an ordinary mount effect.
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(callback, [callback]);
    },
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useClerk: () => ({ signOut: jest.fn() }),
  useOAuth: () => ({ startOAuthFlow: jest.fn() }),
  useSignIn: () => ({
    signIn: {
      create: jest.fn(),
      resetPasswordEmailCode: { sendCode: jest.fn() },
    },
    fetchStatus: "idle",
    errors: null,
  }),
}));

// The sign-in and sign-up screens take Clerk's legacy hooks; the password
// reset screen above takes the current ones.
jest.mock("@clerk/expo/legacy", () => ({
  useSignIn: () => ({
    signIn: { create: jest.fn() },
    setActive: jest.fn(),
    isLoaded: true,
  }),
  useSignUp: () => ({
    signUp: { create: jest.fn(), prepareEmailAddressVerification: jest.fn() },
    setActive: jest.fn(),
    isLoaded: true,
  }),
}));

jest.mock("react-native-keyboard-controller", () => {
  const mockReact = require("react");
  const { ScrollView, View } = require("react-native");
  return {
    KeyboardAwareScrollView: (props: Record<string, unknown>) =>
      mockReact.createElement(ScrollView, props),
    KeyboardAvoidingView: (props: Record<string, unknown>) =>
      mockReact.createElement(View, props),
  };
});

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => ({
    userId: "user-ben",
    username: "Ben",
    isAdmin: false,
    refreshAdminAccess: mockRefreshAdminAccess,
    setUsername: jest.fn(),
  }),
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    fontScale: 1,
    highContrast: false,
    reduceMotion: false,
  }),
}));

jest.mock("@/contexts/SocketContext", () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

jest.mock("@/contexts/CryptoContext", () => ({
  useCrypto: () => ({
    isReady: true,
    publicKeyB64: "public-key",
    loadRoomKey: jest.fn(async () => undefined),
    getRoomKey: jest.fn(() => null),
    generateRoomKey: jest.fn(),
    encryptRoomKey: jest.fn(),
    decryptRoomKeyEnvelope: jest.fn(),
    setRoomKey: jest.fn(),
    decryptMessage: jest.fn(),
    encryptMessage: jest.fn(),
  }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

type RenderResult = ReturnType<typeof render>;

function clearanceMet(route: string): string {
  return `app/${route} reserves at least ${deviceOrWebInset}dp below its content`;
}

function clearanceReport(route: string, view: RenderResult): string {
  if (reserveBottomRoom.mock.calls.length === 0) {
    return (
      `app/${route} never calls useBottomClearance(), so nothing keeps its ` +
      "last control clear of the home bar — reserve the hook's room at the " +
      "bottom of the screen's content"
    );
  }

  const reserved = reservedBottomRoom(view);
  const most = reserved.length === 0 ? 0 : Math.max(...reserved);
  if (most >= deviceOrWebInset) return clearanceMet(route);

  return (
    `app/${route} reserves at most ${most}dp below its content, short of the ` +
    `${deviceOrWebInset}dp the home bar covers — reserve ` +
    "useBottomClearance() at the bottom of the screen's content"
  );
}

describe("app surfaces reserve room for the home bar", () => {
  beforeEach(() => {
    mockHandlers.clear();
    Object.values(mockRouter).forEach((mock) => mock.mockReset());
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.emit.mockClear();
    reserveBottomRoom.mockClear();
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    mockFetch.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({
        rooms: [
          {
            id: "room-1",
            name: "Design Team",
            createdBy: "user-ada",
            createdAt: 1,
            isActive: true,
            memberCount: 2,
            lastActivityAt: 1,
          },
        ],
      }),
    });
    (globalThis as { fetch: unknown }).fetch = mockFetch;
  });

  it("finds the stack routes the app ships", () => {
    expect(shippedScreens).toEqual(
      expect.arrayContaining(STACK_SCREENS_ALREADY_SHIPPED),
    );
  });

  it("leaves out only routes the app still ships", () => {
    // A screen that was deleted or renamed would otherwise keep its excuse,
    // and the route that replaced it would inherit the exclusion unmeasured.
    expect(staleExclusions()).toEqual([]);
  });

  it.each(measuredScreens)(
    "keeps app/%s clear of the home bar",
    async (route) => {
      const Screen = loadStackScreen(route);
      reserveBottomRoom.mockClear();

      const view = render(<Screen />);
      await act(async () => {});

      expect(clearanceReport(route, view)).toBe(clearanceMet(route));
    },
  );

  it("keeps the room composer clear of the home bar", async () => {
    const view = render(<RoomScreen />);

    await act(async () => {
      mockHandlers.get("room-joined")?.({ messages: [], users: [] });
    });

    expect(
      bottomPaddingOf(view.getByTestId("room-composer").props.style),
    ).toBeGreaterThanOrEqual(Math.max(deviceOrWebInset, 8) + 8);
  });

  it("keeps the banned room screen clear of the home bar", async () => {
    const view = render(<RoomScreen />);

    await act(async () => {
      mockHandlers.get("error")?.({ code: "ROOM_BANNED" });
    });

    expect(
      bottomPaddingOf(view.getByTestId("banned-room").props.style),
    ).toBeGreaterThanOrEqual(Math.max(deviceOrWebInset, 24));
  });

  it("keeps the assistant composer clear of the home bar", () => {
    const view = render(<AiPanel roomId="room-42" />);

    expect(
      bottomPaddingOf(view.getByTestId("ai-panel-composer").props.style),
    ).toBeGreaterThanOrEqual(Math.max(webInset, 12));
  });

  it("keeps the error screen's details clear of the home bar", () => {
    const view = render(
      <ErrorFallback error={new Error("Boom")} resetError={jest.fn()} />,
    );

    fireEvent.press(view.getByLabelText("View error details"));

    expect(
      bottomPaddingOf(
        view.getByTestId("error-details-scroll").props.contentContainerStyle,
      ),
    ).toBeGreaterThanOrEqual(deviceOrWebInset + 16);
  });

  it("keeps the app footer clear of the home bar", () => {
    const view = render(<AppFooter />);

    expect(
      bottomPaddingOf(view.getByTestId("app-footer").props.style),
    ).toBeGreaterThanOrEqual(Math.max(deviceInset, FOOTER_VERTICAL_PADDING));
  });
});
