/**
 * The in-room ban controls have to follow the account's current moderator
 * role, not the role the app happened to read when it started. These tests
 * run the real app context and the real chat connection together with the
 * real room screen, so a grant or a revocation made elsewhere is seen the way
 * a member inside a room would see it: without visiting the profile screen
 * and without reloading.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { ROLE_RECHECK_INTERVAL_MS } from "../constants/moderation";
import { AppProvider } from "../contexts/AppContext";
import { SocketProvider } from "../contexts/SocketContext";
import RoomScreen from "../app/room/[roomId]";

const mockGetToken = jest.fn();
const mockFetch = jest.fn();
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockHandlers = new Map<string, (payload?: any) => void>();
const mockSocket = {
  on: jest.fn((event: string, handler: (payload?: any) => void) => {
    mockHandlers.set(event, handler);
  }),
  off: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
};
/** Holds the screen's focus callback so a test can bring the screen back. */
const mockFocus: { callback: (() => void | (() => void)) | null } = {
  callback: null,
};

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isLoaded: true,
    isSignedIn: true,
    userId: "user-ada",
  }),
}));

// The screen runs this on mount and every time it is shown again; outside a
// navigator the test drives it through mockFocus.callback.
jest.mock("expo-router", () => {
  const mockReact = require("react");
  return {
    useLocalSearchParams: () => ({
      roomId: "room-42",
      roomName: "Compiler room",
    }),
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocus.callback = callback;
      mockReact.useEffect(callback, [callback]);
    },
  };
});

jest.mock("@expo/vector-icons", () => ({
  Feather: () => null,
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Error: "error" },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("react-native-keyboard-controller", () => {
  const mockReact = require("react");
  const { View: MockView } = require("react-native");
  return {
    KeyboardAvoidingView: (props: Record<string, unknown>) =>
      mockReact.createElement(MockView, props),
  };
});

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    fontScale: 1,
    highContrast: false,
    reduceMotion: false,
  }),
}));

// The real connection provider runs; only the network client under it is
// replaced, so what the server pushes down the connection is delivered to the
// app the same way it would be in the running app.
jest.mock("socket.io-client", () => ({
  io: jest.fn(() => mockSocket),
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

jest.mock("@/hooks/useColors", () => {
  const palette = require("@/constants/colors").default;
  return {
    useColors: () => ({ ...palette.dark, radius: palette.radius }),
  };
});

/** What the server currently reports for this account's own profile. */
let serverSaysAdmin = false;
/** What the server answers when this account asks to ban a room member. */
let banResponse: { ok: boolean; status: number; error?: string } = {
  ok: true,
  status: 200,
};

function profileResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      profile: { username: "Ada", avatarEmoji: "👩‍💻" },
      isAdmin: serverSaysAdmin,
    }),
  };
}

/** How many times the app has asked the server for this account's role. */
function profileReads(): number {
  return mockFetch.mock.calls.filter(
    ([url]) => typeof url === "string" && url.includes("/api/profile"),
  ).length;
}

/** Whatever the last focus callback left behind to stop its re-checks. */
let stopFocusedChecks: (() => void) | void;

/** Leaving the room for another screen and coming back re-runs the callback. */
async function returnToRoomScreen() {
  await act(async () => {
    stopFocusedChecks?.();
    stopFocusedChecks = mockFocus.callback?.();
  });
}

/**
 * Renders the room, waits for the join, and opens the member list — the ban
 * controls live there, next to the other people in the room.
 */
async function openRoomMemberList(options?: { asRoomCreator?: boolean }) {
  const view = render(
    <AppProvider>
      <SocketProvider>
        <RoomScreen />
      </SocketProvider>
    </AppProvider>,
  );
  await waitFor(() => expect(mockHandlers.has("room-joined")).toBe(true));
  // The connection is up before anything is pushed down it, as it is in the
  // running app once the member is in a room.
  await act(async () => {
    mockHandlers.get("connect")?.();
  });
  await act(async () => {
    mockHandlers.get("room-joined")?.({
      messages: [],
      users: [
        { userId: "user-ada", username: "Ada" },
        { userId: "user-ben", username: "Ben" },
      ],
      isRoomCreator: options?.asRoomCreator === true,
    });
  });
  fireEvent.press(view.getByTestId("room-users-button"));
  return view;
}

type Query = (label: string) => unknown;

/**
 * Waits for the ban control to reach a state, comparing plain words rather
 * than elements: a failed element comparison serializes the rendered tree,
 * which is slow enough to exhaust the wait before the screen has settled.
 */
async function expectBanControl(
  queryByLabelText: Query,
  expected: "visible" | "gone",
): Promise<void> {
  await waitFor(() =>
    expect(
      queryByLabelText("Ban Ben from this room") ? "visible" : "gone",
    ).toBe(expected),
  );
}

