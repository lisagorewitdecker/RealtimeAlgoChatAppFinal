import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert, Dimensions, StyleSheet, Text, View } from "react-native";
import RoomScreen from "../app/room/[roomId]";
import MessageBubble from "../components/MessageBubble";
import colors from "@/constants/colors";

let mockHighContrast = false;
const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};
const mockHandlers = new Map<string, (payload?: any) => void>();
const mockSocket = {
  on: jest.fn((event: string, handler: (payload?: any) => void) => {
    mockHandlers.set(event, handler);
  }),
  off: jest.fn(),
  emit: jest.fn(),
};
const mockGetToken = jest.fn();
const mockRefreshAdminAccess = jest.fn();
const mockLoadRoomKey = jest.fn(async () => undefined);
const mockSetRoomKey = jest.fn(async () => undefined);
const mockDecryptRoomKeyEnvelope = jest.fn((): Uint8Array | null => null);

jest.mock("@expo/vector-icons", () => ({
  Feather: () => null,
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Error: "error" },
}));

jest.mock("expo-router", () => {
  const mockReact = require("react");
  return {
    useLocalSearchParams: () => ({
      roomId: "room-42",
      roomName: "Compiler room",
    }),
    useRouter: () => mockRouter,
    // The screen re-reads the moderator role whenever it is shown; outside a
    // navigator that is an ordinary mount effect.
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(callback, [callback]);
    },
  };
});

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAvoidingView: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return mockReact.createElement(MockView, props, children);
  },
}));

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => ({
    userId: "user-ben",
    username: "Ben",
    isAdmin: false,
    refreshAdminAccess: mockRefreshAdminAccess,
  }),
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    fontScale: 1.4,
    highContrast: mockHighContrast,
    reduceMotion: false,
  }),
}));

