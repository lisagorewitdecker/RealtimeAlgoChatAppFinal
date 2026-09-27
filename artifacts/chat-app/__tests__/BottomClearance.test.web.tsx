import React from "react";
import { act, render } from "@testing-library/react-native";
import { Platform } from "react-native";

import AiPanel from "../components/AiPanel";
import { AppFooter, FOOTER_VERTICAL_PADDING } from "../components/AppFooter";
import { ErrorFallback } from "../components/ErrorFallback";
import {
  type BottomClearanceOptions,
  useBottomClearance,
} from "../hooks/useBottomClearance";
import { WEB_HOME_BAR_INSET } from "../lib/webHomeBar";
import {
  loadStackScreen,
  measuredStackScreens,
  reservedBottomRoom,
} from "../test-support/bottomClearance";
import {
  type BrowserFeatures,
  DESKTOP_BROWSER,
  PHONE_BROWSER,
  browseWith,
  restoreBrowserPointer,
} from "../test-support/browserPointer";
import {
  STACK_SCREENS_ALREADY_SHIPPED,
  stackScreens,
} from "../test-support/stackScreens";

/**
 * What the app's surfaces reserve at the foot of a browser window, in each of
 * the two browsers that draw them.
 *
 * __tests__/BottomClearance.test.tsx measures the same surfaces in the build
 * a phone loads, where the platform reports the room the home indicator
 * covers. No browser reports anything there — a page is never told the
 * window's insets — so the web build decides the room from the pointer
 * driving the page instead (see lib/webHomeBar.ts): a phone browser draws
 * under a bar the system floats over the page, and a desktop browser has no
 * such bar at all.
 *
 * Both answers have to hold everywhere, which is why this file renders every
 * surface twice. In a phone browser a surface keeps the room the bar covers,
 * the same room it keeps on a device. In a desktop browser it keeps none of
 * it: room reserved for a bar that floats over nothing is a strip of empty
 * space under the last control of the screen, and a window's worth of it lost
 * from a screen that ends in a list or an editor.
 *
 * The screens are not listed here by hand, and not listed separately from the
 * run above either: both drive test-support/bottomClearance.ts, so a screen
 * added later is measured in both browsers without anyone remembering to come
 * back here, and a screen excused from one run cannot quietly go unmeasured
 * in the other.
 *
 * jest.config.js sends this file to the project built on `jest-expo/web`:
 * `.web` sources are preferred, `react-native` is aliased to
 * `react-native-web`, and `Platform.OS` is `web` throughout, which is what
 * sends these surfaces down their browser branch at all.
 */

/** A browser these surfaces are drawn by, and what it floats over the page. */
interface Browser {
  /** What it is, as a report names it. */
  readonly name: string;
  /** What it answers about the pointer driving the page. */
  readonly features: BrowserFeatures;
  /** Whether the system floats a home bar over the foot of its window. */
  readonly floatsHomeBar: boolean;
}

const PHONE: Browser = {
  name: "a phone browser",
  features: PHONE_BROWSER,
  floatsHomeBar: true,
};

const DESKTOP: Browser = {
  name: "a desktop browser",
  features: DESKTOP_BROWSER,
  floatsHomeBar: false,
};

/** The gap the error screen's details sheet leaves above the home bar. */
const DETAILS_SHEET_GAP = 16;

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
 * The real hook, watched: a surface that reserves no bottom room at all never
 * calls it, which reads as a clearer failure than the 0dp it would leave
 * behind — and in a desktop browser 0dp is the right answer, so the call is
 * the only thing that separates the two.
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

// What a browser reports for the foot of its window, on a phone as much as on
// a desktop: nothing at all. That is the premise of the whole web build —
// with an inset to read there would be no question to ask the pointer about.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

/** What one render of a surface reserved, and what it asked the hook for. */
interface Measured {
  /** Every bottom room the rendered surface reserves. */
  readonly rooms: number[];
  /** Each call to the clearance hook: what it asked for, and what it got. */
  readonly answers: readonly {
    options: BottomClearanceOptions;
    room: number;
  }[];
}

/**
 * The room a request for bottom clearance reserves in `browser`.
 *
 * This is the hook's own rule, restated where a reader can weigh it: the
 * inset, raised to the smallest room the surface keeps, plus the gap it
 * leaves on top. What the two browsers differ over is the inset — the home
 * bar's room where the system floats one over the page, and nothing where it
 * does not. The app-wide footer asks for the inset the platform reports
 * instead, which is nothing in either browser, so it reserves no room for the
 * bar in either.
 */
function roomFor(
  { source = "device-or-web", minimum = 0, gap = 0 }: BottomClearanceOptions,
  browser: Browser,
): number {
  const reservesHomeBar = browser.floatsHomeBar && source !== "device";

  return Math.max(reservesHomeBar ? WEB_HOME_BAR_INSET : 0, minimum) + gap;
}

/** Draws `surface` the way `browser` would, and lets its first load settle. */
async function renderIn(
  browser: Browser,
  surface: React.ReactElement,
): Promise<RenderResult> {
  browseWith(browser.features);
  reserveBottomRoom.mockClear();

  const view = render(surface);
  await act(async () => {});

  return view;
}

/** The rooms a surface was handed, once each, in the order it asked. */
function roomsHandedTo(measurement: Measured): number[] {
  return [...new Set(measurement.answers.map(({ room }) => room))];
}

/** The room a rendered surface reserved, and the room it was handed. */
function measured(view: RenderResult): Measured {
  return {
    rooms: reservedBottomRoom(view),
    answers: reserveBottomRoom.mock.calls.map((call, index) => ({
      options: call[0] ?? {},
      room: reserveBottomRoom.mock.results[index]?.value ?? Number.NaN,
    })),
  };
}

