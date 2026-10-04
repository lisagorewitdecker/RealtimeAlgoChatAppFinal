import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import ForgotPasswordScreen from "../app/(auth)/forgot-password";
import AiPanel from "../components/AiPanel";
import AdminRoomsScreen from "../app/admin-rooms";
import { ActionSheetIOS } from "react-native";

const mockSendCode = jest.fn();
const mockCreate = jest.fn();
const mockUseSignIn = jest.fn();
const mockGetToken = jest.fn();
const mockFetch = jest.fn();

jest.mock("@clerk/expo", () => ({
  useSignIn: () => mockUseSignIn(),
  useAuth: () => ({ getToken: mockGetToken }),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock("@expo/vector-icons", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return { Feather: ({ name }: { name: string }) => mockReact.createElement(RN.Text, null, name) };
});
jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ fontScale: 1.4, reduceMotion: true }),
}));
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
    muted: "#343D4C",
    bubbleSelf: "#6366f1",
    bubbleSelfText: "#ffffff",
    radius: 10,
  }),
}));

beforeEach(() => {
  mockCreate.mockReset();
  mockSendCode.mockReset();
  mockGetToken.mockReset().mockResolvedValue("token");
  mockFetch.mockReset();
  mockUseSignIn.mockReturnValue({
    signIn: {
      create: mockCreate,
      resetPasswordEmailCode: { sendCode: mockSendCode },
    },
    fetchStatus: "idle",
    errors: null,
  });
});

it("keeps password reset's busy button centered and named at large text size", () => {
  mockCreate.mockImplementation(() => new Promise(() => {}));
  const { getByLabelText, getByPlaceholderText } = render(<ForgotPasswordScreen />);
  fireEvent.changeText(getByPlaceholderText("you@example.com"), "ada@example.com");
  fireEvent.press(getByLabelText("Send reset code"));
  const button = getByLabelText("Send reset code in progress");
  expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({
    alignItems: "center", justifyContent: "center", minHeight: 75.6,
  });
  expect(StyleSheet.flatten(button.findByProps({ testID: "button-spinner" }).props.style)).toMatchObject({
    width: "100%", alignItems: "center", justifyContent: "center",
  });
});

it("announces Resend code, not Verify code, when requesting another code", async () => {
  mockCreate.mockResolvedValue({ error: null });
  mockSendCode.mockResolvedValueOnce({ error: null });
  mockSendCode.mockImplementationOnce(() => new Promise(() => {}));
  const { getByLabelText, getByPlaceholderText } = render(<ForgotPasswordScreen />);
  fireEvent.changeText(getByPlaceholderText("you@example.com"), "ada@example.com");
  fireEvent.press(getByLabelText("Send reset code"));
  await waitFor(() => expect(getByLabelText("Resend code")).toBeTruthy());
  fireEvent.press(getByLabelText("Resend code"));

  const resend = getByLabelText("Resend code in progress");
  expect(resend.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(resend.findByProps({ testID: "button-spinner" })).toBeTruthy();
  expect(getByLabelText("Verify code").props.accessibilityState).toEqual({ disabled: true, busy: false });
});

it("names the busy admin room action and hides its spinner from screen readers", async () => {
  const actionSheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((_options, callback) => {
    callback(1);
  });
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ rooms: [{ id: "room-1", name: "Design Team", memberCount: 2, lastActivityAt: Date.now(), isActive: true }] }),
  });
  mockFetch.mockImplementationOnce(() => new Promise(() => {}));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const { getByLabelText } = render(<AdminRoomsScreen />);
    const row = await waitFor(() => getByLabelText(/Design Team.*Tap for actions/));
    fireEvent.press(row);
    const busyRow = getByLabelText("Closing Design Team in progress");
    expect(busyRow.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(busyRow.findByProps({ testID: "button-spinner" })).toBeTruthy();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  } finally {
    actionSheet.mockRestore();
    globalThis.fetch = previousFetch;
  }
});

it("centers and names the assistant send button while a response is pending", async () => {
  mockFetch.mockImplementation(() => new Promise(() => {}));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const { getByLabelText } = render(<AiPanel roomId="room" />);
    fireEvent.changeText(getByLabelText("Ask AI a coding question"), "Hello");
    fireEvent.press(getByLabelText("Send question to AI"));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const button = getByLabelText("Sending question to AI");
      expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
      expect(StyleSheet.flatten(button.findByProps({ testID: "button-spinner" }).props.style)).toMatchObject({
        width: "100%", alignItems: "center", justifyContent: "center",
      });
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});