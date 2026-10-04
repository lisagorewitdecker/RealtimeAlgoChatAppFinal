import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import SignUpScreen from "../app/(auth)/sign-up";

const mockCreate = jest.fn();
const mockPrepareEmailVerification = jest.fn();
const mockAttemptEmailVerification = jest.fn();
const mockSetActive = jest.fn();
const mockUseAccessibility = jest.fn();

let mockAuthVisualState: string | undefined;
let mockAuthFontScale: string | undefined;
jest.mock("@clerk/expo", () => ({
  useOAuth: () => ({ startOAuthFlow: jest.fn() }),
}));

jest.mock("@clerk/expo/legacy", () => ({
  useSignUp: () => ({
    signUp: {
      create: mockCreate,
      prepareEmailAddressVerification: mockPrepareEmailVerification,
      attemptEmailAddressVerification: mockAttemptEmailVerification,
    },
    setActive: mockSetActive,
    isLoaded: true,
  }),
}));

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

// The form reserves room below itself for the home indicator, which reads the
// inset; __tests__/BottomClearance.test.tsx measures the room it reserves.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return {
    Link: ({ children }: { children: unknown }) =>
      mockReact.createElement(RN.Text, null, children),
    useLocalSearchParams: () => ({
      authVisualState: mockAuthVisualState,
      authFontScale: mockAuthFontScale,
    }),
  };
});

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#0d0d1a",
    foreground: "#f8fafc",
    mutedForeground: "#a5b4fc",
    card: "#171B24",
    border: "#343D4C",
    primary: "#6366f1",
    primaryForeground: "#ffffff",
    destructive: "#ef4444",
    radius: 10,
  }),
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => mockUseAccessibility(),
}));

beforeEach(() => {
  mockAuthVisualState = undefined;
  mockAuthFontScale = undefined;
  mockUseAccessibility.mockReturnValue({
    fontScale: 1.0,
    highContrast: false,
    reduceMotion: false,
  });
});

