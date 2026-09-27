import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import SignInScreen from "../app/(auth)/sign-in";

const mockCreate = jest.fn();
const mockPrepareFirstFactor = jest.fn();
const mockAttemptFirstFactor = jest.fn();
const mockResetPassword = jest.fn();
const mockSetActive = jest.fn();
const mockUseAccessibility = jest.fn();
const mockStartOAuthFlow = jest.fn();

let mockAuthVisualState: string | undefined;
let mockAuthFontScale: string | undefined;
jest.mock("@clerk/expo", () => ({
  useOAuth: () => ({ startOAuthFlow: mockStartOAuthFlow }),
}));

jest.mock("@clerk/expo/legacy", () => ({
  useSignIn: () => ({
    signIn: {
      create: mockCreate,
      prepareFirstFactor: mockPrepareFirstFactor,
      attemptFirstFactor: mockAttemptFirstFactor,
      resetPassword: mockResetPassword,
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

describe("client trust verification", () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue({
      status: "needs_client_trust",
      supportedFirstFactors: [
        {
          strategy: "email_code",
          emailAddressId: "email-ada",
        },
      ],
    });
    mockPrepareFirstFactor.mockReset().mockResolvedValue(undefined);
    mockAttemptFirstFactor.mockReset().mockResolvedValue({
      status: "complete",
      createdSessionId: "session-trusted",
    });
    mockResetPassword.mockReset();
    mockSetActive.mockReset().mockResolvedValue(undefined);
  });

  it("sends and verifies the Clerk email code", async () => {
    const { findByPlaceholderText, getByLabelText, getByPlaceholderText } = render(
      <SignInScreen />,
    );

    fireEvent.changeText(
      getByPlaceholderText("Email address"),
      "ada@example.com",
    );
    fireEvent.changeText(getByPlaceholderText("Password"), "secure password");
    fireEvent.press(getByLabelText("Sign in"));

    await waitFor(() => {
      expect(mockPrepareFirstFactor).toHaveBeenCalledWith({
        strategy: "email_code",
        emailAddressId: "email-ada",
      });
    });

    fireEvent.changeText(await findByPlaceholderText("6-digit code"), "424242");
    fireEvent.press(getByLabelText("Verify"));

    await waitFor(() => {
      expect(mockAttemptFirstFactor).toHaveBeenCalledWith({
        strategy: "email_code",
        code: "424242",
      });
      expect(mockSetActive).toHaveBeenCalledWith({
        session: "session-trusted",
      });
    });
  });
});

describe("password reset", () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue(undefined);
    mockPrepareFirstFactor.mockReset();
    mockAttemptFirstFactor.mockReset().mockResolvedValue({
      status: "needs_new_password",
    });
    mockResetPassword.mockReset().mockResolvedValue({
      status: "complete",
      createdSessionId: "session-reset",
    });
    mockSetActive.mockReset().mockResolvedValue(undefined);
  });

  it("requests a code, verifies it, and activates the new password", async () => {
    const { findByPlaceholderText, getByLabelText, getByPlaceholderText } = render(
      <SignInScreen />,
    );

    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.press(getByLabelText("Forgot password"));
    fireEvent.press(getByLabelText("Send reset code"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        identifier: "ada@example.com",
      });
    });

    fireEvent.changeText(await findByPlaceholderText("Reset code"), "123456");
    fireEvent.press(getByLabelText("Verify reset code"));

    await waitFor(() => {
      expect(mockAttemptFirstFactor).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        code: "123456",
      });
    });

    fireEvent.changeText(await findByPlaceholderText("New password"), "new secure password");
    fireEvent.press(getByLabelText("Update password"));

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        password: "new secure password",
      });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "session-reset" });
    });
  });

  it("opens the reset form even when no email has been entered", () => {
    const { getByLabelText, getByText } = render(<SignInScreen />);

    fireEvent.press(getByLabelText("Forgot password"));

    expect(getByText("Reset your password")).toBeTruthy();
    expect(getByLabelText("Send reset code")).toBeTruthy();
  });
});