jest.mock("@/contexts/SocketContext", () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

jest.mock("@/contexts/CryptoContext", () => ({
  useCrypto: () => ({
    isReady: true,
    publicKeyB64: "public-key",
    loadRoomKey: mockLoadRoomKey,
    getRoomKey: jest.fn(() => null),
    generateRoomKey: jest.fn(),
    encryptRoomKey: jest.fn(),
    decryptRoomKeyEnvelope: mockDecryptRoomKeyEnvelope,
    setRoomKey: mockSetRoomKey,
    decryptMessage: jest.fn(),
    encryptMessage: jest.fn(),
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

describe("room ban handling", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockHandlers.clear();
    Object.values(mockRouter).forEach((mock) => mock.mockReset());
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.emit.mockClear();
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    mockLoadRoomKey.mockReset().mockResolvedValue(undefined);
    mockSetRoomKey.mockReset().mockResolvedValue(undefined);
    mockDecryptRoomKeyEnvelope.mockReset().mockReturnValue(null);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ ok: true }),
    }) as jest.Mock;
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    const defaultViewport = { width: 402, height: 874, scale: 1, fontScale: 1 };
    Dimensions.set({ window: defaultViewport, screen: defaultViewport });
  });

  it("registers response listeners before requesting to join", () => {
    render(<RoomScreen />);

    const errorRegistrationOrder = mockSocket.on.mock.invocationCallOrder[
      mockSocket.on.mock.calls.findIndex(([event]) => event === "error")
    ];
    const joinOrder = mockSocket.emit.mock.invocationCallOrder[
      mockSocket.emit.mock.calls.findIndex(([event]) => event === "join-room")
    ];

    expect(errorRegistrationOrder).toBeLessThan(joinOrder);
  });

  it("shows room loading feedback until the server confirms the join", async () => {
    const { getByTestId, getByText, queryByTestId } = render(<RoomScreen />);

    expect(getByTestId("room-loading")).toBeTruthy();
    expect(getByText("Opening room…")).toBeTruthy();

    await act(async () => {
      mockHandlers.get("room-joined")?.({
        messages: [],
        users: [],
      });
    });

    expect(queryByTestId("room-loading")).toBeNull();
    expect(getByTestId("room-back-button")).toBeTruthy();
  });

  it("shows a secure-room error when loading the persisted key fails", async () => {
    mockLoadRoomKey.mockRejectedValueOnce(new Error("Storage unavailable"));
    const { getByTestId, getByText, queryByTestId } = render(<RoomScreen />);

    await act(async () => {
      await mockHandlers.get("room-joined")?.({
        messages: [],
        users: [],
      });
    });

    expect(getByTestId("secure-room-error")).toBeTruthy();
    expect(getByText("Secure room unavailable")).toBeTruthy();
    expect(
      getByText(
        "The room key could not be stored securely. No messages were exposed.",
      ),
    ).toBeTruthy();
    expect(queryByTestId("room-header")).toBeNull();
  });

  it("shows a secure-room error when storing a received key fails", async () => {
    mockDecryptRoomKeyEnvelope.mockReturnValueOnce(new Uint8Array(32));
    mockSetRoomKey.mockRejectedValueOnce(new Error("Storage unavailable"));
    const { getByTestId, queryByTestId } = render(<RoomScreen />);

    await act(async () => {
      await mockHandlers.get("room-joined")?.({
        messages: [],
        users: [],
      });
    });
    await act(async () => {
      await mockHandlers.get("room-key-envelope")?.({
        roomId: "room-42",
        ciphertext: "ciphertext",
        nonce: "nonce",
        senderPublicKey: "sender-key",
      });
    });

    expect(getByTestId("secure-room-error")).toBeTruthy();
    expect(queryByTestId("room-header")).toBeNull();
  });

  it("lets a room creator confirm and ban another member", async () => {
    const { getByLabelText, getByTestId, getByText } = render(<RoomScreen />);

    await act(async () => {
      mockHandlers.get("room-joined")?.({
        messages: [],
        users: [
          { userId: "user-ben", username: "Ben" },
          { userId: "user-ada", username: "Ada" },
        ],
        isRoomCreator: true,
      });
    });
    fireEvent.press(getByTestId("room-users-button"));

    expect(getByText("Room moderator controls")).toBeTruthy();
    fireEvent.press(getByLabelText("Ban Ada from this room"));

    const confirmationButtons = alertSpy.mock.calls.at(-1)?.[2];
    const confirmButton = confirmationButtons?.find(
      (button: { text?: string }) => button.text === "Ban",
    );
    await act(async () => {
      confirmButton?.onPress?.();
    });

    expect(mockGetToken).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/moderation/room-42/ban",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer clerk-token",
        }),
        body: JSON.stringify({ userId: "user-ada" }),
      }),
    );
  });

  it("keeps the exact ban explanation visible until explicit return", () => {
    const { getByTestId, getByText, queryByText } = render(<RoomScreen />);

    act(() => {
      mockHandlers.get("error")?.({ code: "ROOM_BANNED" });
    });

    expect(getByTestId("banned-room")).toBeTruthy();
    expect(getByText("Banned from room")).toBeTruthy();
    expect(
      getByText("A room moderator has banned you from this room."),
    ).toBeTruthy();
    expect(queryByText("0 people")).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    fireEvent.press(getByTestId("return-to-room-list-button"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)");
  });

  it("shows the persistent explanation when the current user is banned", () => {
    const { getByTestId } = render(<RoomScreen />);

    act(() => {
      mockHandlers.get("kicked")?.({
        roomId: "room-42",
        userId: "user-ben",
        banned: true,
      });
    });

    expect(getByTestId("banned-room")).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("ignores kick events targeting another user", () => {
    const { queryByTestId } = render(<RoomScreen />);

    act(() => {
      mockHandlers.get("kicked")?.({
        roomId: "room-42",
        userId: "user-other",
        banned: true,
      });
    });

    expect(queryByTestId("banned-room")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("keeps ordinary kicks distinct from bans", () => {
    const { queryByTestId } = render(<RoomScreen />);

    act(() => {
      mockHandlers.get("kicked")?.({
        roomId: "room-42",
        userId: "user-ben",
      });
    });

    expect(queryByTestId("banned-room")).toBeNull();
    expect(alertSpy).toHaveBeenCalledWith(
      "Removed",
      "You have been removed from this room.",
      expect.any(Array),
    );
  });

  it("returns from an active room directly to the room list", async () => {
    const { getByTestId } = render(<RoomScreen />);

    await act(async () => {
      mockHandlers.get("room-joined")?.({
        messages: [],
        users: [],
      });
    });

    fireEvent.press(getByTestId("room-back-button"));

    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)");
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("scales the primary chat composer when larger text is enabled", async () => {
    const { getByPlaceholderText, getByTestId } = render(<RoomScreen />);

    await act(async () => {
      mockHandlers.get("room-joined")?.({
        messages: [],
        users: [],
      });
    });

    const input = getByPlaceholderText("Message…");
    expect(input.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fontSize: 21,
        }),
      ]),
    );
    expect(getByTestId("room-back-button")).toBeTruthy();
  });

  it("keeps the room header and composer inside a narrow 375px viewport", async () => {
    const narrowViewport = { width: 375, height: 720, scale: 1, fontScale: 1.4 };
    Dimensions.set({ window: narrowViewport, screen: narrowViewport });
    const { getByPlaceholderText, getByTestId, getByText } = render(
      <View style={{ width: 375, height: 720 }}>
        <RoomScreen />
      </View>,
    );

    await act(async () => {
      mockHandlers.get("room-joined")?.({
        messages: [],
        users: [],
      });
    });

    const headerCenterStyle = StyleSheet.flatten(
      getByTestId("room-header-center").props.style,
    );
    const headerActionsStyle = StyleSheet.flatten(
      getByTestId("room-header-actions").props.style,
    );
    expect(headerCenterStyle).toEqual(
      expect.objectContaining({ flex: 1, minWidth: 0 }),
    );
    expect(headerActionsStyle).toEqual(
      expect.objectContaining({ flexShrink: 0 }),
    );
    const roomNameStyle = StyleSheet.flatten(getByText("Compiler room").props.style);
    expect(roomNameStyle.fontSize).toBeCloseTo(23.8);
    expect(roomNameStyle.flexShrink).toBe(1);
    expect(roomNameStyle.minWidth).toBe(0);

    const inputStyle = StyleSheet.flatten(
      getByPlaceholderText("Message…").props.style,
    );
    expect(inputStyle).toEqual(
      expect.objectContaining({
        fontSize: 21,
        flexShrink: 1,
        minWidth: 0,
      }),
    );

    const sendButtonStyle = StyleSheet.flatten(
      getByTestId("room-send-button").props.style,
    );
    expect(sendButtonStyle).toEqual(
      expect.objectContaining({ width: 44, flexShrink: 0 }),
    );
    expect(375 - (32 + 22 + 12 + 124)).toBeGreaterThan(0);
  });
});

describe("MessageBubble accessibility colors", () => {
  const message = {
    id: "message-ada",
    content: "The build passed",
    userId: "user-ada",
    username: "Ada",
    timestamp: new Date(2024, 0, 1, 13, 5).getTime(),
    type: "text" as const,
  };

  beforeEach(() => {
    mockHighContrast = false;
  });

  it("uses high-contrast palette tokens for avatars and message metadata", () => {
    mockHighContrast = true;
    const { UNSAFE_getAllByType } = render(
      <MessageBubble message={message} isSelf={false} />,
    );

    const avatar = UNSAFE_getAllByType(View).find(
      (node) => node.props.testID === "message-avatar",
    );
    expect(StyleSheet.flatten(avatar?.props.style).backgroundColor).toBe(
      colors.highContrast.primary,
    );
    const findText = (text: string) =>
      UNSAFE_getAllByType(Text).find((node) => node.props.children === text);
    expect(StyleSheet.flatten(findText("A")?.props.style).color).toBe(
      colors.highContrast.primaryForeground,
    );
    expect(StyleSheet.flatten(findText(message.content)?.props.style).color).toBe(
      colors.highContrast.bubbleOtherText,
    );
    expect(StyleSheet.flatten(findText(message.username)?.props.style).color).toBe(
      colors.highContrast.mutedForeground,
    );

    const timestamp = new Date(message.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(StyleSheet.flatten(findText(timestamp)?.props.style).color).toBe(
      colors.highContrast.mutedForeground,
    );

    const selfBubble = render(
      <MessageBubble message={message} isSelf />,
    );
    const selfMessage = selfBubble
      .UNSAFE_getAllByType(Text)
      .find((node) => node.props.children === message.content);
    expect(StyleSheet.flatten(selfMessage?.props.style).color).toBe(
      colors.highContrast.bubbleSelfText,
    );
  });

  it("keeps the normal-mode message colors unchanged", () => {
    const { UNSAFE_getAllByType } = render(
      <MessageBubble message={message} isSelf={false} />,
    );

    const avatar = UNSAFE_getAllByType(View).find(
      (node) => node.props.testID === "message-avatar",
    );
    expect(StyleSheet.flatten(avatar?.props.style).backgroundColor).toMatch(
      /^hsl\(/,
    );
    const findText = (text: string) =>
      UNSAFE_getAllByType(Text).find((node) => node.props.children === text);
    expect(StyleSheet.flatten(findText("A")?.props.style).color).toBe(
      colors.dark.primaryForeground,
    );
    expect(StyleSheet.flatten(findText(message.content)?.props.style).color).toBe(
      colors.dark.bubbleOtherText,
    );
    expect(StyleSheet.flatten(findText(message.username)?.props.style).color).toBe(
      colors.dark.mutedForeground,
    );
    const timestamp = new Date(message.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(StyleSheet.flatten(findText(timestamp)?.props.style).color).toBe(
      colors.dark.mutedForeground,
    );

    const selfBubble = render(
      <MessageBubble message={message} isSelf />,
    );
    const selfMessage = selfBubble
      .UNSAFE_getAllByType(Text)
      .find((node) => node.props.children === message.content);
    expect(StyleSheet.flatten(selfMessage?.props.style).color).toBe(
      colors.dark.bubbleSelfText,
    );
  });
});