/**
 * The moderation panel has to follow the account's current role, not the role
 * the app happened to read when it started. These tests run the real app
 * context together with the real profile screen so a grant or a revocation
 * made elsewhere is seen the way a member would see it: without reloading.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ROLE_RECHECK_INTERVAL_MS } from "../constants/moderation";
import { AppProvider } from "../contexts/AppContext";
import ProfileScreen from "../app/(tabs)/profile";

const mockGetToken = jest.fn();
const mockFetch = jest.fn();
/** Holds the screen's focus callback so a test can bring the screen back. */
const mockFocus: { callback: (() => void | (() => void)) | null } = {
  callback: null,
};

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isLoaded: true,
    isSignedIn: true,
    userId: "user-candidate",
  }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

// Screens run this on mount and every time they are shown again; outside a
// navigator the test drives it through mockFocus.callback.
jest.mock("expo-router", () => {
  const mockReact = require("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocus.callback = callback;
      mockReact.useEffect(callback, [callback]);
    },
  };
});

jest.mock("@/contexts/SocketContext", () => ({
  useSocket: () => ({ isConnected: true, connectionError: null }),
}));

jest.mock("@/contexts/CryptoContext", () => ({
  useCrypto: () => ({ clearLocalKeys: jest.fn() }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000000",
    card: "#0A0A0A",
    border: "#555555",
    foreground: "#FFFFFF",
    mutedForeground: "#CCCCCC",
    primary: "#60BFFF",
    primaryForeground: "#000000",
    destructive: "#FF6060",
    online: "#00EE88",
    radius: 12,
  }),
}));

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return {
    Feather: ({ name }: { name: string }) =>
      mockReact.createElement(RN.Text, null, name),
  };
});

/** What the server currently reports for this account's own profile. */
let serverSaysAdmin = false;
/** Set when the profile request should fail instead of answering. */
let profileRequestFails = false;

function profileResponse() {
  if (profileRequestFails) throw new Error("Network request failed");
  return {
    ok: true,
    status: 200,
    json: async () => ({
      profile: { username: "Ada", avatarEmoji: "👩‍💻" },
      isAdmin: serverSaysAdmin,
    }),
  };
}

function renderProfile() {
  return render(
    <AppProvider>
      <ProfileScreen />
    </AppProvider>,
  );
}

type Query = (testID: string) => unknown;

/**
 * Waits for the panel to reach a state, comparing plain words rather than
 * elements: a failed element comparison serializes the rendered tree, which
 * is slow enough to exhaust the wait before the screen has settled.
 */
async function expectPanel(
  queryByTestId: Query,
  expected: "visible" | "gone",
): Promise<void> {
  await waitFor(() =>
    expect(queryByTestId("moderation-panel") ? "visible" : "gone").toBe(
      expected,
    ),
  );
}

/** Whatever the last focus callback left behind to stop its re-checks. */
let stopFocusedChecks: (() => void) | void;

/** Leaving for another tab and coming back re-runs the focus callback. */
async function returnToProfileScreen() {
  await act(async () => {
    stopFocusedChecks?.();
    stopFocusedChecks = mockFocus.callback?.();
  });
}

describe("moderator access changing while the app is open", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = "api.example.test";
    serverSaysAdmin = false;
    profileRequestFails = false;
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    mockFocus.callback = null;
    mockFetch.mockReset().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/profile")) {
        return profileResponse();
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ actions: [], nextCursor: null, moderators: [] }),
      };
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    stopFocusedChecks?.();
    stopFocusedChecks = undefined;
  });

  it("takes the panel away once moderator access is revoked", async () => {
    serverSaysAdmin = true;
    const { queryByTestId } = renderProfile();
    await expectPanel(queryByTestId, "visible");

    serverSaysAdmin = false;
    await returnToProfileScreen();

    await expectPanel(queryByTestId, "gone");
    // The screen itself is still up: the panel went, not the profile.
    expect(queryByTestId("current-profile-avatar")).toBeTruthy();
  });

  it("shows the panel once moderator access is granted", async () => {
    const { queryByTestId } = renderProfile();
    await waitFor(() =>
      expect(queryByTestId("current-profile-avatar")).toBeTruthy(),
    );
    await expectPanel(queryByTestId, "gone");

    serverSaysAdmin = true;
    await returnToProfileScreen();

    await expectPanel(queryByTestId, "visible");
  });

  it("takes the panel away when a moderation request is refused", async () => {
    serverSaysAdmin = true;
    const { getByTestId, queryByTestId } = renderProfile();
    await expectPanel(queryByTestId, "visible");

    // Access is removed elsewhere, and a request made from the still-open
    // panel is the first this account hears of it.
    serverSaysAdmin = false;
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/profile")) {
        return profileResponse();
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: "Moderator access is required." }),
      };
    });
    fireEvent.changeText(getByTestId("moderation-search-input"), "grace");
    fireEvent.press(getByTestId("moderation-search-button"));

    await expectPanel(queryByTestId, "gone");
  });

  it("takes the panel away while the member just sits on the screen", async () => {
    jest.useFakeTimers();
    serverSaysAdmin = true;
    const { queryByTestId } = renderProfile();
    await expectPanel(queryByTestId, "visible");

    // No tab switch and no button press: access is removed while the member
    // is looking at the panel, and only time passes.
    serverSaysAdmin = false;
    await act(async () => {
      jest.advanceTimersByTime(ROLE_RECHECK_INTERVAL_MS);
    });

    await expectPanel(queryByTestId, "gone");
  });

  it("ignores a slow earlier check that answers after a newer one", async () => {
    serverSaysAdmin = true;
    const { queryByTestId } = renderProfile();
    await expectPanel(queryByTestId, "visible");

    // Two checks overlap. The earlier one was sent before access was removed
    // and still reports a moderator; the later one sees it gone.
    const release: Array<() => void> = [];
    let profileChecks = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/profile")) {
        profileChecks += 1;
        const stillAdmin = profileChecks === 1;
        await new Promise<void>((resolve) => release.push(resolve));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profile: { username: "Ada", avatarEmoji: "👩‍💻" },
            isAdmin: stillAdmin,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ actions: [], nextCursor: null, moderators: [] }),
      };
    });
    await returnToProfileScreen();
    await returnToProfileScreen();
    await waitFor(() => expect(release).toHaveLength(2));

    // The later check answers first: access has been removed.
    await act(async () => {
      release[1]();
    });
    await expectPanel(queryByTestId, "gone");

    // The earlier answer arrives afterwards and must not bring the panel back.
    await act(async () => {
      release[0]();
    });
    await expectPanel(queryByTestId, "gone");
  });

  it("keeps the panel when the role cannot be re-checked", async () => {
    serverSaysAdmin = true;
    const { queryByTestId } = renderProfile();
    await expectPanel(queryByTestId, "visible");

    profileRequestFails = true;
    await returnToProfileScreen();

    await expectPanel(queryByTestId, "visible");
  });
});
