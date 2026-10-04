import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import SetupScreen from "../app/setup";
import RootLayout from "../app/_layout";

process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_entry_branding";
let mockIsSignedIn = true;
let mockAccessStatus = "banned";
const mockSignOut = jest.fn();
const mockReplace = jest.fn();

jest.mock("@expo/vector-icons", () => ({
  Feather: () => null,
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-router", () => {
  const mockReact = require("react");
  const RN = require("react-native");
  const Stack = ({ children }: { children: unknown }) =>
    mockReact.createElement(RN.View, null, children);
  Stack.Screen = () => null;
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

jest.mock("@clerk/expo", () => ({
  ClerkLoaded: ({ children }: { children: unknown }) => children,
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: mockIsSignedIn }),
  useClerk: () => ({ signOut: mockSignOut }),
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

jest.mock("react-native-keyboard-controller", () => {
  const mockReact = require("react");
  const RN = require("react-native");
  return {
    KeyboardProvider: ({ children }: { children: unknown }) => children,
    KeyboardAwareScrollView: (props: any) =>
      mockReact.createElement(RN.ScrollView, props),
    KeyboardAvoidingView: (props: any) =>
      mockReact.createElement(RN.View, props),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

jest.mock("@/contexts/AppContext", () => ({
  AppProvider: ({ children }: { children: unknown }) => children,
  useApp: () => ({
    accessStatus: mockAccessStatus,
    isReady: true,
    username: "",
  }),
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  AccessibilityProvider: ({ children }: { children: unknown }) => children,
  useAccessibility: () => ({
    fontScale: 1.0,
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
    secondary: "#1e1b4b",
    secondaryForeground: "#c7d2fe",
    card: "#171B24",
    border: "#343D4C",
    primary: "#6366f1",
    primaryForeground: "#ffffff",
    destructive: "#ef4444",
    muted: "#242938",
    radius: 10,
  }),
}));

describe("entry-screen branding", () => {
  beforeEach(() => {
    mockIsSignedIn = true;
    mockAccessStatus = "banned";
    mockSignOut.mockReset();
    mockReplace.mockClear();
  });

  it("shows the signed-out screen and redirects when Clerk clears the session", async () => {
    const { rerender, getByText, queryByText } = render(<RootLayout />);
    mockIsSignedIn = false;
    rerender(<RootLayout />);
    await waitFor(() => {
      expect(getByText("Sign in to continue")).toBeTruthy();
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    });
    expect(queryByText("Account access blocked")).toBeNull();
  });

  it("uses DevStudioApp on the setup screen", () => {
    const { getByText, queryByText } = render(<SetupScreen />);

    expect(getByText("DevStudioApp")).toBeTruthy();
    expect(queryByText("DevStudio")).toBeNull();
  });

  it("uses DevStudioApp in shared account access messaging", async () => {
    const { getByText, queryByText } = render(<RootLayout />);

    await waitFor(() => {
      expect(
        getByText(
          "This DevStudioApp account has been banned. You cannot join rooms, calls, or sandboxes.",
        ),
      ).toBeTruthy();
      expect(
        queryByText(
          "This DevStudio account has been banned. You cannot join rooms, calls, or sandboxes.",
        ),
      ).toBeNull();
    });
  });
});

describe("root-layout blocked-access sign-out", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(Platform, "OS")!;

  beforeEach(() => {
    mockIsSignedIn = true;
    mockSignOut.mockReset();
    mockReplace.mockClear();
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Platform, "OS", originalPlatform);
  });

  it.each([
    ["banned", "Account access blocked"],
    ["unverified", "Verify your email"],
  ])("allows retry after failed sign-out for %s members", async (status, title) => {
    mockAccessStatus = status;
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    announce.mockClear();
    let rejectSignOut!: (reason: Error) => void;
    mockSignOut.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectSignOut = reject; }),
    );
    const { getByTestId, getByText, getByRole, queryByText, rerender } = render(<RootLayout />);
    expect(getByText(title)).toBeTruthy();
    // The native host exposes responder props; find the composite callback
    // to exercise two taps before React can commit the disabled state.
    let button = getByTestId("blocked-sign-out");
    while (!button.props.onPress && button.parent) button = button.parent;
    const press = button.props.onPress;
    act(() => {
      void press();
      void press();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(getByRole("button", { name: "Signing out" }).props.accessibilityState)
      .toEqual({ busy: true, disabled: true });
    expect(getByText("Signing out…")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Signing out");
    fireEvent.press(getByTestId("blocked-sign-out"));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);

    await act(async () => { rejectSignOut(new Error("Network unavailable")); });
    expect(announce).toHaveBeenNthCalledWith(2, "Unable to sign out. Please try again.");
    expect(getByRole("alert").props.accessibilityLiveRegion).toBe("assertive");
    expect(getByText("Unable to sign out. Please try again.")).toBeTruthy();
    expect(getByRole("button", { name: "Sign out" }).props.accessibilityState)
      .toEqual({ busy: false, disabled: false });
    expect(mockReplace).not.toHaveBeenCalled();

    let resolveSignOut!: () => void;
    mockSignOut.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveSignOut = resolve; }),
    );
    fireEvent.press(getByTestId("blocked-sign-out"));
    expect(mockSignOut).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenNthCalledWith(3, "Signing out");
    expect(queryByText("Unable to sign out. Please try again.")).toBeNull();
    await act(async () => { resolveSignOut(); });
    // Success stays locked while waiting for Clerk's auth-state update.
    expect(getByTestId("blocked-sign-out").props.accessibilityState.busy).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
    mockIsSignedIn = false;
    rerender(<RootLayout />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in"));
    expect(queryByText(title)).toBeNull();
  });

  it("uses live regions without duplicate explicit announcements on Android", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    mockAccessStatus = "unverified";
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    announce.mockClear();
    mockSignOut.mockRejectedValueOnce(new Error("Network unavailable"));
    const { getByRole, getByText, getByTestId } = render(<RootLayout />);

    await act(async () => { fireEvent.press(getByTestId("blocked-sign-out")); });
    expect(getByRole("alert").props.accessibilityLiveRegion).toBe("assertive");
    expect(getByText("Unable to sign out. Please try again.")).toBeTruthy();
    expect(getByRole("button", { name: "Sign out" }).props.accessibilityState)
      .toEqual({ busy: false, disabled: false });
    expect(announce).not.toHaveBeenCalled();
  });
});