describe("email account signup", () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue(undefined);
    mockPrepareEmailVerification.mockReset().mockResolvedValue(undefined);
    mockAttemptEmailVerification.mockReset().mockResolvedValue({
      status: "complete",
      createdSessionId: "session-verified",
    });
    mockSetActive.mockReset().mockResolvedValue(undefined);
  });

  it("requires the email code before activating a new session", async () => {
    const { findByPlaceholderText, getByLabelText, getByPlaceholderText } = render(
      <SignUpScreen />,
    );

    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "correct horse battery staple");
    fireEvent.press(getByLabelText("Create account"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        emailAddress: "ada@example.com",
        password: "correct horse battery staple",
      });
      expect(mockPrepareEmailVerification).toHaveBeenCalledWith({
        strategy: "email_code",
      });
    });

    fireEvent.changeText(await findByPlaceholderText("Email verification code"), "123456");
    fireEvent.press(getByLabelText("Verify email"));

    await waitFor(() => {
      expect(mockAttemptEmailVerification).toHaveBeenCalledWith({
        code: "123456",
      });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "session-verified" });
    });
  });

  it("centers the spinner and exposes a named busy signup state", async () => {
    let completeRequest!: (value: unknown) => void;
    mockCreate.mockImplementationOnce(() => new Promise((resolve) => { completeRequest = resolve; }));
    const { getByLabelText, getByPlaceholderText } = render(<SignUpScreen />);
    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "secure password");
    fireEvent.press(getByLabelText("Create account"));

    const busyButton = getByLabelText("Create account in progress");
    expect(busyButton.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(StyleSheet.flatten(busyButton.findByProps({ testID: "button-spinner" }).props.style)).toMatchObject({
      width: "100%", alignItems: "center", justifyContent: "center",
    });
    completeRequest(undefined);
    await waitFor(() => expect(getByLabelText("Verify email").props.accessibilityState.busy).toBe(false));
  });

  it("uses the approved DevStudioApp brand in the signup invitation", () => {
    const { getByText, queryByText } = render(<SignUpScreen />);

    expect(getByText("Join DevStudioApp to chat, call, and build together.")).toBeTruthy();
    expect(queryByText("Join DevStudio to chat, call, and build together.")).toBeNull();
  });

  it("scales auth text and controls at the largest supported font size", () => {
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    const { getByLabelText, getByPlaceholderText, getByText } = render(
      <SignUpScreen />,
    );
    const flatten = (element: { props: { style?: unknown } }) =>
      StyleSheet.flatten(element.props.style);
    const expectStyle = (
      element: { props: { style?: unknown } },
      expected: Record<string, unknown>,
    ) => {
      const style = flatten(element) as Record<string, unknown>;
      Object.entries(expected).forEach(([key, value]) => {
        if (typeof value === "number") {
          expect(style[key]).toBeCloseTo(value);
        } else {
          expect(style[key]).toBe(value);
        }
      });
    };

    expectStyle(getByText("Create your account"), {
      fontSize: 39.2,
      lineHeight: 50.4,
    });
    expectStyle(getByText("Join DevStudioApp to chat, call, and build together."), {
      fontSize: 21,
      lineHeight: 30.8,
    });
    expectStyle(getByPlaceholderText("Email address"), {
      fontSize: 22.4,
      minHeight: 72.8,
      paddingVertical: 16.8,
    });
    expectStyle(getByLabelText("Create account"), {
      minHeight: 72.8,
      paddingVertical: 19.6,
    });
    expectStyle(getByText("Create account"), {
      fontSize: 22.4,
      lineHeight: 30.8,
    });
    expectStyle(getByText("Continue with Google"), {
      fontSize: 21,
      lineHeight: 29.4,
    });
    expectStyle(getByText("Already have an account? Sign in"), {
      fontSize: 19.6,
      lineHeight: 28,
    });
  });

  it("allows a development preview of the 1.4x native sign-up form", () => {
    mockAuthFontScale = "1.4";
    const { getByText, getByPlaceholderText } = render(<SignUpScreen />);

    expect(StyleSheet.flatten(getByText("Create your account").props.style).fontSize).toBeCloseTo(39.2);
    expect(StyleSheet.flatten(getByPlaceholderText("Email address").props.style).minHeight).toBeCloseTo(72.8);
  });

  it("renders the email verification state at the largest supported font size", () => {
    mockAuthVisualState = "email-verification";
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    const { getByLabelText, getByPlaceholderText, getByText, queryByLabelText } =
      render(<SignUpScreen />);

    expect(getByText("Verify your email")).toBeTruthy();
    expect(getByText("Enter the code sent to your email address.")).toBeTruthy();
    expect(getByPlaceholderText("Email verification code")).toBeTruthy();
    expect(getByLabelText("Verify email")).toBeTruthy();
    expect(getByText("Already have an account? Sign in")).toBeTruthy();
    expect(queryByLabelText("Continue with Google")).toBeNull();

    const titleStyle = StyleSheet.flatten(getByText("Verify your email").props.style);
    const codeStyle = StyleSheet.flatten(
      getByPlaceholderText("Email verification code").props.style,
    );
    const buttonStyle = StyleSheet.flatten(getByLabelText("Verify email").props.style);
    expect(titleStyle.fontSize).toBeCloseTo(39.2);
    expect(titleStyle.lineHeight).toBeCloseTo(50.4);
    expect(codeStyle.fontSize).toBeCloseTo(22.4);
    expect(codeStyle.minHeight).toBeCloseTo(72.8);
    expect(buttonStyle.minHeight).toBeCloseTo(72.8);
    expect(buttonStyle.paddingVertical).toBeCloseTo(19.6);
  });

  it("scales signup errors at the largest supported font size", async () => {
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    mockCreate.mockRejectedValueOnce({
      errors: [{ longMessage: "That email address is already in use." }],
    });
    const { getByLabelText, getByPlaceholderText, findByText } = render(
      <SignUpScreen />,
    );

    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "secure password");
    fireEvent.press(getByLabelText("Create account"));

    const error = await findByText("That email address is already in use.");
    expect(StyleSheet.flatten(error.props.style)).toMatchObject({
      fontSize: 18.2,
      lineHeight: 25.2,
    });
  });

  it("keeps long signup errors and navigation controls available at the largest text size", async () => {
    const longError = "This email address is already registered to an existing account. Sign in with that address instead, or use a different email address to create a new account. If you believe this is an error, confirm you are using the correct organization and contact your workspace administrator for help.";
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    mockCreate.mockRejectedValueOnce({
      errors: [{ longMessage: longError }],
    });
    const { getByLabelText, getByPlaceholderText, getByTestId, getByText, findByText } =
      render(<SignUpScreen />);

    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "secure password");
    fireEvent.press(getByLabelText("Create account"));

    const error = await findByText(longError);
    const scroll = getByTestId("auth-scroll-container");
    expect(error.props.accessibilityRole).toBe("alert");
    expect(error.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(error.props.style)).toMatchObject({
      width: "100%",
      maxWidth: "100%",
      flexShrink: 1,
      fontSize: 18.2,
      lineHeight: 25.2,
    });
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
      flexGrow: 1,
      justifyContent: "center",
    });
    expect(getByLabelText("Create account").props.accessibilityState.disabled).toBe(false);
    expect(getByLabelText("Continue with Apple")).toBeTruthy();
    expect(getByText("Already have an account? Sign in")).toBeTruthy();
  });
});
