import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ActivityIndicator } from "react-native";
import AiPanel from "../components/AiPanel";
import colors from "@/constants/colors";
import SandboxScreen, {
  prepareWebSandboxHtml,
} from "../app/sandbox/[roomId]";

let mockHighContrast = false;
const mockGetToken = jest.fn();
const mockUseAuth = jest.fn();

jest.mock("@clerk/expo", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({
    roomId: "room-42",
    roomName: "Compiler room",
  }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => ({
    username: "Ada",
    avatarEmoji: "👩‍💻",
  }),
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    fontScale: 1,
    highContrast: mockHighContrast,
    reduceMotion: false,
  }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => {
    const palette = require("@/constants/colors").default;
    return {
      ...(mockHighContrast ? palette.highContrast : palette.dark),
      radius: palette.radius,
    };
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return {
    Feather: ({ name, color }: { name: string; color?: string }) =>
      mockReact.createElement(RN.Text, { style: { color } }, name),
  };
});

jest.mock("react-native-webview", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return function MockWebView({ source }: { source: unknown }) {
    return mockReact.createElement(
      RN.Text,
      { testID: "sandbox-webview" },
      JSON.stringify(source),
    );
  };
});

describe("sandbox assistant host", () => {
  beforeEach(() => {
    mockHighContrast = false;
    process.env.EXPO_PUBLIC_DOMAIN = "api.example.test";
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    mockUseAuth.mockReturnValue({
      getToken: mockGetToken,
      isLoaded: true,
      isSignedIn: true,
    });
  });

  it("blocks a signed-out user before the assistant WebView is requested", async () => {
    mockUseAuth.mockReturnValue({
      getToken: mockGetToken,
      isLoaded: true,
      isSignedIn: false,
    });
    const { findByText, queryByTestId } = render(<SandboxScreen />);

    expect(
      await findByText("You need to sign in before opening the sandbox."),
    ).toBeTruthy();
    expect(queryByTestId("sandbox-webview")).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it("loads the room-scoped assistant with a Clerk authorization header", async () => {
    const { findByTestId } = render(<SandboxScreen />);
    const webView = await findByTestId("sandbox-webview");
    const source = JSON.parse(webView.props.children);

    expect(source).toEqual({
      uri: "https://api.example.test/api/rooms/sandbox?roomId=room-42&roomName=Compiler%20room",
      headers: {
        Authorization: "Bearer clerk-token",
      },
    });
  });

  it("keeps the assistant WebView closed when a signed-in session has no token", async () => {
    mockGetToken.mockResolvedValue(null);
    const { findByText, queryByTestId } = render(<SandboxScreen />);

    await waitFor(() =>
      expect(queryByTestId("sandbox-webview")).toBeNull(),
    );
    expect(
      await findByText("Your signed-in session could not be verified. Please sign in again."),
    ).toBeTruthy();
  });

  it("points browser sandbox scripts and Socket.IO at the API origin", () => {
    const document = prepareWebSandboxHtml(
      '<script src="/api/socket-client.js"></script><script>const socket=io({path:"/api/socket.io"})</script>',
      "https://api.example.test",
      // What the browser reported for its home bar, which
      // __tests__/HostedDocumentInset.test.web.tsx measures instead.
      0,
    );

    expect(document).toContain(
      '<script src="https://api.example.test/api/socket-client.js"></script>',
    );
    expect(document).toContain(
      'io("https://api.example.test",{path:"/api/socket.io"})',
    );
  });
});

describe("AI assistant send control accessibility colors", () => {
  beforeEach(() => {
    mockHighContrast = false;
    mockUseAuth.mockReturnValue({
      getToken: mockGetToken,
      isLoaded: true,
      isSignedIn: true,
    });
  });

  it("uses high-contrast foreground tokens for disabled and enabled send controls", () => {
    mockHighContrast = true;
    const { getByLabelText, getByText } = render(
      <AiPanel roomId="room-42" />,
    );
    const input = getByLabelText("Ask AI a coding question");
    const sendButton = getByLabelText("Send question to AI");

    expect(sendButton.props.accessibilityState.disabled).toBe(true);
    expect(getByText("send").props.style).toEqual({
      color: colors.highContrast.mutedForeground,
    });

    fireEvent.changeText(input, "Explain this code");

    expect(sendButton.props.accessibilityState.disabled).toBe(false);
    expect(getByText("send").props.style).toEqual({
      color: colors.highContrast.primaryForeground,
    });
  });

  it("keeps the send control disabled with a readable spinner while sending", async () => {
    mockHighContrast = true;
    const fetchPromise = new Promise<never>(() => {});
    const fetchMock = jest.fn(() => fetchPromise);
    globalThis.fetch = fetchMock as jest.Mock;
    const { getByLabelText, UNSAFE_getAllByType } = render(
      <AiPanel roomId="room-42" />,
    );

    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Explain this code",
    );
    fireEvent.press(getByLabelText("Send question to AI"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(
      getByLabelText("Sending question to AI").props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });
    expect(
      UNSAFE_getAllByType(ActivityIndicator).some(
        (indicator) =>
          indicator.props.color === colors.highContrast.mutedForeground,
      ),
    ).toBe(true);
  });

  it("shows assistant stream errors instead of leaving the pending indicator", async () => {
    const stream = new TextEncoder().encode(
      'data: {"error":"Assistant is temporarily unavailable"}\n\n',
    );
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: jest
            .fn()
            .mockResolvedValueOnce({ done: false, value: stream })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    });
    globalThis.fetch = fetchMock as jest.Mock;
    const { getByLabelText, findByText, queryByText } = render(
      <AiPanel roomId="room-42" />,
    );

    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Explain this code",
    );
    fireEvent.press(getByLabelText("Send question to AI"));

    expect(
      await findByText("Error: Assistant is temporarily unavailable"),
    ).toBeTruthy();
    expect(queryByText("Thinking…")).toBeNull();
  });

  it("keeps the normal-mode send foregrounds unchanged", () => {
    const { getByLabelText, getByText } = render(
      <AiPanel roomId="room-42" />,
    );
    const input = getByLabelText("Ask AI a coding question");
    const sendButton = getByLabelText("Send question to AI");

    expect(sendButton.props.accessibilityState.disabled).toBe(true);
    expect(getByText("send").props.style).toEqual({
      color: colors.dark.mutedForeground,
    });

    fireEvent.changeText(input, "Explain this code");

    expect(sendButton.props.accessibilityState.disabled).toBe(false);
    expect(getByText("send").props.style).toEqual({
      color: colors.dark.primaryForeground,
    });
  });
});
