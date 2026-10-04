import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import AdminRoomsScreen from "../app/admin-rooms";

/**
 * The room manager is where an admin closes and deletes rooms, so a load that
 * quietly fails is dangerous: an outage, a revoked admin role and an account
 * with nothing to manage would all render as an empty list. These tests hold
 * the three apart and cover recovery.
 */

const mockColors = {
  background: "#000000",
  foreground: "#FFFFFF",
  mutedForeground: "#CCCCCC",
  card: "#0A0A0A",
  border: "#555555",
  muted: "#242938",
  secondary: "#1e1b4b",
  primary: "#60BFFF",
  primaryForeground: "#000000",
  destructive: "#FF6060",
  radius: 10,
};

const mockGetToken = jest.fn();
const mockFetch = jest.fn();

jest.mock("@expo/vector-icons", () => ({
  Feather: ({ name, color }: { name: string; color: string }) => {
    const RN = require("react-native");
    return require("react").createElement(
      RN.Text,
      { testID: `icon-${name}`, style: { color } },
      name,
    );
  },
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ fontScale: 1, highContrast: false, reduceMotion: false }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => mockColors,
}));

/** Copy the screen shows; asserted literally because it is the admin contract. */
const OFFLINE_COPY =
  "We couldn't reach the server. Check your connection and try again.";
const SERVER_COPY = "The server could not load the room list right now.";
const SESSION_COPY = "Your session has expired. Sign in again to manage rooms.";
const ACCESS_COPY = "This account no longer has admin access to the room list.";

const room = {
  id: "room-1",
  name: "Design review",
  createdBy: "user-ada",
  createdAt: 1,
  isActive: true,
  memberCount: 2,
  lastActivityAt: 1,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function unreadableResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response;
}

function networkFailure() {
  return new TypeError("Network request failed");
}

const originalFetch = globalThis.fetch;

/** Renders the screen and lets the initial room request settle. */
async function renderScreen() {
  const utils = render(<AdminRoomsScreen />);
  await act(async () => {});
  return utils;
}

