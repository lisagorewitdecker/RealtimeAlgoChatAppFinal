import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ActivityIndicator, Alert } from "react-native";
import ChatsScreen from "../app/(tabs)/index";

const mockColors = {
  background: "#000000",
  foreground: "#FFFFFF",
  mutedForeground: "#CCCCCC",
  card: "#0A0A0A",
  border: "#555555",
  primary: "#60BFFF",
  primaryForeground: "#000000",
  destructive: "#FF6060",
  radius: 10,
};

/** Counts screen renders, so a failing poll cannot silently redraw the alert. */
const mockRenders = { count: 0 };
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
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => ({ username: "Ada" }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => {
    mockRenders.count += 1;
    return mockColors;
  },
}));

jest.mock("@/components/RoomCard", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return {
    __esModule: true,
    default: ({ room }: { room: { id: string; name: string } }) =>
      mockReact.createElement(RN.Text, { testID: `room-${room.id}` }, room.name),
  };
});

/** Copy the screen shows; asserted literally because it is the user contract. */
const OFFLINE_COPY =
  "We couldn't reach the server. Check your connection and try again.";
const SERVER_COPY = "The server could not load your rooms right now.";
const SESSION_COPY = "Your session has expired. Sign in again to see your rooms.";

const room = { id: "room-1", name: "Design review", userCount: 2, createdAt: 1 };

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
  const utils = render(<ChatsScreen />);
  await act(async () => {});
  return utils;
}