describe("default sign in", () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue(undefined);
    mockPrepareFirstFactor.mockReset();
    mockAttemptFirstFactor.mockReset().mockResolvedValue({
      status: "needs_new_password",
    });
    mockResetPassword.mockReset().mockResolvedValue({
      status: "complete",
      createdSessionId: "session-reset",
    });
    mockSetActive.mockReset().mockResolvedValue(undefined);
  });

  it("uses an accessible workspace heading and lower-case greeting", () => {
    const { getByText } = render(<SignInScreen />);
    const title = getByText("Sign in to your DevStudioApp Workspace");
    const greeting = getByText("welcome back");

    expect(title.props.accessibilityRole).toBe("header");
    expect(title.props.role).toBe("heading");
    expect(title.props["aria-level"]).toBe(1);
    expect(greeting.props.accessibilityRole).toBe("header");
    expect(greeting.props.role).toBe("heading");
    expect(greeting.props["aria-level"]).toBe(2);
    expect(getByText("Sign in to your DevStudioApp workspace.")).toBeTruthy();
  });

  it("renders client-trust verification at the largest supported font size", () => {
    mockAuthVisualState = "client-trust-verification";
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    const { getByLabelText, getByPlaceholderText, getByText, queryByLabelText } =
      render(<SignInScreen />);

    expect(getByText("Verify your account")).toBeTruthy();
    expect(getByText("Enter the code sent to your email.")).toBeTruthy();
    expect(getByPlaceholderText("6-digit code")).toBeTruthy();
    expect(getByLabelText("Verify")).toBeTruthy();
    expect(getByLabelText("Back to sign in")).toBeTruthy();
    expect(queryByLabelText("Continue with Google")).toBeNull();

    const titleStyle = StyleSheet.flatten(
      getByText("Verify your account").props.style,
    );
    const codeStyle = StyleSheet.flatten(
      getByPlaceholderText("6-digit code").props.style,
    );
    expect(titleStyle.fontSize).toBeCloseTo(39.2);
    expect(titleStyle.lineHeight).toBeCloseTo(50.4);
    expect(codeStyle.fontSize).toBeCloseTo(22.4);
    expect(codeStyle.minHeight).toBeCloseTo(72.8);
  });

  it("centers the loading icon and names the busy sign-in action", async () => {
    let completeRequest!: (value: unknown) => void;
    mockCreate.mockImplementationOnce(() => new Promise((resolve) => { completeRequest = resolve; }));
    const { getByLabelText, getByPlaceholderText, queryByLabelText } = render(<SignInScreen />);
    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "secure password");
    fireEvent.press(getByLabelText("Sign in"));

    const busyButton = getByLabelText("Sign in in progress");
    expect(busyButton.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(busyButton.props.accessibilityLiveRegion).toBe("polite");
    expect(StyleSheet.flatten(busyButton.findByProps({ testID: "button-spinner" }).props.style)).toMatchObject({
      width: "100%", alignItems: "center", justifyContent: "center",
    });
    expect(queryByLabelText("Continue with Google")?.props.accessibilityState.disabled).toBe(true);

    completeRequest({ status: "complete", createdSessionId: "session" });
    await waitFor(() => expect(getByLabelText("Sign in").props.accessibilityState.busy).toBe(false));
  });

  it("shows loading on the selected provider, not on Sign in", async () => {
    let completeOAuth!: (value: unknown) => void;
    mockStartOAuthFlow.mockImplementationOnce(() => new Promise((resolve) => { completeOAuth = resolve; }));
    const { getByLabelText } = render(<SignInScreen />);
    fireEvent.press(getByLabelText("Continue with Google"));

    const provider = getByLabelText("Continue with Google in progress");
    expect(provider.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(provider.findByProps({ testID: "button-spinner" })).toBeTruthy();
    expect(getByLabelText("Sign in").props.accessibilityState.busy).toBe(false);

    completeOAuth({ createdSessionId: "session", setActive: mockSetActive });
    await waitFor(() => expect(getByLabelText("Continue with Google").props.accessibilityState.busy).toBe(false));
  });

  it("scales auth text and controls at the largest supported font size", () => {
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    const { getByLabelText, getByPlaceholderText, getByText } = render(
      <SignInScreen />,
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

    expectStyle(getByText("Sign in to your DevStudioApp Workspace"), {
      fontSize: 39.2,
      lineHeight: 50.4,
    });
    expectStyle(getByText("Sign in to your DevStudioApp workspace."), {
      fontSize: 21,
      lineHeight: 30.8,
    });
    expectStyle(getByPlaceholderText("Email address"), {
      fontSize: 22.4,
      minHeight: 72.8,
      paddingVertical: 16.8,
    });
    expectStyle(getByLabelText("Sign in"), {
      minHeight: 72.8,
      paddingVertical: 19.6,
    });
    expectStyle(getByText("Sign in"), {
      fontSize: 22.4,
      lineHeight: 30.8,
    });
    expectStyle(getByText("Continue with Google"), {
      fontSize: 21,
      lineHeight: 29.4,
    });
    expectStyle(getByText("New here? Create an account"), {
      fontSize: 19.6,
      lineHeight: 28,
    });
  });

  it("allows a development preview of the 1.4x native sign-in form", () => {
    mockAuthFontScale = "1.4";
    const { getByText, getByPlaceholderText } = render(<SignInScreen />);

    expect(StyleSheet.flatten(getByText("Sign in to your DevStudioApp Workspace").props.style).fontSize).toBeCloseTo(39.2);
    expect(StyleSheet.flatten(getByPlaceholderText("Email address").props.style).minHeight).toBeCloseTo(72.8);
  });

  it("scales sign-in errors at the largest supported font size", async () => {
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    mockCreate.mockRejectedValueOnce({
      errors: [{ longMessage: "The credentials were not accepted." }],
    });
    const { getByLabelText, getByPlaceholderText, findByText } = render(
      <SignInScreen />,
    );

    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "wrong password");
    fireEvent.press(getByLabelText("Sign in"));

    const error = await findByText("The credentials were not accepted.");
    expect(StyleSheet.flatten(error.props.style)).toMatchObject({
      fontSize: 18.2,
      lineHeight: 25.2,
    });
  });

  it("keeps long sign-in errors and recovery controls available at the largest text size", async () => {
    const longError = "The email address you entered is not associated with an active account. Check that there are no typos, use the email address associated with your workspace, or reset your password to regain access. If you continue to see this message, contact your workspace administrator.";
    mockUseAccessibility.mockReturnValue({
      fontScale: 1.4,
      highContrast: false,
      reduceMotion: false,
    });
    mockCreate.mockRejectedValueOnce({
      errors: [{ longMessage: longError }],
    });
    const { getByLabelText, getByPlaceholderText, getByTestId, getByText, findByText } =
      render(<SignInScreen />);

    fireEvent.changeText(getByPlaceholderText("Email address"), "ada@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "wrong password");
    fireEvent.press(getByLabelText("Sign in"));

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
    expect(getByLabelText("Sign in").props.accessibilityState.disabled).toBe(false);
    expect(getByLabelText("Forgot password")).toBeTruthy();
    expect(getByLabelText("Continue with Apple")).toBeTruthy();
    expect(getByText("New here? Create an account")).toBeTruthy();
  });

  it("keeps the greeting out of password reset variants", () => {
    const { getByLabelText, getByText, queryByText } = render(<SignInScreen />);

    fireEvent.press(getByLabelText("Forgot password"));

    expect(getByText("Reset your password")).toBeTruthy();
    expect(queryByText("welcome back")).toBeNull();
  });

  it("uses the approved brand in the password reset completion state", async () => {
    const { findByPlaceholderText, getByLabelText, getByText } = render(
      <SignInScreen />,
    );

    fireEvent.changeText(
      await findByPlaceholderText("Email address"),
      "ada@example.com",
    );
    fireEvent.press(getByLabelText("Forgot password"));
    fireEvent.press(getByLabelText("Send reset code"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });

    fireEvent.changeText(await findByPlaceholderText("Reset code"), "123456");
    fireEvent.press(getByLabelText("Verify reset code"));

    await waitFor(() => {
      expect(getByText("Choose a new password for your DevStudioApp account.")).toBeTruthy();
    });
  });
});