describe("moderator access changing while a room is open", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = "api.example.test";
    serverSaysAdmin = false;
    banResponse = { ok: true, status: 200 };
    mockHandlers.clear();
    mockFocus.callback = null;
    Object.values(mockRouter).forEach((mock) => mock.mockReset());
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.disconnect.mockClear();
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    mockFetch.mockReset().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/profile")) {
        return profileResponse();
      }
      return {
        ok: banResponse.ok,
        status: banResponse.status,
        json: async () => ({ error: banResponse.error }),
      };
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    stopFocusedChecks?.();
    stopFocusedChecks = undefined;
  });

  it("takes the in-room controls away once moderator access is revoked", async () => {
    serverSaysAdmin = true;
    const { queryByLabelText, queryByTestId } = await openRoomMemberList();
    await expectBanControl(queryByLabelText, "visible");

    serverSaysAdmin = false;
    await returnToRoomScreen();

    await expectBanControl(queryByLabelText, "gone");
    // The member is still in the room: the controls went, not the room.
    expect(queryByTestId("room-composer")).toBeTruthy();
  });

  it("shows the in-room controls once moderator access is granted", async () => {
    const { queryByLabelText } = await openRoomMemberList();
    await expectBanControl(queryByLabelText, "gone");

    serverSaysAdmin = true;
    await returnToRoomScreen();

    await expectBanControl(queryByLabelText, "visible");
  });

  it("takes the controls away while the member just sits in the room", async () => {
    jest.useFakeTimers();
    serverSaysAdmin = true;
    const { queryByLabelText } = await openRoomMemberList();
    await expectBanControl(queryByLabelText, "visible");

    // No screen change and no button press: access is removed while the
    // member is looking at the room, and only time passes.
    serverSaysAdmin = false;
    await act(async () => {
      jest.advanceTimersByTime(ROLE_RECHECK_INTERVAL_MS);
    });

    await expectBanControl(queryByLabelText, "gone");
  });

  it("shows the controls as soon as the server says access was granted", async () => {
    const { queryByLabelText } = await openRoomMemberList();
    await expectBanControl(queryByLabelText, "gone");
    const askedBefore = profileReads();

    // An administrator grants the role while this member sits in the room.
    // Nothing is pressed, no screen is left, and no time passes.
    await act(async () => {
      mockHandlers.get("moderator-access-changed")?.({ isAdmin: true });
    });

    await expectBanControl(queryByLabelText, "visible");
    // The notification carried the answer, so the app did not have to ask.
    expect(profileReads()).toBe(askedBefore);
  });

  it("takes the controls away as soon as the server says access was removed", async () => {
    serverSaysAdmin = true;
    const { queryByLabelText, queryByTestId } = await openRoomMemberList();
    await expectBanControl(queryByLabelText, "visible");
    const askedBefore = profileReads();

    await act(async () => {
      mockHandlers.get("moderator-access-changed")?.({ isAdmin: false });
    });

    await expectBanControl(queryByLabelText, "gone");
    expect(profileReads()).toBe(askedBefore);
    // The member is still in the room: the controls went, not the room.
    expect(queryByTestId("room-composer")).toBeTruthy();
  });

  it("keeps a notification ahead of a re-check that was already in flight", async () => {
    const { queryByLabelText } = await openRoomMemberList();
    await expectBanControl(queryByLabelText, "gone");

    // A re-check starts and stalls. It was sent before the grant, so its
    // answer is already out of date by the time it arrives.
    const release: Array<() => void> = [];
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/profile")) {
        await new Promise<void>((resolve) => release.push(resolve));
        return profileResponse();
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await returnToRoomScreen();
    await waitFor(() => expect(release).toHaveLength(1));

    await act(async () => {
      mockHandlers.get("moderator-access-changed")?.({ isAdmin: true });
    });
    await expectBanControl(queryByLabelText, "visible");

    // The stale answer lands afterwards and must not undo the grant.
    await act(async () => {
      release[0]?.();
    });
    await expectBanControl(queryByLabelText, "visible");
  });

  it("re-reads the role when a dropped connection comes back", async () => {
    const { queryByLabelText } = await openRoomMemberList();
    await expectBanControl(queryByLabelText, "gone");

    // Access is granted while this app has no connection, so the server has
    // nowhere to push the change; the restored connection has to ask.
    await act(async () => {
      mockHandlers.get("disconnect")?.();
    });
    serverSaysAdmin = true;
    await act(async () => {
      mockHandlers.get("connect")?.();
    });

    await expectBanControl(queryByLabelText, "visible");
  });

  it("takes the controls away when a ban request is refused", async () => {
    serverSaysAdmin = true;
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    try {
      const { getByLabelText, queryByLabelText } = await openRoomMemberList();
      await expectBanControl(queryByLabelText, "visible");

      // Access is removed elsewhere, and a ban pressed in the still-open
      // member list is the first this copy of the app hears of it.
      serverSaysAdmin = false;
      banResponse = {
        ok: false,
        status: 403,
        error: "Room creator or admin required",
      };
      fireEvent.press(getByLabelText("Ban Ben from this room"));
      const confirmBan = (
        alertSpy.mock.calls.at(-1)?.[2] as
          | Array<{ text?: string; onPress?: () => void }>
          | undefined
      )?.find((button) => button.text === "Ban");
      await act(async () => {
        confirmBan?.onPress?.();
      });

      await expectBanControl(queryByLabelText, "gone");
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("keeps the room creator's own controls when the role is revoked", async () => {
    serverSaysAdmin = true;
    const { queryByLabelText } = await openRoomMemberList({
      asRoomCreator: true,
    });
    await expectBanControl(queryByLabelText, "visible");

    // The room they created still answers to them, whatever happened to the
    // account-wide role.
    serverSaysAdmin = false;
    await returnToRoomScreen();
    await act(async () => {
      await Promise.resolve();
    });

    await expectBanControl(queryByLabelText, "visible");
  });
});