describe("home screen", () => {
  beforeEach(() => {
    mockRenders.count = 0;
    mockGetToken.mockReset().mockResolvedValue("token");
    mockFetch.mockReset().mockResolvedValue(jsonResponse({ rooms: [] }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows the accessible greeting", async () => {
    const { getByText } = await renderScreen();
    const greeting = getByText("welcome back");

    expect(greeting.props.accessibilityRole).toBe("header");
    expect(greeting.props.role).toBe("heading");
    expect(greeting.props["aria-level"]).toBe(2);
    expect(getByText("Hi, Ada")).toBeTruthy();
  });

  it("uses the palette foreground for the primary action icon", async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId("icon-plus").props.style.color).toBe(
      mockColors.primaryForeground,
    );
  });

  it("leaves the copyright line to the root AppFooter instead of repeating it", async () => {
    const { queryByText } = await renderScreen();

    expect(queryByText(/©/)).toBeNull();
  });

  it("offers to create a room when the account genuinely has none", async () => {
    const { getByTestId, getByText, queryByTestId } = await renderScreen();

    expect(getByTestId("rooms-empty-state")).toBeTruthy();
    expect(getByText("No active rooms")).toBeTruthy();
    expect(getByText("Create one to get started")).toBeTruthy();
    expect(queryByTestId("rooms-error-state")).toBeNull();
    expect(queryByTestId("rooms-retry-button")).toBeNull();
  });

  it.each([
    [
      "the server is unreachable",
      () => mockFetch.mockRejectedValue(networkFailure()),
      OFFLINE_COPY,
    ],
    [
      "the server explains the refusal",
      () =>
        mockFetch.mockResolvedValue(
          jsonResponse({ error: "Account access is temporarily unavailable." }, 503),
        ),
      "Account access is temporarily unavailable.",
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
      "the session is rejected",
      () =>
        mockFetch.mockResolvedValue(jsonResponse({ error: "Authentication required." }, 401)),
      SESSION_COPY,
    ],
    [
      "there is no session token to send",
      () => mockGetToken.mockResolvedValue(null),
      SESSION_COPY,
    ],
  ])("reports the failure instead of an empty list when %s", async (_case, arrange, message) => {
    arrange();

    const { getByTestId, queryByText, queryByTestId } = await renderScreen();

    expect(getByTestId("rooms-error-state")).toBeTruthy();
    const alert = getByTestId("rooms-error-message");
    expect(alert.props.children).toBe(message);
    expect(alert.props.accessibilityRole).toBe("alert");
    expect(getByTestId("rooms-retry-button")).toBeTruthy();
    expect(queryByTestId("rooms-empty-state")).toBeNull();
    expect(queryByText("No active rooms")).toBeNull();
    expect(queryByText("Create one to get started")).toBeNull();
  });

  it("retries once per tap and clears the error when the retry succeeds", async () => {
    let release!: (value: Response) => void;
    mockFetch
      .mockRejectedValueOnce(networkFailure())
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );
    const { getByTestId, getByText, queryByTestId } = await renderScreen();
    expect(getByTestId("rooms-error-state")).toBeTruthy();

    // Both taps land in one batch, covering a second tap before React paints
    // the busy state.
    await act(async () => {
      fireEvent.press(getByTestId("rooms-retry-button"));
      fireEvent.press(getByTestId("rooms-retry-button"));
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getByText("Retrying…")).toBeTruthy();
    expect(getByTestId("rooms-retry-button").props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });

    await act(async () => {
      release(jsonResponse({ rooms: [room] }));
    });

    expect(queryByTestId("rooms-error-state")).toBeNull();
    expect(queryByTestId("rooms-error-banner")).toBeNull();
    expect(getByText("Design review")).toBeTruthy();
  });

  it.each([
    [
      "answers",
      (settle: (value: Response) => void) =>
        settle(jsonResponse({ rooms: [room] })),
      (utils: ReturnType<typeof render>) => {
        expect(utils.getByText("Design review")).toBeTruthy();
        expect(utils.queryByTestId("rooms-error-state")).toBeNull();
      },
    ],
    [
      "fails",
      (_settle: (value: Response) => void, fail: (reason: unknown) => void) =>
        fail(networkFailure()),
      (utils: ReturnType<typeof render>) => {
        expect(utils.getByTestId("rooms-error-state")).toBeTruthy();
        expect(utils.getByTestId("rooms-error-message").props.children).toBe(
          OFFLINE_COPY,
        );
        expect(utils.getByTestId("rooms-retry-button")).toBeTruthy();
      },
    ],
  ])(
    "waits for a request slower than the poll interval and leaves the spinner when it %s",
    async (_case, settleSlowRequest, expectSettled) => {
      jest.useFakeTimers();
      let answer!: (value: Response) => void;
      let fail!: (reason: unknown) => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve, reject) => {
            answer = resolve;
            fail = reject;
          }),
      );

      const utils = await renderScreen();
      expect(utils.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();

      // Three poll ticks pass with the first request still unanswered. A poll
      // that superseded it would discard whatever it finally returns.
      await act(async () => {
        jest.advanceTimersByTime(24000);
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(utils.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();

      await act(async () => {
        settleSlowRequest(answer, fail);
      });

      expect(utils.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
      expectSettled(utils);
    },
  );

  it("keeps a successful retry even when an older poll fails afterwards", async () => {
    jest.useFakeTimers();
    let failStalledPoll!: (reason: unknown) => void;
    mockFetch
      .mockRejectedValueOnce(networkFailure())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_resolve, reject) => {
            failStalledPoll = reject;
          }),
      )
      .mockResolvedValue(jsonResponse({ rooms: [room] }));

    const { getByTestId, getByText, queryByTestId } = await renderScreen();
    expect(getByTestId("rooms-error-state")).toBeTruthy();

    // A background poll starts and stalls on a slow connection.
    await act(async () => {
      jest.advanceTimersByTime(8000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The retry lands while that poll is still in flight.
    await act(async () => {
      fireEvent.press(getByTestId("rooms-retry-button"));
    });
    expect(getByText("Design review")).toBeTruthy();
    expect(queryByTestId("rooms-error-state")).toBeNull();

    // The stalled poll finally fails; it is out of date and must stay silent.
    await act(async () => {
      failStalledPoll(networkFailure());
    });

    expect(queryByTestId("rooms-error-state")).toBeNull();
    expect(queryByTestId("rooms-error-banner")).toBeNull();
    expect(getByText("Design review")).toBeTruthy();
  });

  it("clears the error when a later background poll succeeds", async () => {
    jest.useFakeTimers();
    mockFetch
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValue(jsonResponse({ rooms: [room] }));

    const { getByTestId, getByText, queryByTestId } = await renderScreen();
    expect(getByTestId("rooms-error-state")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(8000);
    });

    expect(queryByTestId("rooms-error-state")).toBeNull();
    expect(queryByTestId("rooms-error-banner")).toBeNull();
    expect(getByText("Design review")).toBeTruthy();
  });

  it("keeps rooms that already loaded visible when a later poll fails", async () => {
    jest.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ rooms: [room] }))
      .mockRejectedValue(networkFailure());

    const { getByTestId, getByText, queryByTestId } = await renderScreen();
    expect(getByText("Design review")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(8000);
    });

    expect(getByTestId("rooms-error-banner")).toBeTruthy();
    expect(getByTestId("rooms-error-message").props.children).toBe(OFFLINE_COPY);
    expect(getByTestId("rooms-retry-button")).toBeTruthy();
    expect(getByText("Design review")).toBeTruthy();
    expect(queryByTestId("rooms-error-state")).toBeNull();
  });

  it("states a continuing failure once instead of on every poll", async () => {
    jest.useFakeTimers();
    const alertPopup = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockFetch.mockRejectedValue(networkFailure());

    const { getAllByTestId, getByTestId, queryByTestId } = await renderScreen();
    expect(getByTestId("rooms-error-state")).toBeTruthy();
    const rendersAtFirstFailure = mockRenders.count;

    for (let poll = 0; poll < 3; poll += 1) {
      await act(async () => {
        jest.advanceTimersByTime(8000);
      });
    }

    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(getAllByTestId("rooms-error-message")).toHaveLength(1);
    expect(getByTestId("rooms-error-message").props.children).toBe(OFFLINE_COPY);
    expect(queryByTestId("rooms-empty-state")).toBeNull();
    expect(alertPopup).not.toHaveBeenCalled();
    // React can re-render a component once while bailing out of an identical
    // state update; three repeats of the same failure must not redraw the
    // alert three times and re-announce it to a screen reader.
    expect(mockRenders.count - rendersAtFirstFailure).toBeLessThanOrEqual(1);

    alertPopup.mockRestore();
  });
});