/** What a surface that keeps the browser's home bar clear should report. */
function clearsTheHomeBar(surface: string): string {
  return (
    `${surface} reserves the home bar's ${WEB_HOME_BAR_INSET}dp in a phone ` +
    "browser and none of it in a desktop browser"
  );
}

/** What a surface that reserves nothing for that bar should report. */
function reservesNoHomeBar(surface: string): string {
  return `${surface} reserves no room for the home bar in either browser`;
}

/**
 * What a surface reserved in each browser it was drawn by, in the words of
 * whichever answer is wrong — or `met`, when every one of them is right.
 */
function clearanceReport(
  surface: string,
  met: string,
  drawnBy: readonly (readonly [Browser, Measured])[],
): string {
  for (const [browser, measurement] of drawnBy) {
    if (measurement.answers.length === 0) {
      return (
        `${surface} never calls useBottomClearance(), so nothing asks ` +
        `${browser.name} whether it floats a home bar over the page — ` +
        "reserve the hook's room at the bottom of its content"
      );
    }

    for (const { options, room } of measurement.answers) {
      const expected = roomFor(options, browser);
      if (room === expected) continue;

      return room > expected
        ? `${surface} reserves ${room}dp in ${browser.name}, ${room - expected}dp ` +
            "more than its own content asks for — a strip of empty space " +
            "below its last control" +
            (browser.floatsHomeBar
              ? ""
              : ", since that browser floats no home bar over the page")
        : `${surface} reserves ${room}dp in ${browser.name}, short of the ` +
            `${expected}dp that keeps its last control clear`;
    }

    if (!measurement.answers.some(({ room }) => measurement.rooms.includes(room))) {
      const asked = [
        ...new Set(measurement.answers.map(({ room }) => `${room}dp`)),
      ].join(" and ");

      return (
        `${surface} asks useBottomClearance() for ${asked} in ` +
        `${browser.name} and reserves none of it in what it draws — apply ` +
        "the hook's room at the bottom of its content"
      );
    }
  }

  return met;
}

describe("app surfaces at the foot of a browser window", () => {
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

  afterEach(() => {
    restoreBrowserPointer();
  });

  it("is drawn by the browser build of these surfaces", () => {
    // Everything below turns on the browser branch of a surface, which only a
    // run that resolves the app for the web reaches.
    expect(Platform.OS).toBe("web");
  });

  it("finds the stack routes the app ships", () => {
    // A check that derives its screens from the directory passes vacuously if
    // the read ever finds nothing, whichever run is driving it.
    expect(stackScreens()).toEqual(
      expect.arrayContaining(STACK_SCREENS_ALREADY_SHIPPED),
    );
  });

  it.each(measuredScreens)("keeps app/%s clear of both browsers", async (route) => {
    const Screen = loadStackScreen(route);
    const surface = `app/${route}`;

    const phone = measured(await renderIn(PHONE, <Screen />));
    const desktop = measured(await renderIn(DESKTOP, <Screen />));

    expect(
      clearanceReport(surface, clearsTheHomeBar(surface), [
        [PHONE, phone],
        [DESKTOP, desktop],
      ]),
    ).toBe(clearsTheHomeBar(surface));
  });

  it("keeps the assistant's composer clear of both browsers", async () => {
    const surface = "the assistant panel";

    const phone = measured(await renderIn(PHONE, <AiPanel roomId="room-42" />));
    const desktop = measured(
      await renderIn(DESKTOP, <AiPanel roomId="room-42" />),
    );

    expect(
      clearanceReport(surface, clearsTheHomeBar(surface), [
        [PHONE, phone],
        [DESKTOP, desktop],
      ]),
    ).toBe(clearsTheHomeBar(surface));
  });

  it("hands the error screen's details what each browser needs", async () => {
    // The details sheet is drawn behind a button, inside a Modal, which
    // react-native-web draws through a DOM portal the test renderer cannot
    // host — so this run cannot open the sheet, and the room it reserves is
    // never in the tree to read. What it can ask is what the screen is handed
    // for it, which is the half this file is about; that the sheet reserves
    // what it was handed is measured on the build a phone loads, by
    // __tests__/BottomClearance.test.tsx, which can open it.
    const errorScreen = (
      <ErrorFallback error={new Error("Boom")} resetError={jest.fn()} />
    );

    const phone = measured(await renderIn(PHONE, errorScreen));
    const desktop = measured(await renderIn(DESKTOP, errorScreen));

    expect({
      [PHONE.name]: roomsHandedTo(phone),
      [DESKTOP.name]: roomsHandedTo(desktop),
    }).toEqual({
      [PHONE.name]: [WEB_HOME_BAR_INSET + DETAILS_SHEET_GAP],
      [DESKTOP.name]: [DETAILS_SHEET_GAP],
    });
  });

  it("leaves the app-wide footer as the browser lays it out", async () => {
    // The footer owns the inset the platform reports on behalf of the whole
    // app, and a browser reports none — so it reserves its own padding and
    // nothing else, whichever browser is drawing it. A footer that started
    // reserving the home bar would be reserving it twice: every screen above
    // it already does.
    const surface = "the app-wide footer";

    const phone = measured(await renderIn(PHONE, <AppFooter />));
    const desktop = measured(await renderIn(DESKTOP, <AppFooter />));

    expect(
      clearanceReport(surface, reservesNoHomeBar(surface), [
        [PHONE, phone],
        [DESKTOP, desktop],
      ]),
    ).toBe(reservesNoHomeBar(surface));
    expect(phone.rooms).toContain(FOOTER_VERTICAL_PADDING);
  });
});