describe("admin room manager", () => {
  beforeEach(() => {
    mockGetToken.mockReset().mockResolvedValue("token");
    mockFetch.mockReset().mockResolvedValue(jsonResponse({ rooms: [] }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports a quiet server as an empty list, with nothing to retry", async () => {
    const { getByTestId, getByText, queryByTestId } = await renderScreen();

    expect(getByTestId("admin-rooms-empty-state")).toBeTruthy();
    expect(getByText("No rooms found")).toBeTruthy();
    expect(getByText("0 rooms total")).toBeTruthy();
    expect(queryByTestId("admin-rooms-error-state")).toBeNull();
    expect(queryByTestId("admin-rooms-error-banner")).toBeNull();
    expect(queryByTestId("admin-rooms-retry-button")).toBeNull();
  });

  it.each([
    [
      "the server is unreachable",
      () => mockFetch.mockRejectedValue(networkFailure()),
      OFFLINE_COPY,
    ],
    [
      "the admin role was revoked",
      () =>
        mockFetch.mockResolvedValue(
          jsonResponse({ error: "Admin access required" }, 403),
        ),
      ACCESS_COPY,
    ],
    [
      "the session is rejected",
      () => mockFetch.mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401)),
      SESSION_COPY,
    ],
    [
      "the server explains the refusal",
      () =>
        mockFetch.mockResolvedValue(
          jsonResponse({ error: "Room storage is temporarily unavailable." }, 503),
        ),
      "Room storage is temporarily unavailable.",
    ],
    [
      "the server fails without a message",
      () => mockFetch.mockResolvedValue(jsonResponse(null, 500)),
      SERVER_COPY,
    ],
    [
      "the response body cannot be read",
      () => mockFetch.mockResolvedValue(unreadableResponse()),
      SERVER_COPY,
    ],
    [
      "the answer carries no room list",
      () => mockFetch.mockResolvedValue(jsonResponse({ ok: true })),
      SERVER_COPY,
    ],
  ])(
    "shows a failed load instead of an empty room manager when %s",
    async (_case, arrange, message) => {
      arrange();

      const { getByTestId, queryByText, queryByTestId } = await renderScreen();

      expect(getByTestId("admin-rooms-error-state")).toBeTruthy();
      const alert = getByTestId("admin-rooms-error-message");
      expect(alert.props.children).toBe(message);
      expect(alert.props.accessibilityRole).toBe("alert");
      expect(getByTestId("admin-rooms-retry-button")).toBeTruthy();
      expect(queryByTestId("admin-rooms-empty-state")).toBeNull();
      expect(queryByText("No rooms found")).toBeNull();
      // A count of zero would read as a healthy, empty room manager.
      expect(queryByText("0 rooms total")).toBeNull();
    },
  );

  it("never raises a modal over the failed load", async () => {
    const alertPopup = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockFetch.mockRejectedValue(networkFailure());

    const { getByTestId } = await renderScreen();

    expect(getByTestId("admin-rooms-error-state")).toBeTruthy();
    expect(alertPopup).not.toHaveBeenCalled();
    alertPopup.mockRestore();
  });

  it("retries once per tap and clears the error when the retry succeeds", async () => {
    let release!: (value: Response) => void;
    mockFetch.mockRejectedValueOnce(networkFailure()).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );

    const { getByTestId, getByText, queryByTestId } = await renderScreen();
    expect(getByTestId("admin-rooms-error-state")).toBeTruthy();

    // Both taps land in one batch, covering a second tap before React paints
    // the busy state.
    await act(async () => {
      fireEvent.press(getByTestId("admin-rooms-retry-button"));
      fireEvent.press(getByTestId("admin-rooms-retry-button"));
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getByText("Retrying…")).toBeTruthy();
    expect(getByTestId("admin-rooms-retry-button").props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });

    await act(async () => {
      release(jsonResponse({ rooms: [room] }));
    });

    expect(queryByTestId("admin-rooms-error-state")).toBeNull();
    expect(queryByTestId("admin-rooms-error-banner")).toBeNull();
    expect(getByText("Design review")).toBeTruthy();
    expect(getByText("1 room total")).toBeTruthy();
  });

  it("keeps rooms an admin is acting on visible when a later refresh fails", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ rooms: [room] }))
      .mockRejectedValue(networkFailure());

    const { getByLabelText, getByTestId, getByText, queryByTestId } =
      await renderScreen();
    expect(getByText("Design review")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByLabelText("Refresh rooms"));
    });

    expect(getByTestId("admin-rooms-error-banner")).toBeTruthy();
    expect(getByTestId("admin-rooms-error-message").props.children).toBe(
      OFFLINE_COPY,
    );
    expect(getByTestId("admin-rooms-retry-button")).toBeTruthy();
    expect(getByText("Design review")).toBeTruthy();
    expect(queryByTestId("admin-rooms-error-state")).toBeNull();
    expect(queryByTestId("admin-rooms-empty-state")).toBeNull();
  });

  it("clears the banner when a later refresh succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ rooms: [room] }))
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValue(jsonResponse({ rooms: [room] }));

    const { getByLabelText, getByTestId, getByText, queryByTestId } =
      await renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText("Refresh rooms"));
    });
    expect(getByTestId("admin-rooms-error-banner")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByLabelText("Refresh rooms"));
    });

    expect(queryByTestId("admin-rooms-error-banner")).toBeNull();
    expect(queryByTestId("admin-rooms-error-message")).toBeNull();
    expect(getByText("Design review")).toBeTruthy();
  });

  it("keeps a successful retry even when an older request fails afterwards", async () => {
    let failStalledRefresh!: (reason: unknown) => void;
    mockFetch
      .mockRejectedValueOnce(networkFailure())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_resolve, reject) => {
            failStalledRefresh = reject;
          }),
      )
      .mockResolvedValue(jsonResponse({ rooms: [room] }));

    const { getByLabelText, getByTestId, getByText, queryByTestId } =
      await renderScreen();
    expect(getByTestId("admin-rooms-error-state")).toBeTruthy();

    // A refresh starts and stalls on a slow connection.
    await act(async () => {
      fireEvent.press(getByLabelText("Refresh rooms"));
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The retry lands while that refresh is still in flight.
    await act(async () => {
      fireEvent.press(getByTestId("admin-rooms-retry-button"));
    });
    expect(getByText("Design review")).toBeTruthy();
    expect(queryByTestId("admin-rooms-error-state")).toBeNull();

    // The stalled refresh finally fails; it is out of date and must stay quiet.
    await act(async () => {
      failStalledRefresh(networkFailure());
    });

    expect(queryByTestId("admin-rooms-error-state")).toBeNull();
    expect(queryByTestId("admin-rooms-error-banner")).toBeNull();
    expect(getByText("Design review")).toBeTruthy();
  });
});
