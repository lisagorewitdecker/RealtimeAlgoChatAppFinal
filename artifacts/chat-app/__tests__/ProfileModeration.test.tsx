import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";
import ProfileScreen from "../app/(tabs)/profile";

const mockUseApp = jest.fn();
const mockGetToken = jest.fn();
const mockFetch = jest.fn();
const mockSignOut = jest.fn();
const mockClearLocalKeys = jest.fn();
const mockRefreshAdminAccess = jest.fn();
/** Stands in for the navigator the profile screen opens modals through. */
const mockRouter = { push: jest.fn() };
/** Holds the screen's focus callback so a test can bring the screen back. */
const mockFocus: { callback: (() => void | (() => void)) | null } = {
  callback: null,
};
/** Stops the re-checks a manually re-run focus callback left behind. */
let stopFocusedChecks: (() => void) | void;
const mockColors = {
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
};

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useClerk: () => ({ signOut: mockSignOut }),
}));

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => mockUseApp(),
}));

// Screens run this on mount and every time they are shown again; outside a
// navigator the test drives it through mockFocus.callback.
jest.mock("expo-router", () => {
  const mockReact = require("react");
  return {
    useRouter: () => mockRouter,
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
  useCrypto: () => ({ clearLocalKeys: mockClearLocalKeys }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
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

const appValue = {
  username: "Ada",
  avatarEmoji: "👩‍💻",
  userId: "user-admin",
  isAdmin: false,
  refreshAdminAccess: mockRefreshAdminAccess,
  setUsername: jest.fn(),
  setAvatarEmoji: jest.fn(),
};

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received ${hex}`);
  }
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function compositeHex(foreground: string, background: string, alpha: number): string {
  const foregroundChannels = foreground.match(/[a-f\d]{2}/gi)?.map((channel) =>
    parseInt(channel, 16),
  );
  const backgroundChannels = background.match(/[a-f\d]{2}/gi)?.map((channel) =>
    parseInt(channel, 16),
  );
  if (!foregroundChannels || !backgroundChannels) {
    throw new Error("Expected RGB colors when compositing the status badge.");
  }
  return `#${foregroundChannels
    .map((channel, index) =>
      Math.round(channel * alpha + backgroundChannels[index] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** The administrators the history picker offers in the tests that use it. */
const pickerModerators = [
  {
    userId: "user-admin",
    username: "Ada",
    email: "ada@example.test",
    source: "configured",
    grantedBy: null,
    grantedAt: null,
  },
  {
    userId: "user-colleague",
    username: "Grace Hopper",
    email: "grace@example.test",
    source: "granted",
    grantedBy: "user-admin",
    grantedAt: "2026-09-20T10:00:00.000Z",
  },
];

/**
 * Sends keys to the administrator picker the way a browser does: at the
 * group around it, which is the view carrying the forwarded key handling
 * and where a key press on the toggle or any of its rows bubbles to.
 *
 * Each press answers with the row focus landed on, which is what a walk
 * through the list amounts to. Focus is read off the spy rather than the
 * tree: a Touchable's ref resolves to React Native's mocked View here, so
 * the view `focus()` was called on is the row that has it.
 *
 * What the picker takes away from the browser is not read here -- the key
 * is handed a do-nothing `preventDefault` -- so a key that has to be
 * suppressed is pressed by the case proving that, not by this walk.
 */
function pickerKeyWalker(
  getByTestId: ReturnType<typeof render>["getByTestId"],
  focusView: jest.SpyInstance,
) {
  return (key: string): string | undefined => {
    fireEvent(getByTestId("moderation-history-actor-picker-group"), "keyDown", {
      nativeEvent: { key },
      preventDefault: () => {},
    });
    const focusedViews = focusView.mock.instances as unknown as {
      props: { testID?: string };
    }[];
    return focusedViews[focusedViews.length - 1]?.props.testID;
  };
}

/** The picker's option rows, in the order they are rendered. */
const actorOptionTestIDs = [
  "moderation-history-actor-option-any",
  "moderation-history-actor-option-user-admin",
  "moderation-history-actor-option-user-colleague",
];

/**
 * The rows Tab stops on, in the order they are rendered. A list of choices
 * is one stop however many rows it has, so this is read across the whole
 * open list rather than a row at a time.
 *
 * The tab order is the browser's idea of the list, and the prop carrying
 * it is one the touchable drops before the view underneath is rendered --
 * which is what leaves a phone's own reach into every row alone -- so it
 * is read off the row rather than out of the rendered view. A row saying
 * nothing is a stop, as it would be with the prop deleted, so only a row
 * that steps aside is counted out.
 */
function actorOptionTabStops(
  getAllByType: ReturnType<typeof render>["UNSAFE_getAllByType"],
): string[] {
  return getAllByType(TouchableOpacity)
    .map((row) => row.props as { testID?: string; tabIndex?: number })
    .filter(
      (row) =>
        row.testID !== undefined &&
        actorOptionTestIDs.includes(row.testID) &&
        row.tabIndex !== -1,
    )
    .map((row) => row.testID as string);
}

/** Serves the moderator list the picker reads, with an empty history. */
function mockActorPickerEndpoints() {
  mockFetch.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.endsWith("/api/moderation/moderators")) {
      return { ok: true, json: async () => ({ moderators: pickerModerators }) };
    }
    return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
  });
}

describe("profile moderation controls", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = "api.example.test";
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    mockFetch.mockReset();
    mockSignOut.mockReset().mockResolvedValue(undefined);
    mockClearLocalKeys.mockReset().mockResolvedValue(undefined);
    mockRefreshAdminAccess.mockReset().mockResolvedValue(undefined);
    mockRouter.push.mockReset();
    mockFocus.callback = null;
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mockUseApp.mockReturnValue(appValue);
  });

  afterEach(() => {
    // A focus callback run by hand is not tied to the rendered screen, so
    // its re-checks have to be stopped here.
    stopFocusedChecks?.();
    stopFocusedChecks = undefined;
  });

  it("does not show account moderation controls to non-administrators", () => {
    const { queryByTestId } = render(<ProfileScreen />);

    expect(queryByTestId("moderation-panel")).toBeNull();
  });

  // The room manager is a modal with no tab and no link anywhere else, so
  // without this control the screen can only be reached by typing its
  // address — which a phone has no way to do.
  it("opens the room manager for an administrator", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ actions: [], nextCursor: null, moderators: [] }),
    });
    const { getByRole } = render(<ProfileScreen />);

    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Open the room manager" }));
    });

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith("/admin-rooms");
  });

  it("does not offer the room manager to non-administrators", () => {
    const { queryByTestId } = render(<ProfileScreen />);

    expect(queryByTestId("room-management-panel")).toBeNull();
    expect(queryByTestId("open-room-manager-button")).toBeNull();
  });

  it("re-checks the moderator role each time the screen is shown again", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ actions: [], nextCursor: null, moderators: [] }),
    });
    render(<ProfileScreen />);
    await waitFor(() => expect(mockRefreshAdminAccess).toHaveBeenCalledTimes(1));

    // Leaving for another tab and coming back re-runs the focus callback.
    await act(async () => {
      stopFocusedChecks = mockFocus.callback?.();
    });

    expect(mockRefreshAdminAccess).toHaveBeenCalledTimes(2);
  });

  it("re-checks the moderator role when the server refuses a moderation request", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/search")) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: "Moderator access is required." }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ actions: [], nextCursor: null, moderators: [] }),
      };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);
    await waitFor(() => expect(mockRefreshAdminAccess).toHaveBeenCalledTimes(1));

    fireEvent.changeText(getByTestId("moderation-search-input"), "grace");
    fireEvent.press(getByTestId("moderation-search-button"));

    expect((await findByTestId("moderation-search-error")).props.children).toBe(
      "Moderator access is required.",
    );
    await waitFor(() => expect(mockRefreshAdminAccess).toHaveBeenCalledTimes(2));
  });

  it("signs out once, shows progress, and preserves the account and room keys", async () => {
    let finish!: () => void;
    mockSignOut.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const { getByRole, getByText, getByTestId } = render(<ProfileScreen />);
    const button = getByRole("button", { name: "Sign out" });
    // Invoke twice in one batch to cover taps before React commits disabled state.
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(getByText("Signing out…")).toBeTruthy();
    expect(getByRole("button", { name: "Sign out" }).props.accessibilityState).toEqual({
      disabled: true, busy: true,
    });
    expect(getByTestId("delete-account-button").props.accessibilityState.disabled).toBe(true);
    await act(async () => finish());
    expect(mockClearLocalKeys).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("announces sign-out failure and allows retry", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("Network unavailable"));
    const { getByRole, findByRole, queryByTestId } = render(<ProfileScreen />);
    fireEvent.press(getByRole("button", { name: "Sign out" }));
    expect((await findByRole("alert")).props.children).toBe("Unable to sign out. Please try again.");
    expect(getByRole("button", { name: "Sign out" }).props.accessibilityState.disabled).toBe(false);
    fireEvent.press(getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(2));
    expect(queryByTestId("sign-out-error")).toBeNull();
  });

  it("keeps the high-contrast connection label legible over its tinted badge", () => {
    const { getByTestId } = render(<ProfileScreen />);
    const badge = getByTestId("profile-connection-status-badge");
    const label = getByTestId("profile-connection-status-text");
    const badgeTextColor = StyleSheet.flatten(label.props.style).color as string;
    const badgeBackground = compositeHex(
      mockColors.online,
      mockColors.background,
      0x20 / 0xff,
    );

    expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe(
      `${mockColors.online}20`,
    );
    expect(badgeTextColor).toBe(mockColors.online);
    expect(contrastRatio(badgeTextColor, badgeBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it("shows the saved avatar and persists a new picker selection", async () => {
    const setAvatarEmoji = jest.fn().mockResolvedValue(undefined);
    mockUseApp.mockReturnValue({ ...appValue, setAvatarEmoji });
    const { getByLabelText, getByTestId, getByText } = render(<ProfileScreen />);

    expect(getByTestId("current-profile-avatar").props.accessibilityLabel).toBe(
      "Ada profile avatar: 👩‍💻",
    );
    expect(getByText("PROFILE AVATAR")).toBeTruthy();

    fireEvent.press(getByLabelText("Choose 🚀 as your profile emoji"));

    await waitFor(() => expect(setAvatarEmoji).toHaveBeenCalledWith("🚀"));
  });

  it("confirms and deletes the signed-in account before clearing local keys", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    const alertSpy = jest.spyOn(require("react-native").Alert, "alert");
    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId("delete-account-button"));
    const actions = alertSpy.mock.calls[0]?.[2] as
      | Array<{ text?: string; onPress?: () => void }>
      | undefined;
    await act(async () => {
      actions?.find(({ text }) => text === "Delete account")?.onPress?.();
    });

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/profile",
        {
          method: "DELETE",
          headers: { Authorization: "Bearer clerk-token" },
        },
      ),
    );
    await waitFor(() => expect(mockClearLocalKeys).toHaveBeenCalledTimes(1));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it("keeps the session available for retry when account deletion fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Account deletion is temporarily unavailable." }),
    });
    const alertSpy = jest.spyOn(require("react-native").Alert, "alert");
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId("delete-account-button"));
    const actions = alertSpy.mock.calls[0]?.[2] as
      | Array<{ text?: string; onPress?: () => void }>
      | undefined;
    await act(async () => {
      actions?.find(({ text }) => text === "Delete account")?.onPress?.();
    });

    expect((await findByTestId("account-deletion-error")).props.children).toBe(
      "Account deletion is temporarily unavailable.",
    );
    expect(mockClearLocalKeys).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("lets an administrator filter history by a searched account", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/search")) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                userId: "user-target",
                username: "Grace Hopper",
                avatarEmoji: "🧑‍💻",
                email: "grace@example.test",
                banned: false,
              },
            ],
          }),
        };
      }
      if (
        typeof url === "string" &&
        url.includes("/api/moderation/history?targetUserId=user-target")
      ) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 4,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.changeText(getByTestId("moderation-search-input"), "grace");
    fireEvent.press(getByTestId("moderation-search-button"));
    fireEvent.press(await findByTestId("moderation-search-result-user-target"));

    fireEvent.press(await findByTestId("moderation-selected-account-filter-history"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?targetUserId=user-target",
        expect.anything(),
      ),
    );
    expect(await findByTestId("moderation-history-entry-4")).toBeTruthy();
    expect(getByTestId("moderation-history-target-filter").props.value).toBe("user-target");
  });

  it("lets an administrator filter history by tapping an account name in a history row", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("actorUserId=user-admin")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 4,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 4,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-entry-4-filter-actor"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-admin",
        expect.anything(),
      ),
    );
    expect(getByTestId("moderation-history-actor-filter").props.value).toBe("user-admin");
  });

  it("does not show moderation history to non-administrators", async () => {
    const { queryByTestId } = render(<ProfileScreen />);

    expect(queryByTestId("moderation-search-input")).toBeNull();
  });

  it("lets an administrator find and select an account before banning it", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/search")) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                userId: "user-target",
                username: "Grace Hopper",
                avatarEmoji: "🧑‍💻",
                email: "grace@example.test",
                banned: false,
              },
              // A second match is what makes the pick worth announcing:
              // with one row there is nothing for a selected state to
              // distinguish it from.
              {
                userId: "user-bystander",
                username: "Grace Kelly",
                avatarEmoji: "🎬",
                email: "kelly@example.test",
                banned: false,
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId, findByTestId, getByText } = render(<ProfileScreen />);

    fireEvent.changeText(getByTestId("moderation-search-input"), "grace");
    fireEvent.press(getByTestId("moderation-search-button"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/search?query=grace",
        expect.objectContaining({
          headers: { Authorization: "Bearer clerk-token" },
        }),
      ),
    );

    // The matches are the one set of accounts to stage next, so they are
    // announced as a group of choices rather than a run of buttons, and a
    // group is only worth announcing if it says what the choices are.
    const results = await findByTestId("moderation-search-results");
    expect(results.props.accessibilityRole).toBe("radiogroup");
    expect(results.props.accessibilityLabel).toBe("Accounts matching your search");
    // Only one account can be staged at a time, so each row is one choice
    // out of the set, and none of them is staged before the pick.
    // React Native Web drops the grouped state before the page is built, so
    // the row carries an aria-checked prop for the browser as well. React
    // Native folds that prop into the checked state on this run, which is
    // what keeps it from being dropped here without anyone noticing; the
    // browser suite is what proves it reaches the rendered page.
    for (const testID of [
      "moderation-search-result-user-target",
      "moderation-search-result-user-bystander",
    ]) {
      expect(getByTestId(testID).props.accessibilityRole).toBe("radio");
      expect(getByTestId(testID).props.accessibilityState?.selected).toBe(false);
      expect(getByTestId(testID).props.accessibilityState?.checked).toBe(false);
    }

    fireEvent.press(await findByTestId("moderation-search-result-user-target"));

    expect(getByText("Selected: Grace Hopper")).toBeTruthy();
    expect(getByTestId("moderation-user-id").props.value).toBe("user-target");
    // The tint is the sighted cue for the staged account, so the announced
    // state has to land on that same row and no other.
    const pickedRow = getByTestId("moderation-search-result-user-target");
    const passedOverRow = getByTestId("moderation-search-result-user-bystander");
    expect(pickedRow.props.accessibilityState?.selected).toBe(true);
    expect(pickedRow.props.accessibilityState?.checked).toBe(true);
    expect(StyleSheet.flatten(pickedRow.props.style).backgroundColor).toBe(
      `${mockColors.primary}20`,
    );
    expect(passedOverRow.props.accessibilityState?.selected).toBe(false);
    expect(passedOverRow.props.accessibilityState?.checked).toBe(false);
    expect(StyleSheet.flatten(passedOverRow.props.style).backgroundColor).toBe(
      "transparent",
    );

    fireEvent.press(getByTestId("ban-account-button"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/ban",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "user-target" }),
        }),
      ),
    );
    expect((await findByTestId("moderation-feedback")).props.children).toBe(
      "Account Grace Hopper (user-target) is banned and can no longer access DevStudioApp.",
    );
  });

  it("shows a search error without exposing account data for a short query", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ actions: [] }) });
    const { getByTestId, findByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.changeText(getByTestId("moderation-search-input"), "a");
    fireEvent.press(getByTestId("moderation-search-button"));

    expect((await findByTestId("moderation-search-error")).props.children).toBe(
      "Enter at least 2 characters to search.",
    );
    expect(
      mockFetch.mock.calls.some(([url]: [string]) => url.includes("/api/moderation/search")),
    ).toBe(false);
    expect(queryByTestId("moderation-search-results")).toBeNull();
  });

  it("lets an administrator filter history by an account selected from search results", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/search")) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                userId: "user-target",
                username: "Grace Hopper",
                avatarEmoji: "🧑‍💻",
                email: "grace@example.test",
                banned: false,
              },
            ],
          }),
        };
      }
      if (typeof url === "string" && url.includes("targetUserId=user-target")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 4,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.changeText(getByTestId("moderation-search-input"), "grace");
    fireEvent.press(getByTestId("moderation-search-button"));
    fireEvent.press(await findByTestId("moderation-search-result-user-target"));

    fireEvent.press(await findByTestId("moderation-selected-account-filter-history"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?targetUserId=user-target",
        expect.anything(),
      ),
    );
    expect(await findByTestId("moderation-history-entry-4")).toBeTruthy();
    expect(getByTestId("moderation-history-target-filter").props.value).toBe("user-target");
  });

  it("lets an administrator filter history by tapping an account name in a history row", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("actorUserId=user-admin")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 4,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 4,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-entry-4-filter-actor"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-admin",
        expect.anything(),
      ),
    );
    expect(getByTestId("moderation-history-actor-filter").props.value).toBe("user-admin");
  });

  it("does not show moderation history to non-administrators", async () => {
    const { queryByTestId } = render(<ProfileScreen />);

    expect(queryByTestId("moderation-history-list")).toBeNull();
    expect(
      mockFetch.mock.calls.some(([url]: [string]) => url.includes("/api/moderation/history")),
    ).toBe(false);
  });

  it("loads and displays moderation history for administrators", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 1,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId } = render(<ProfileScreen />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history",
        expect.objectContaining({ headers: { Authorization: "Bearer clerk-token" } }),
      ),
    );
    const entry = await findByTestId("moderation-history-entry-1");
    expect(entry).toBeTruthy();
  });

  it("lets an administrator filter moderation history by account", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId } = render(<ProfileScreen />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history",
        expect.anything(),
      ),
    );

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-target");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?targetUserId=user-target",
        expect.anything(),
      ),
    );
  });

  it("stops filtering after Clear is pressed", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history",
        expect.anything(),
      ),
    );

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-target");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?targetUserId=user-target",
        expect.anything(),
      ),
    );

    fireEvent.press(await findByTestId("moderation-history-filter-clear"));

    await waitFor(() => {
      const historyCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => typeof url === "string" && url.includes("/api/moderation/history"),
      );
      expect(historyCalls[historyCalls.length - 1]?.[0]).toBe(
        "https://api.example.test/api/moderation/history",
      );
    });
  });

  it("removes only the cleared field when one of two filters is unset", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId } = render(<ProfileScreen />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history",
        expect.anything(),
      ),
    );

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-target");
    fireEvent.changeText(getByTestId("moderation-history-actor-filter"), "admin-ada");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?targetUserId=user-target&actorUserId=admin-ada",
        expect.anything(),
      ),
    );

    fireEvent.changeText(getByTestId("moderation-history-actor-filter"), "");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?targetUserId=user-target",
        expect.anything(),
      ),
    );
  });

  it("lets an administrator filter history by picking an administrator by name", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/api/moderation/moderators")) {
        return {
          ok: true,
          json: async () => ({
            moderators: [
              {
                userId: "user-admin",
                username: "Ada",
                email: "ada@example.test",
                source: "configured",
                grantedBy: null,
                grantedAt: null,
              },
              {
                userId: "user-colleague",
                username: "Grace Hopper",
                email: "grace@example.test",
                source: "granted",
                grantedBy: "user-admin",
                grantedAt: "2026-09-20T10:00:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    fireEvent.press(
      await findByTestId("moderation-history-actor-option-user-colleague"),
    );

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-colleague",
        expect.anything(),
      ),
    );
    // The picked name lands in the field the query reads, so the same
    // filter can then be edited or cleared by hand.
    expect(getByTestId("moderation-history-actor-filter").props.value).toBe(
      "user-colleague",
    );
    expect(getByTestId("moderation-history-actor-picker-label").props.children).toBe(
      "Admin: Grace Hopper",
    );
  });

  it("keeps the account filter when the administrator filter is picked and dropped", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/api/moderation/moderators")) {
        return {
          ok: true,
          json: async () => ({
            moderators: [
              {
                userId: "user-colleague",
                username: "Grace Hopper",
                email: "grace@example.test",
                source: "granted",
                grantedBy: "user-admin",
                grantedAt: "2026-09-20T10:00:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-target");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));
    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    fireEvent.press(
      await findByTestId("moderation-history-actor-option-user-colleague"),
    );

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?targetUserId=user-target&actorUserId=user-colleague",
        expect.anything(),
      ),
    );

    fireEvent.press(getByTestId("moderation-history-actor-picker"));
    fireEvent.press(await findByTestId("moderation-history-actor-option-any"));

    await waitFor(() => {
      const historyCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/api/moderation/history"),
      );
      expect(historyCalls[historyCalls.length - 1]?.[0]).toBe(
        "https://api.example.test/api/moderation/history?targetUserId=user-target",
      );
    });
    expect(getByTestId("moderation-history-actor-filter").props.value).toBe("");
  });

  it("shows a typed administrator ID that belongs to no listed moderator as itself", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/api/moderation/moderators")) {
        return {
          ok: true,
          json: async () => ({
            moderators: [
              {
                userId: "user-colleague",
                username: "Grace Hopper",
                email: "grace@example.test",
                source: "granted",
                grantedBy: "user-admin",
                grantedAt: "2026-09-20T10:00:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    // A former moderator is off the list but still appears in history, so
    // the label must not borrow the name of whoever is listed instead.
    fireEvent.changeText(
      await findByTestId("moderation-history-actor-filter"),
      "user-former",
    );
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-former",
        expect.anything(),
      ),
    );
    expect(getByTestId("moderation-history-actor-picker-label").props.children).toBe(
      "Admin: user-former",
    );
  });

  it("reports whether the administrator picker is open", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId, queryByTestId } = render(<ProfileScreen />);

    // The chevron is the only sighted cue that the list is collapsed, so the
    // toggle has to say so as well.
    expect(
      (await findByTestId("moderation-history-actor-picker")).props.accessibilityState
        ?.expanded,
    ).toBe(false);
    // An expanded state only means something on a control that opens a list
    // of choices, so the toggle has to be announced as that control.
    expect(
      getByTestId("moderation-history-actor-picker").props.accessibilityRole,
    ).toBe("combobox");

    fireEvent.press(getByTestId("moderation-history-actor-picker"));

    expect(await findByTestId("moderation-history-actor-options")).toBeTruthy();
    // The open list is what groups the administrators into one set of
    // choices rather than a run of unrelated controls, and a group is only
    // worth announcing if it says what the choices are for.
    expect(
      getByTestId("moderation-history-actor-options").props.accessibilityRole,
    ).toBe("radiogroup");
    expect(
      getByTestId("moderation-history-actor-options").props.accessibilityLabel,
    ).toBe("Administrators to filter moderation history by");
    expect(
      getByTestId("moderation-history-actor-picker").props.accessibilityState?.expanded,
    ).toBe(true);

    fireEvent.press(getByTestId("moderation-history-actor-picker"));

    expect(queryByTestId("moderation-history-actor-options")).toBeNull();
    expect(
      getByTestId("moderation-history-actor-picker").props.accessibilityState?.expanded,
    ).toBe(false);
  });

  it("closes the administrator picker on Escape and puts focus back on the toggle", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    // Which element is asked to take focus is the point of the test, so the
    // spy records the view it was called on rather than replacing it.
    const focusView = jest.spyOn(View.prototype, "focus");

    try {
      const { getByTestId, findByTestId, queryByTestId } = render(<ProfileScreen />);

      fireEvent.press(await findByTestId("moderation-history-actor-picker"));
      expect(await findByTestId("moderation-history-actor-options")).toBeTruthy();

      // A keyboard user who opened the list by accident should be able to
      // back out of it without tabbing back to the toggle first.
      fireEvent(getByTestId("moderation-history-actor-picker-group"), "keyDown", {
        nativeEvent: { key: "Escape" },
      });

      expect(queryByTestId("moderation-history-actor-options")).toBeNull();
      expect(
        getByTestId("moderation-history-actor-picker").props.accessibilityState
          ?.expanded,
      ).toBe(false);
      // The row focus was on has just been removed, so focus has to be put
      // back deliberately or it falls to the top of the page. Jest does not
      // type the views a spied method was called on, so they are named here.
      const focusedViews = focusView.mock.instances as unknown as {
        props: { testID?: string };
      }[];
      expect(focusedViews.map((view) => view.props.testID)).toEqual([
        "moderation-history-actor-picker",
      ]);
    } finally {
      focusView.mockRestore();
    }
  });

  it("closes the administrator picker when focus moves out of it", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    expect(await findByTestId("moderation-history-actor-options")).toBeTruthy();

    // Standing in for the browser's own elements: the picker asks whether
    // whatever is taking focus next sits inside it.
    const optionRow = {};
    const filterField = {};
    const pickerGroup = { contains: (node: unknown) => node === optionRow };

    // Tabbing from the toggle on to one of its own rows stays in the picker.
    fireEvent(getByTestId("moderation-history-actor-picker-group"), "blur", {
      currentTarget: pickerGroup,
      relatedTarget: optionRow,
    });

    expect(getByTestId("moderation-history-actor-options")).toBeTruthy();
    expect(
      getByTestId("moderation-history-actor-picker").props.accessibilityState?.expanded,
    ).toBe(true);

    // Tabbing past the picker used to leave the list open over the filters.
    fireEvent(getByTestId("moderation-history-actor-picker-group"), "blur", {
      currentTarget: pickerGroup,
      relatedTarget: filterField,
    });

    expect(queryByTestId("moderation-history-actor-options")).toBeNull();
    expect(
      getByTestId("moderation-history-actor-picker").props.accessibilityState?.expanded,
    ).toBe(false);
  });

  it("closes the administrator picker when a press lands outside it", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    expect(await findByTestId("moderation-history-actor-options")).toBeTruthy();

    // Clicking away is how a menu is dismissed, but the panel's own wording
    // takes no focus, so nothing names where focus went and only the press
    // itself reports that the list should go.
    fireEvent(getByTestId("moderation-history-scope"), "pointerDown", {
      nativeEvent: {},
    });

    expect(queryByTestId("moderation-history-actor-options")).toBeNull();
    expect(
      getByTestId("moderation-history-actor-picker").props.accessibilityState?.expanded,
    ).toBe(false);

    // A press the picker claims but the screen never hears about -- one
    // stopped on its way out -- must not be spent on the next press instead.
    fireEvent.press(getByTestId("moderation-history-actor-picker"));
    expect(await findByTestId("moderation-history-actor-options")).toBeTruthy();
    fireEvent(getByTestId("moderation-history-actor-picker"), "pointerDown", {
      nativeEvent: {},
    });
    fireEvent(getByTestId("moderation-history-scope"), "pointerDown", {
      nativeEvent: {},
    });

    expect(queryByTestId("moderation-history-actor-options")).toBeNull();
  });

  it("leaves the administrator list open under a press that starts inside it", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    const row = await findByTestId("moderation-history-actor-option-user-colleague");

    // One press reaches the row and then the screen around it. The testing
    // library hands an event to the nearest handler only, so the screen is
    // given the same press separately, as a browser would.
    const press = { nativeEvent: {} };
    fireEvent(row, "pointerDown", press);
    fireEvent(getByTestId("profile-screen"), "pointerDown", press);

    // Dismissing here would take the row out from under the press still on
    // its way to it.
    expect(getByTestId("moderation-history-actor-options")).toBeTruthy();

    fireEvent.press(row);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-colleague",
        expect.anything(),
      ),
    );
    expect(queryByTestId("moderation-history-actor-options")).toBeNull();
  });

  it("opens the administrator picker and chooses from it with the space bar", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId, queryByTestId } = render(<ProfileScreen />);

    // The space bar presses whatever is focused on the web. Naming the
    // toggle and the rows as a list of choices stops the browser doing that
    // for them, so the picker has to answer the key itself, on the element
    // the key reached. The key arrives at the group around the picker,
    // carrying that element; pressing it is what the browser would have
    // done, so the stand-in here presses the same control.
    const pressSpace = (testID: string) => {
      const pressed = getByTestId(testID);
      let prevented = false;
      fireEvent(getByTestId("moderation-history-actor-picker-group"), "keyDown", {
        nativeEvent: { key: " " },
        preventDefault: () => {
          prevented = true;
        },
        target: { click: () => fireEvent.press(pressed) },
      });
      // A browser scrolls the page a screenful on the space bar, which
      // would carry the log the press just acted on out from under the
      // reader as the list opens.
      expect(prevented).toBe(true);
    };

    await findByTestId("moderation-history-actor-picker");
    pressSpace("moderation-history-actor-picker");
    expect(await findByTestId("moderation-history-actor-options")).toBeTruthy();

    pressSpace("moderation-history-actor-picker");
    expect(queryByTestId("moderation-history-actor-options")).toBeNull();

    pressSpace("moderation-history-actor-picker");
    await findByTestId("moderation-history-actor-options");
    pressSpace("moderation-history-actor-option-user-colleague");

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-colleague",
        expect.anything(),
      ),
    );
    expect(queryByTestId("moderation-history-actor-options")).toBeNull();
  });

  it("walks the open administrator list with the arrow keys", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const focusView = jest.spyOn(View.prototype, "focus");

    try {
      const { getByTestId, findByTestId } = render(<ProfileScreen />);
      fireEvent.press(await findByTestId("moderation-history-actor-picker"));
      await findByTestId("moderation-history-actor-options");
      const walk = pickerKeyWalker(getByTestId, focusView);

      // Focus is still on the toggle, so the first Down has to step into
      // the list rather than past the option at the top of it.
      expect(walk("ArrowDown")).toBe("moderation-history-actor-option-any");
      expect(walk("ArrowDown")).toBe(
        "moderation-history-actor-option-user-admin",
      );
      expect(walk("ArrowDown")).toBe(
        "moderation-history-actor-option-user-colleague",
      );
      // Walking past the end stays on the last administrator: the keys are
      // for moving within the list, and Tab already steps out of it.
      expect(walk("ArrowDown")).toBe(
        "moderation-history-actor-option-user-colleague",
      );

      expect(walk("ArrowUp")).toBe(
        "moderation-history-actor-option-user-admin",
      );
      expect(walk("ArrowUp")).toBe("moderation-history-actor-option-any");
      expect(walk("ArrowUp")).toBe("moderation-history-actor-option-any");

      // The list is still open and the toggle was never asked to take
      // focus back, so the walk stayed inside the picker throughout.
      expect(getByTestId("moderation-history-actor-options")).toBeTruthy();
      const focusedViews = focusView.mock.instances as unknown as {
        props: { testID?: string };
      }[];
      expect(
        focusedViews.some(
          (view) => view.props.testID === "moderation-history-actor-picker",
        ),
      ).toBe(false);
    } finally {
      focusView.mockRestore();
    }
  });

  it("jumps to the ends of the administrator list with Home and End", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const focusView = jest.spyOn(View.prototype, "focus");

    try {
      const { getByTestId, findByTestId } = render(<ProfileScreen />);
      fireEvent.press(await findByTestId("moderation-history-actor-picker"));
      await findByTestId("moderation-history-actor-options");
      const walk = pickerKeyWalker(getByTestId, focusView);

      expect(walk("End")).toBe(
        "moderation-history-actor-option-user-colleague",
      );
      expect(walk("Home")).toBe("moderation-history-actor-option-any");
      // Up from the top of the list has nowhere above it to go, while Up
      // from the toggle enters the list at the bottom.
      expect(walk("End")).toBe(
        "moderation-history-actor-option-user-colleague",
      );
    } finally {
      focusView.mockRestore();
    }
  });

  it("keeps the administrator list from scrolling out from under the walking keys", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    await findByTestId("moderation-history-actor-options");

    // A browser scrolls the page on all four of these by default, which
    // would carry the list being walked off the screen.
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      let prevented = false;
      fireEvent(
        getByTestId("moderation-history-actor-picker-group"),
        "keyDown",
        {
          nativeEvent: { key },
          preventDefault: () => {
            prevented = true;
          },
        },
      );
      expect(prevented).toBe(true);
    }
  });

  it("picks the administrator the arrow keys landed on when Enter is pressed", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const focusView = jest.spyOn(View.prototype, "focus");

    try {
      const { getByTestId, findByTestId, queryByTestId } = render(
        <ProfileScreen />,
      );
      fireEvent.press(await findByTestId("moderation-history-actor-picker"));
      await findByTestId("moderation-history-actor-options");
      const walk = pickerKeyWalker(getByTestId, focusView);

      walk("ArrowDown");
      expect(walk("ArrowDown")).toBe(
        "moderation-history-actor-option-user-admin",
      );

      // Picking is the picker's own answer to the key, so Enter is taken
      // away from the browser as well: left with it, the browser would
      // activate the row focus is still on a second time, on top of the
      // pick just made.
      let prevented = false;
      fireEvent(
        getByTestId("moderation-history-actor-picker-group"),
        "keyDown",
        {
          nativeEvent: { key: "Enter" },
          preventDefault: () => {
            prevented = true;
          },
        },
      );
      expect(prevented).toBe(true);

      // Exactly what pressing that row does: the query is re-run for that
      // administrator and the list closes behind the choice.
      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.example.test/api/moderation/history?actorUserId=user-admin",
          expect.anything(),
        ),
      );
      expect(queryByTestId("moderation-history-actor-options")).toBeNull();
      expect(getByTestId("moderation-history-actor-filter").props.value).toBe(
        "user-admin",
      );
    } finally {
      focusView.mockRestore();
    }
  });

  it("leaves Enter alone until the walk has reached an administrator", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    await findByTestId("moderation-history-actor-options");
    const historyCallsBefore = mockFetch.mock.calls.filter(
      ([url]: [string]) =>
        typeof url === "string" && url.includes("/api/moderation/history"),
    ).length;

    // Focus is still on the toggle, which answers Enter by opening and
    // closing the list. Filtering on whichever administrator happens to be
    // at the top of it instead would be a choice nobody made.
    fireEvent(getByTestId("moderation-history-actor-picker-group"), "keyDown", {
      nativeEvent: { key: "Enter" },
      preventDefault: () => {},
    });

    expect(
      mockFetch.mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/api/moderation/history"),
      ),
    ).toHaveLength(historyCallsBefore);
    expect(getByTestId("moderation-history-actor-options")).toBeTruthy();
  });

  it("continues the walk from the administrator row focus arrived on", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const focusView = jest.spyOn(View.prototype, "focus");

    try {
      const { getByTestId, findByTestId } = render(<ProfileScreen />);
      fireEvent.press(await findByTestId("moderation-history-actor-picker"));
      await findByTestId("moderation-history-actor-options");
      const walk = pickerKeyWalker(getByTestId, focusView);

      // Focus reaches a row without the walking keys as well -- Tab into
      // the list, or a pointer on a row -- so the keys have to carry on
      // from wherever focus is rather than from the top of the list.
      fireEvent(
        getByTestId("moderation-history-actor-option-user-admin"),
        "focus",
      );

      expect(walk("ArrowDown")).toBe(
        "moderation-history-actor-option-user-colleague",
      );
    } finally {
      focusView.mockRestore();
    }
  });

  it("leaves the whole administrator list behind in one Tab press", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { UNSAFE_getAllByType, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    await findByTestId("moderation-history-actor-options");

    // Tabbing past the open list used to cost a press per administrator.
    // One stop for the whole list is what makes it a single press, and
    // the rows it steps over stay reachable by the walking keys.
    expect(actorOptionTabStops(UNSAFE_getAllByType)).toEqual([
      "moderation-history-actor-option-any",
    ]);
  });

  it("keeps every administrator reachable from a phone's own keyboard", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    await findByTestId("moderation-history-actor-options");

    // One stop for the list is a browser's arrangement, and so are the
    // keys that make up for it: a phone has neither, and a keyboard
    // plugged into one moves between the rows it can focus. So every row
    // has to stay focusable here, whichever one a browser tabs to --
    // saying otherwise would leave a keyboard on a phone able to reach a
    // single administrator out of the list.
    for (const testID of actorOptionTestIDs) {
      expect(getByTestId(testID).props.focusable).not.toBe(false);
    }
  });

  it("carries the administrator list's one tab stop along with the walk", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const focusView = jest.spyOn(View.prototype, "focus");

    try {
      const { getByTestId, findByTestId, UNSAFE_getAllByType } = render(
        <ProfileScreen />,
      );
      fireEvent.press(await findByTestId("moderation-history-actor-picker"));
      await findByTestId("moderation-history-actor-options");
      const walk = pickerKeyWalker(getByTestId, focusView);

      walk("ArrowDown");
      walk("ArrowDown");

      // Tab leads on from where the walk got to, rather than back to the
      // top of a list focus has already moved down.
      expect(actorOptionTabStops(UNSAFE_getAllByType)).toEqual([
        "moderation-history-actor-option-user-admin",
      ]);

      walk("End");

      expect(actorOptionTabStops(UNSAFE_getAllByType)).toEqual([
        "moderation-history-actor-option-user-colleague",
      ]);
    } finally {
      focusView.mockRestore();
    }
  });

  it("opens the administrator list with its tab stop on the administrator in effect", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId, UNSAFE_getAllByType } = render(
      <ProfileScreen />,
    );

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));
    fireEvent.press(
      await findByTestId("moderation-history-actor-option-user-colleague"),
    );
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-colleague",
        expect.anything(),
      ),
    );
    fireEvent.press(getByTestId("moderation-history-actor-picker"));
    await findByTestId("moderation-history-actor-options");

    // Focus arriving from outside lands on the administrator being
    // filtered by, not at the top of a list the choice has moved on from.
    expect(actorOptionTabStops(UNSAFE_getAllByType)).toEqual([
      "moderation-history-actor-option-user-colleague",
    ]);

    fireEvent.press(getByTestId("moderation-history-actor-picker"));
    fireEvent.changeText(
      getByTestId("moderation-history-actor-filter"),
      "user-departed",
    );
    fireEvent.press(getByTestId("moderation-history-actor-picker"));
    await findByTestId("moderation-history-actor-options");

    // An id typed by hand, or one belonging to an account that no longer
    // moderates, matches no row. The list still has to be reachable, so
    // the stop falls back to the row at the top of it.
    expect(actorOptionTabStops(UNSAFE_getAllByType)).toEqual([
      "moderation-history-actor-option-any",
    ]);
  });

  it("marks the administrator being filtered by as the picker's selected option", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("moderation-history-actor-picker"));

    // Nothing is filtered yet, so the option that keeps every administrator
    // in view is the one already in effect.
    expect(
      (await findByTestId("moderation-history-actor-option-any")).props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      getByTestId("moderation-history-actor-option-user-admin").props.accessibilityState
        ?.selected,
    ).toBe(false);
    expect(
      getByTestId("moderation-history-actor-option-user-colleague").props
        .accessibilityState?.selected,
    ).toBe(false);
    // Only one administrator can be in effect at a time, so each option has
    // to be announced as one choice out of the set, not its own button.
    for (const testID of [
      "moderation-history-actor-option-any",
      "moderation-history-actor-option-user-admin",
      "moderation-history-actor-option-user-colleague",
    ]) {
      expect(getByTestId(testID).props.accessibilityRole).toBe("radio");
    }

    fireEvent.press(getByTestId("moderation-history-actor-option-user-colleague"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-colleague",
        expect.anything(),
      ),
    );
    fireEvent.press(getByTestId("moderation-history-actor-picker"));

    expect(
      getByTestId("moderation-history-actor-option-user-colleague").props
        .accessibilityState?.selected,
    ).toBe(true);
    expect(
      getByTestId("moderation-history-actor-option-any").props.accessibilityState
        ?.selected,
    ).toBe(false);
    expect(
      getByTestId("moderation-history-actor-option-user-admin").props.accessibilityState
        ?.selected,
    ).toBe(false);
    // One choice out of a set is announced as checked rather than selected,
    // and this is the state a browser reads off the row as well.
    expect(
      getByTestId("moderation-history-actor-option-user-colleague").props
        .accessibilityState?.checked,
    ).toBe(true);
    expect(
      getByTestId("moderation-history-actor-option-any").props.accessibilityState
        ?.checked,
    ).toBe(false);
  });

  it("names the administrator being filtered by in the picker's accessible label", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockActorPickerEndpoints();
    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    expect(
      (await findByTestId("moderation-history-actor-picker")).props.accessibilityLabel,
    ).toBe(
      "Choose an administrator to filter moderation history. Currently Any administrator.",
    );

    fireEvent.press(getByTestId("moderation-history-actor-picker"));
    fireEvent.press(
      await findByTestId("moderation-history-actor-option-user-colleague"),
    );

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?actorUserId=user-colleague",
        expect.anything(),
      ),
    );
    // The id is what the query carries, but it is not what an administrator
    // is known by, so the spoken label has to name them.
    expect(
      getByTestId("moderation-history-actor-picker").props.accessibilityLabel,
    ).toBe(
      "Choose an administrator to filter moderation history. Currently Grace Hopper.",
    );
  });

  it("lets an administrator load older moderation history entries", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("cursor=1")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 1,
                action: "restore",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-01T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: 1,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, getByTestId } = render(<ProfileScreen />);

    expect(await findByTestId("moderation-history-entry-2")).toBeTruthy();
    fireEvent.press(getByTestId("moderation-history-load-more"));

    expect(await findByTestId("moderation-history-entry-1")).toBeTruthy();
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/history?cursor=1",
        expect.anything(),
      ),
    );
  });

  it("keeps a log several pages deep to the rows around the screen", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    // Newest first, as the server returns them.
    const loadedPages = Array.from({ length: 150 }, (_, index) => ({
      id: 150 - index,
      action: "ban",
      actorUserId: "user-admin",
      actorUsername: "Ada",
      targetUserId: `user-${150 - index}`,
      targetUsername: `Member ${150 - index}`,
      targetEmail: null,
      createdAt: "2026-08-20T12:00:00.000Z",
    }));
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({ actions: loadedPages, nextCursor: null }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, getAllByTestId, queryByTestId } = render(<ProfileScreen />);

    // The newest entries are listed, but the pages behind them are not all
    // held on screen at once: an admin who has paged back a long way is
    // scrolling the rows near them, not every row ever loaded.
    expect(await findByTestId("moderation-history-entry-150")).toBeTruthy();
    expect(getAllByTestId(/^moderation-history-entry-\d+$/).length).toBeLessThan(
      loadedPages.length,
    );
    expect(queryByTestId("moderation-history-entry-1")).toBeNull();
  });

  it("offers the newest entries once they have scrolled out of view", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const scrollToOffset = jest
      .spyOn(FlatList.prototype, "scrollToOffset")
      .mockImplementation(() => {});

    try {
      const { findByTestId, getByTestId, queryByTestId } = render(<ProfileScreen />);

      const list = await findByTestId("moderation-history-list");
      expect(queryByTestId("moderation-history-jump-newest")).toBeNull();

      // The profile content above the log is 900 tall, so the newest entry
      // starts there.
      fireEvent(getByTestId("profile-content-header"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 900 } },
      });
      const scroll = (y: number) =>
        fireEvent.scroll(list, {
          nativeEvent: {
            contentOffset: { x: 0, y },
            contentSize: { width: 390, height: 4000 },
            layoutMeasurement: { width: 390, height: 800 },
          },
        });

      // Still above the log: there is nothing to come back to yet.
      scroll(400);
      expect(queryByTestId("moderation-history-jump-newest")).toBeNull();

      scroll(1800);
      fireEvent.press(getByTestId("moderation-history-jump-newest"));

      // Back to the newest entry directly, rather than up through every
      // page loaded on the way down.
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 900, animated: true });
      expect(queryByTestId("moderation-history-jump-newest")).toBeNull();

      // Scrolling leaves the list a batched render of its own on a timer;
      // it is let through here so it lands inside the test.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
    } finally {
      scrollToOffset.mockRestore();
    }
  });

  it("takes the loaded log away when moderator access is revoked", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: 1,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, queryByTestId, rerender } = render(<ProfileScreen />);

    expect(await findByTestId("moderation-history-entry-2")).toBeTruthy();
    expect(queryByTestId("moderation-history-load-more")).not.toBeNull();

    // The rows are the screen list's items rather than content inside the
    // panel, so a revocation that reaches an open screen has to take them
    // with it.
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: false });
    await act(async () => {
      rerender(<ProfileScreen />);
    });

    expect(queryByTestId("moderation-panel")).toBeNull();
    expect(queryByTestId("moderation-history-entry-2")).toBeNull();
    expect(queryByTestId("moderation-history-list")).toBeNull();
    expect(queryByTestId("moderation-history-load-more")).toBeNull();
    expect(queryByTestId("moderation-history-jump-newest")).toBeNull();
  });

  it("leaves the log empty when a reply lands after access is revoked", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    let deliverHistory: (() => void) | undefined;
    const historyReply = new Promise<void>((resolve) => {
      deliverHistory = resolve;
    });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        await historyReply;
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { queryByTestId, rerender } = render(<ProfileScreen />);

    // Access goes while the log's first read is still on its way.
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: false });
    await act(async () => {
      rerender(<ProfileScreen />);
    });
    await act(async () => {
      deliverHistory?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(queryByTestId("moderation-history-entry-2")).toBeNull();
    expect(queryByTestId("moderation-history-list")).toBeNull();

    // Access comes back with its own read still on its way: the reply that
    // landed after the revocation was not kept behind the closed panel.
    mockFetch.mockImplementation(() => new Promise<never>(() => {}));
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    await act(async () => {
      rerender(<ProfileScreen />);
    });

    expect(queryByTestId("moderation-history-entry-2")).toBeNull();
    expect(queryByTestId("moderation-history-list")).toBeNull();
  });

  it("discards a stale load-more response that resolves after filters change", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    let resolveLoadMore: (value: unknown) => void = () => {};
    const loadMorePromise = new Promise((resolve) => {
      resolveLoadMore = resolve;
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("cursor=1")) {
        return loadMorePromise;
      }
      if (typeof url === "string" && url.includes("targetUserId=user-other")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 3,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-other",
                targetUsername: "Other Account",
                targetEmail: null,
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: 1,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, getByTestId, queryByTestId } = render(<ProfileScreen />);

    expect(await findByTestId("moderation-history-entry-2")).toBeTruthy();

    fireEvent.press(getByTestId("moderation-history-load-more"));

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-other");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    expect(await findByTestId("moderation-history-entry-3")).toBeTruthy();

    resolveLoadMore({
      ok: true,
      json: async () => ({
        actions: [
          {
            id: 1,
            action: "restore",
            actorUserId: "user-admin",
            actorUsername: "Ada",
            targetUserId: "user-target",
            targetUsername: "Grace Hopper",
            targetEmail: "grace@example.test",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queryByTestId("moderation-history-entry-1")).toBeNull();
    expect(getByTestId("moderation-history-entry-3")).toBeTruthy();
  });

  it("keeps Load more enabled and usable after filters change while an older load-more request is still pending", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    const hangingLoadMore = new Promise(() => {
      /* never resolves -- represents the superseded, in-flight request */
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url !== "string") return { ok: true, json: async () => ({ ok: true }) };
      if (url.includes("targetUserId=user-other") && url.includes("cursor=9")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 8,
                action: "restore",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-other",
                targetUsername: "Other Account",
                targetEmail: null,
                createdAt: "2026-08-10T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      if (url.includes("targetUserId=user-other")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 5,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-other",
                targetUsername: "Other Account",
                targetEmail: null,
                createdAt: "2026-08-22T00:00:00.000Z",
              },
            ],
            nextCursor: 9,
          }),
        };
      }
      if (url.includes("cursor=1")) {
        return hangingLoadMore;
      }
      if (url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: 1,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, getByTestId } = render(<ProfileScreen />);

    expect(await findByTestId("moderation-history-entry-2")).toBeTruthy();

    // Start a load-more request that will never resolve in this test --
    // it stands in for the superseded, still-in-flight request.
    fireEvent.press(getByTestId("moderation-history-load-more"));

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-other");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    expect(await findByTestId("moderation-history-entry-5")).toBeTruthy();

    const loadMoreButton = getByTestId("moderation-history-load-more");
    expect(loadMoreButton.props.accessibilityState?.disabled).not.toBe(true);

    fireEvent.press(loadMoreButton);

    expect(await findByTestId("moderation-history-entry-8")).toBeTruthy();
  });

  it("keeps the loaded entries and an offered Load more after a failed load-more", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    let loadMoreAttempts = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url !== "string") return { ok: true, json: async () => ({ ok: true }) };
      if (url.includes("cursor=2")) {
        loadMoreAttempts += 1;
        if (loadMoreAttempts === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: "Moderation history is unavailable." }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            actions: [
              {
                id: 1,
                action: "restore",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-01T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      if (url.includes("/api/moderation/history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: 2,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, getByTestId, queryByTestId } = render(<ProfileScreen />);

    expect(await findByTestId("moderation-history-entry-2")).toBeTruthy();
    fireEvent.press(getByTestId("moderation-history-load-more"));

    expect((await findByTestId("moderation-history-error")).props.children).toBe(
      "Moderation history is unavailable.",
    );
    // The failed request asked for older rows; the page already read is
    // still the current answer, so it stays on screen with the button
    // available for another attempt.
    expect(getByTestId("moderation-history-entry-2")).toBeTruthy();
    const loadMore = getByTestId("moderation-history-load-more");
    expect(loadMore.props.accessibilityState?.disabled).not.toBe(true);

    fireEvent.press(loadMore);

    expect(await findByTestId("moderation-history-entry-1")).toBeTruthy();
    expect(getByTestId("moderation-history-entry-2")).toBeTruthy();
    expect(queryByTestId("moderation-history-error")).toBeNull();
    expect(queryByTestId("moderation-history-load-more")).toBeNull();
  });

  it("replaces the listed entries with the error when a reload fails", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url !== "string") return { ok: true, json: async () => ({ ok: true }) };
      if (url.includes("targetUserId=user-other")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "Moderation history is unavailable." }),
        };
      }
      if (url.includes("/api/moderation/history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            actions: [
              {
                id: 2,
                action: "ban",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-08-20T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, getByTestId, queryByTestId } = render(<ProfileScreen />);

    expect(await findByTestId("moderation-history-entry-2")).toBeTruthy();

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-other");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    expect(await findByTestId("moderation-history-error")).toBeTruthy();
    // Those rows answered the previous filter, so they cannot stand in for
    // the query that just failed.
    expect(queryByTestId("moderation-history-entry-2")).toBeNull();
  });

  it("lists current moderators, including those set in server configuration", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/api/moderation/moderators")) {
        return {
          ok: true,
          json: async () => ({
            moderators: [
              {
                userId: "user-admin",
                username: "Ada",
                email: "ada@example.test",
                source: "configured",
                grantedBy: null,
                grantedAt: null,
              },
              {
                userId: "user-target",
                username: "Grace Hopper",
                email: "grace@example.test",
                source: "granted",
                grantedBy: "user-admin",
                grantedAt: "2026-09-20T10:00:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });

    const { findByTestId, queryByTestId, getByText } = render(<ProfileScreen />);

    expect(await findByTestId("moderator-row-user-target")).toBeTruthy();
    expect(getByText("Ada (you)")).toBeTruthy();
    // A configured moderator can only be changed in the server configuration,
    // and a moderator cannot remove their own access.
    expect(queryByTestId("revoke-moderator-user-admin")).toBeNull();
    expect(await findByTestId("revoke-moderator-user-target")).toBeTruthy();
  });

  it("grants moderator access to the selected account and refreshes the list", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    let moderatorListCalls = 0;
    mockFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (typeof url === "string" && url.endsWith("/api/moderation/moderators")) {
        if (options?.method === "POST") {
          return { ok: true, json: async () => ({ ok: true, username: "Grace Hopper" }) };
        }
        moderatorListCalls += 1;
        return {
          ok: true,
          json: async () => ({
            moderators:
              moderatorListCalls > 1
                ? [
                    {
                      userId: "user-target",
                      username: "Grace Hopper",
                      email: "grace@example.test",
                      source: "granted",
                      grantedBy: "user-admin",
                      grantedAt: "2026-09-20T10:00:00.000Z",
                    },
                  ]
                : [],
          }),
        };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });

    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    await waitFor(() => expect(moderatorListCalls).toBe(1));
    fireEvent.changeText(getByTestId("moderation-user-id"), "user-target");
    fireEvent.press(getByTestId("grant-moderator-button"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/moderators",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "user-target" }),
        }),
      ),
    );
    expect((await findByTestId("moderator-feedback")).props.children).toBe(
      "Grace Hopper (user-target) can now moderate DevStudioApp.",
    );
    expect(await findByTestId("moderator-row-user-target")).toBeTruthy();
  });

  it("reports a rejected grant instead of showing it as applied", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (typeof url === "string" && url.endsWith("/api/moderation/moderators")) {
        if (options?.method === "POST") {
          return {
            ok: false,
            json: async () => ({ error: "No account matches that user ID." }),
          };
        }
        return { ok: true, json: async () => ({ moderators: [] }) };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });

    const { getByTestId, findByTestId } = render(<ProfileScreen />);

    fireEvent.changeText(getByTestId("moderation-user-id"), "user-typo");
    fireEvent.press(getByTestId("grant-moderator-button"));

    expect((await findByTestId("moderator-feedback")).props.children).toBe(
      "No account matches that user ID.",
    );
  });

  it("revokes moderator access and refreshes history", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    let moderatorListCalls = 0;
    let historyCalls = 0;
    mockFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/moderation/moderators")) {
        if (options?.method === "DELETE") {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        moderatorListCalls += 1;
        return {
          ok: true,
          json: async () => ({
            moderators:
              moderatorListCalls > 1
                ? []
                : [
                    {
                      userId: "user-target",
                      username: "Grace Hopper",
                      email: "grace@example.test",
                      source: "granted",
                      grantedBy: "user-admin",
                      grantedAt: "2026-09-20T10:00:00.000Z",
                    },
                  ],
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        historyCalls += 1;
        return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const { findByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("revoke-moderator-user-target"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.test/api/moderation/moderators/user-target",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect((await findByTestId("moderator-feedback")).props.children).toBe(
      "Grace Hopper can no longer moderate DevStudioApp.",
    );
    await waitFor(() => expect(queryByTestId("moderator-row-user-target")).toBeNull());
    await waitFor(() => expect(historyCalls).toBe(2));
  });

  it("keeps the known moderators visible when the list cannot be refreshed", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    let moderatorListCalls = 0;
    mockFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/moderation/moderators")) {
        if (options?.method === "DELETE") {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        moderatorListCalls += 1;
        if (moderatorListCalls > 1) {
          return {
            ok: false,
            json: async () => ({ error: "Moderators are temporarily unavailable." }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            moderators: [
              {
                userId: "user-target",
                username: "Grace Hopper",
                email: "grace@example.test",
                source: "granted",
                grantedBy: "user-admin",
                grantedAt: "2026-09-20T10:00:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
    });

    const { findByTestId, getByTestId } = render(<ProfileScreen />);

    fireEvent.press(await findByTestId("revoke-moderator-user-target"));

    expect((await findByTestId("moderator-list-error")).props.children).toBe(
      "Moderators are temporarily unavailable.",
    );
    expect(getByTestId("moderator-row-user-target")).toBeTruthy();
  });

  it("describes moderator grants and revocations in the history list", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return {
          ok: true,
          json: async () => ({
            actions: [
              {
                id: 7,
                action: "grant-moderator",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-target",
                targetUsername: "Grace Hopper",
                targetEmail: "grace@example.test",
                createdAt: "2026-09-20T12:00:00.000Z",
              },
              {
                id: 6,
                action: "revoke-moderator",
                actorUserId: "user-admin",
                actorUsername: "Ada",
                targetUserId: "user-other",
                targetUsername: "Other Account",
                targetEmail: null,
                createdAt: "2026-09-19T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ moderators: [] }) };
    });

    const { findByText } = render(<ProfileScreen />);

    expect(await findByText(/Ada granted moderator access to Grace Hopper/)).toBeTruthy();
    expect(
      await findByText(/Ada removed moderator access from Other Account/),
    ).toBeTruthy();
  });

  it("refreshes moderation history after a ban completes", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    let historyCallCount = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        historyCallCount += 1;
        return { ok: true, json: async () => ({ actions: [] }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const { getByTestId } = render(<ProfileScreen />);

    await waitFor(() => expect(historyCallCount).toBe(1));

    fireEvent.changeText(getByTestId("moderation-user-id"), "user-target");
    fireEvent.press(getByTestId("ban-account-button"));

    await waitFor(() => expect(historyCallCount).toBe(2));
  });

  it("describes the whole log, not only bans and restores, when it is empty", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
      }
      return { ok: true, json: async () => ({ moderators: [] }) };
    });

    const { findByTestId, getByTestId, getByText } = render(<ProfileScreen />);

    expect((await findByTestId("moderation-history-empty")).props.children).toBe(
      "No bans, restores, or moderator access changes yet.",
    );
    expect(getByText("MODERATION HISTORY")).toBeTruthy();
    expect(getByTestId("moderation-history-scope").props.children).toBe(
      "Records bans, restores, and moderator access changes.",
    );
  });

  it("describes the whole log when filters match nothing", async () => {
    mockUseApp.mockReturnValue({ ...appValue, isAdmin: true });
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/moderation/history")) {
        return { ok: true, json: async () => ({ actions: [], nextCursor: null }) };
      }
      return { ok: true, json: async () => ({ moderators: [] }) };
    });

    const { findByTestId, getByTestId } = render(<ProfileScreen />);
    await findByTestId("moderation-history-empty");

    fireEvent.changeText(getByTestId("moderation-history-target-filter"), "user-target");
    fireEvent.press(getByTestId("moderation-history-filter-apply"));

    await waitFor(() =>
      expect(getByTestId("moderation-history-empty").props.children).toBe(
        "No bans, restores, or moderator access changes match these filters.",
      ),
    );
  });
});
