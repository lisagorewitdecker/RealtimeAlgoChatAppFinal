import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Dimensions, StyleSheet, View } from "react-native";
import MessageBubble from "../components/MessageBubble";
import AiPanel from "../components/AiPanel";
import AdminRoomsScreen from "../app/admin-rooms";
import NewRoomScreen from "../app/new-room";
import SetupScreen from "../app/setup";

const mockGetToken = jest.fn();
const mockSetUsername = jest.fn();
const mockUseAccessibility = jest.fn();
const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};
const narrowViewport = { width: 375, height: 720, scale: 1, fontScale: 1.4 };

function renderInNarrowViewport(
  element: React.ReactElement,
  viewport = narrowViewport,
) {
  Dimensions.set({ window: viewport, screen: viewport });
  return render(
    <View
      testID="narrow-viewport"
      style={{ width: viewport.width, height: viewport.height }}
    >
      {element}
    </View>,
  );
}

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => mockUseAccessibility(),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#0d0d1a",
    foreground: "#f8fafc",
    mutedForeground: "#a5b4fc",
    secondary: "#1e1b4b",
    card: "#171B24",
    border: "#343D4C",
    primary: "#6366f1",
    muted: "#242938",
    destructive: "#ef4444",
    bubbleSelf: "#4f46e5",
    bubbleSelfText: "#ffffff",
    bubbleOther: "#242938",
    bubbleOtherText: "#f8fafc",
    systemMsg: "#a5b4fc",
    radius: 10,
  }),
}));

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => ({ setUsername: mockSetUsername }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("react-native-keyboard-controller", () => {
  const ReactModule = require("react");
  const { ScrollView, View: NativeView } = require("react-native");
  return {
    KeyboardAwareScrollView: (props: any) =>
      ReactModule.createElement(ScrollView, props),
    KeyboardAvoidingView: (props: any) =>
      ReactModule.createElement(NativeView, props),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, null, name);
  },
}));

describe("font scale across chat surfaces", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAccessibility.mockReturnValue({ fontScale: 1.4, reduceMotion: false });
    mockGetToken.mockResolvedValue("clerk-token");
  });

  afterEach(() => {
    const defaultViewport = { width: 402, height: 874, scale: 1, fontScale: 1 };
    Dimensions.set({ window: defaultViewport, screen: defaultViewport });
  });

  it("scales message content and keeps the bubble shrinkable", () => {
    const { getByText } = renderInNarrowViewport(
      <MessageBubble
        message={{
          id: "message-1",
          content: "A longer message remains readable at the larger size.",
          userId: "user-1",
          username: "Ada",
          timestamp: 0,
          type: "text",
        }}
        isSelf={false}
      />,
    );

    const content = getByText("A longer message remains readable at the larger size.");
    const style = StyleSheet.flatten(content.props.style);
    expect(style.fontSize).toBe(21);
    expect(style.lineHeight).toBe(29.4);

    expect(StyleSheet.flatten(content.props.style)).toEqual(
      expect.objectContaining({ flexShrink: 1 }),
    );
  });

  it("scales assistant responses and preserves a usable composer", async () => {
    const payload = new TextEncoder().encode(
      'data: {"content":"Use a smaller function and test it.","done":true}\n',
    );
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({ done: false, value: payload })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId, getByText } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "How should I refactor this?",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    const assistant = await waitFor(() =>
      getByText("Use a smaller function and test it."),
    );
    const header = getByText("AI Coding Assistant");
    expect(StyleSheet.flatten(header.props.style).fontSize).toBeCloseTo(19.6);
    const assistantStyle = StyleSheet.flatten(assistant.props.style);
    expect(assistantStyle.fontSize).toBeCloseTo(19.6);
    expect(assistantStyle.lineHeight).toBeCloseTo(31.36);

    const composer = getByLabelText("Ask AI a coding question");
    const composerStyle = StyleSheet.flatten(composer.props.style);
    expect(composerStyle.fontSize).toBeCloseTo(19.6);
    expect(composerStyle.flexShrink).toBe(1);
    expect(composerStyle.minWidth).toBe(0);

    const sendButton = getByLabelText("Send question to AI");
    const sendButtonStyle = StyleSheet.flatten(sendButton.props.style);
    expect(sendButtonStyle.width).toBe(44);
    expect(sendButtonStyle.flexShrink).toBe(0);

    const assistantBubbleStyle = StyleSheet.flatten(
      getByTestId("ai-assistant-bubble").props.style,
    );
    expect(assistantBubbleStyle).toEqual(
      expect.objectContaining({
        flexShrink: 1,
        minWidth: 0,
      }),
    );
    const assistantRowStyle = StyleSheet.flatten(
      getByLabelText("AI assistant: Use a smaller function and test it.").props.style,
    );
    expect(assistantRowStyle).toEqual(
      expect.objectContaining({ maxWidth: "100%", minWidth: 0 }),
    );

    const viewportWidth = narrowViewport.width;
    const horizontalComposerSpace = 28 + 44 + 10;
    expect(viewportWidth - horizontalComposerSpace).toBeGreaterThan(0);
  });

  it("wraps long assistant URLs without changing selectable content at the largest text size", async () => {
    const longToken = `https://example.com/${"a".repeat(180)}`;
    const payload = new TextEncoder().encode(
      `data: ${JSON.stringify({ content: longToken, done: true })}\n`,
    );
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({ done: false, value: payload })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Explain this URL",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(
        getByLabelText(`AI assistant: ${longToken}`),
      ).toBeTruthy(),
    );

    const assistantBubble = getByTestId("ai-assistant-bubble");
    const assistantText = assistantBubble.props.children;
    const renderedContent = assistantText.props.children as string;
    expect(assistantText.props.selectable).toBe(true);
    expect(renderedContent).toBe(longToken);
    expect(renderedContent).not.toContain("\u200B");

    const assistantTextStyle = StyleSheet.flatten(assistantText.props.style);
    expect(assistantTextStyle.fontSize).toBeCloseTo(19.6);
    expect(assistantTextStyle).toEqual(
      expect.objectContaining({
        maxWidth: "100%",
        overflowWrap: "anywhere",
      }),
    );
    expect(narrowViewport.width).toBe(375);
    expect(narrowViewport.fontScale).toBe(1.4);
  });

  it("wraps a long failed-request error without crowding the composer at the largest text size", async () => {
    const diagnostic = `E${"R".repeat(179)}`;
    const errorMessage = `Error: ${diagnostic}`;
    const fetchMock = jest.fn().mockRejectedValue(new Error(diagnostic));
    globalThis.fetch = fetchMock as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Explain this failure",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(getByLabelText(`AI assistant: ${errorMessage}`)).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const errorBubble = getByTestId("ai-assistant-bubble");
    const errorText = errorBubble.props.children;
    expect(errorText.props.selectable).toBe(true);
    expect(errorText.props.children).toBe(errorMessage);
    expect(StyleSheet.flatten(errorBubble.props.style)).toEqual(
      expect.objectContaining({ maxWidth: "88%", flexShrink: 1, minWidth: 0 }),
    );
    const errorTextStyle = StyleSheet.flatten(errorText.props.style);
    expect(errorTextStyle.fontSize).toBeCloseTo(19.6);
    expect(errorTextStyle).toEqual(
      expect.objectContaining({
        maxWidth: "100%",
        overflowWrap: "anywhere",
      }),
    );

    const composer = getByLabelText("Ask AI a coding question");
    fireEvent.changeText(composer, "Try again");
    expect(composer.props.editable).toBe(true);
    expect(composer.props.value).toBe("Try again");
    expect(StyleSheet.flatten(composer.props.style)).toEqual(
      expect.objectContaining({ flexShrink: 1, minWidth: 0 }),
    );
    const sendButton = getByLabelText("Send question to AI");
    expect(sendButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
    expect(StyleSheet.flatten(sendButton.props.style)).toEqual(
      expect.objectContaining({ width: 44, flexShrink: 0 }),
    );
    expect(narrowViewport.width).toBe(375);
    expect(narrowViewport.fontScale).toBe(1.4);
  });

  it("keeps a streamed long assistant URL exact while it wraps at the largest text size", async () => {
    const longToken = `https://example.com/${"b".repeat(180)}`;
    const contentChunks = [
      longToken.slice(0, 48),
      longToken.slice(48, 121),
      longToken.slice(121),
    ];
    const encodedEvents = contentChunks.map((content) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ content })}\n\n`,
      ),
    );
    const firstEvent = encodedEvents[0];
    const splitPoint = Math.floor(firstEvent.length / 2);
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(0, splitPoint),
        })
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(splitPoint),
        })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[1] })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[2] })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"done":true}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Explain this streamed URL",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(
        getByLabelText(`AI assistant: ${longToken}`),
      ).toBeTruthy(),
    );

    const assistantBubble = getByTestId("ai-assistant-bubble");
    const assistantText = assistantBubble.props.children;
    const renderedContent = assistantText.props.children as string;
    expect(assistantText.props.selectable).toBe(true);
    expect(renderedContent).toBe(longToken);
    expect(renderedContent).not.toContain("\u200B");

    const assistantTextStyle = StyleSheet.flatten(assistantText.props.style);
    expect(assistantTextStyle.fontSize).toBeCloseTo(19.6);
    expect(assistantTextStyle).toEqual(
      expect.objectContaining({
        maxWidth: "100%",
        overflowWrap: "anywhere",
      }),
    );
    expect(narrowViewport.width).toBe(375);
    expect(narrowViewport.fontScale).toBe(1.4);
  });

  it("keeps streamed multiline assistant content copy-exact while wrapping at the largest text size", async () => {
    const contentChunks = [
      "Here is the first line.\n",
      "The blank line stays too.\n\n",
      'const value = "exact";\n',
    ];
    const expectedContent = contentChunks.join("");
    const encodedEvents = contentChunks.map((content) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ content })}\n\n`,
      ),
    );
    const firstEvent = encodedEvents[0];
    const splitPoint = Math.floor(firstEvent.length / 2);
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(0, splitPoint),
        })
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(splitPoint),
        })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[1] })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[2] })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"done":true}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Show me an exact multiline example",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(
        getByLabelText(`AI assistant: ${expectedContent}`),
      ).toBeTruthy(),
    );

    const assistantBubble = getByTestId("ai-assistant-bubble");
    const assistantText = assistantBubble.props.children;
    const renderedContent = assistantText.props.children as string;
    expect(assistantText.props.selectable).toBe(true);
    expect(renderedContent).toBe(expectedContent);

    const assistantTextStyle = StyleSheet.flatten(assistantText.props.style);
    expect(assistantTextStyle.fontSize).toBeCloseTo(19.6);
    expect(assistantTextStyle).toEqual(
      expect.objectContaining({
        maxWidth: "100%",
        overflowWrap: "anywhere",
      }),
    );
    expect(narrowViewport.width).toBe(375);
    expect(narrowViewport.fontScale).toBe(1.4);
  });

  it("keeps the final assistant sentence when the stream closes without a trailing newline", async () => {
    const firstContent = "Here is the first line.\n\n";
    const finalContent = "This final sentence must remain.";
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            `data: ${JSON.stringify({ content: firstContent })}\n\n`,
          ),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            `data: ${JSON.stringify({ content: finalContent })}`,
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const expectedContent = firstContent + finalContent;
    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Finish the answer",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(
        getByLabelText(`AI assistant: ${expectedContent}`),
      ).toBeTruthy(),
    );

    const assistantText = getByTestId("ai-assistant-bubble").props.children;
    expect(assistantText.props.selectable).toBe(true);
    expect(assistantText.props.children).toBe(expectedContent);
  });

  it("keeps complete assistant content from CRLF-delimited SSE events selectable", async () => {
    const contentChunks = [
      "The CRLF event boundary stays visible.\n",
      "This second event must not disappear.",
    ];
    const expectedContent = contentChunks.join("");
    const encodedEvents = contentChunks.map((content) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ content })}\r\n\r\n`,
      ),
    );
    const firstEvent = encodedEvents[0];
    const splitPoint = firstEvent.length - 1;
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(0, splitPoint),
        })
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(splitPoint),
        })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[1] })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"done":true}\r\n\r\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Show me the CRLF-safe answer",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(
        getByLabelText(`AI assistant: ${expectedContent}`),
      ).toBeTruthy(),
    );

    const assistantText = getByTestId("ai-assistant-bubble").props.children;
    expect(assistantText.props.selectable).toBe(true);
    expect(assistantText.props.children).toBe(expectedContent);
  });

  it("preserves Unicode content when UTF-8 bytes split inside CRLF SSE events", async () => {
    const contentChunks = [
      "The streamed answer includes a multibyte character: 🧪 ",
      "and café stays exact.",
    ];
    const expectedContent = contentChunks.join("");
    const encodedEvents = contentChunks.map((content) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ content })}\r\n\r\n`,
      ),
    );
    const firstEvent = encodedEvents[0];
    const unicodeBytes = new TextEncoder().encode("🧪");
    const unicodeByteStart = firstEvent.findIndex((byte, index) =>
      unicodeBytes.every(
        (unicodeByte, byteIndex) => firstEvent[index + byteIndex] === unicodeByte,
      ),
    );
    expect(unicodeByteStart).toBeGreaterThanOrEqual(0);
    const splitPoint = unicodeByteStart + 1;
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(0, splitPoint),
        })
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(splitPoint),
        })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[1] })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"done":true}\r\n\r\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Show me the Unicode-safe answer",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(
        getByLabelText(`AI assistant: ${expectedContent}`),
      ).toBeTruthy(),
    );

    const assistantText = getByTestId("ai-assistant-bubble").props.children;
    expect(assistantText.props.selectable).toBe(true);
    expect(assistantText.props.children).toBe(expectedContent);
  });

  it("keeps a streamed long assistant code example exact while it wraps at the largest text size", async () => {
    const contentChunks = [
      "```ts\r\nconst café = \"éclair\";\r\n",
      "// 日本語コメント — keep UTF-8 bytes exact\r\n",
      "function normalize(input: string): string {\r\n",
      "  return input.trim();\r\n}\r\n",
      "console.log(normalize(café));\r\n",
      "```\r\n",
    ];
    const codeExample = contentChunks.join("");
    const encodedEvents = contentChunks.map((content) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ content })}\n\n`,
      ),
    );
    const firstEvent = encodedEvents[0];
    const unicodeBytes = new TextEncoder().encode("é");
    const unicodeByteStart = firstEvent.findIndex(
      (byte, index) =>
        byte === unicodeBytes[0] && firstEvent[index + 1] === unicodeBytes[1],
    );
    expect(unicodeByteStart).toBeGreaterThanOrEqual(0);
    const splitPoint = unicodeByteStart + 1;
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(0, splitPoint),
        })
        .mockResolvedValueOnce({
          done: false,
          value: firstEvent.slice(splitPoint),
        })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[1] })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[2] })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[3] })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[4] })
        .mockResolvedValueOnce({ done: false, value: encodedEvents[5] })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"done":true}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Explain this streamed code",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() =>
      expect(
        getByLabelText(`AI assistant: ${codeExample}`),
      ).toBeTruthy(),
    );

    const assistantBubble = getByTestId("ai-assistant-bubble");
    const assistantText = assistantBubble.props.children;
    const renderedContent = assistantText.props.children as string;
    expect(assistantText.props.selectable).toBe(true);
    expect(renderedContent).toBe(codeExample);
    expect(new TextEncoder().encode(renderedContent)).toEqual(
      new TextEncoder().encode(codeExample),
    );
    expect(renderedContent).not.toContain("\u200B");

    const assistantTextStyle = StyleSheet.flatten(assistantText.props.style);
    expect(assistantTextStyle.fontSize).toBeCloseTo(19.6);
    expect(assistantTextStyle).toEqual(
      expect.objectContaining({
        maxWidth: "100%",
        overflowWrap: "anywhere",
      }),
    );
    expect(narrowViewport.width).toBe(375);
    expect(narrowViewport.fontScale).toBe(1.4);
  });

  it("renders every chunk of a long successful assistant answer in order", async () => {
    const contentChunks = Array.from(
      { length: 256 },
      (_, index) =>
        `Chunk ${String(index).padStart(3, "0")}: ${"Assistant stream content ".repeat(3)}\n`,
    );
    const expectedContent = contentChunks.join("");
    const reader = { read: jest.fn() };

    for (const content of contentChunks) {
      reader.read.mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(
          `data: ${JSON.stringify({ content })}\r\n\r\n`,
        ),
      });
    }
    reader.read
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode('data: {"done":true}\r\n\r\n'),
      })
      .mockResolvedValueOnce({ done: true, value: undefined });

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }) as jest.Mock;

    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <AiPanel roomId="room-1" />,
    );
    fireEvent.changeText(
      getByLabelText("Ask AI a coding question"),
      "Give me a long answer",
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Send question to AI"));
    });

    await waitFor(() => {
      const assistantText = getByTestId("ai-assistant-bubble").props.children;
      expect(assistantText.props.children).toBe(expectedContent);
    });

    const assistantText = getByTestId("ai-assistant-bubble").props.children;
    expect(assistantText.props.selectable).toBe(true);
    expect(assistantText.props.children).toBe(expectedContent);
    expect(expectedContent.length).toBeGreaterThan(20_000);
    expect(reader.read).toHaveBeenCalledTimes(contentChunks.length + 2);
  });

  it("scales admin room text without clipping the room card content", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        rooms: [
          {
            id: "room-1",
            name: "A room with a longer name",
            createdBy: "user-1",
            createdAt: 0,
            isActive: true,
            memberCount: 3,
            lastActivityAt: null,
          },
        ],
      }),
    }) as jest.Mock;

    const { getByText } = render(<AdminRoomsScreen />);
    const roomName = await waitFor(() => getByText("A room with a longer name"));

    const roomNameStyle = StyleSheet.flatten(roomName.props.style);
    expect(roomNameStyle.fontSize).toBe(21);
    expect(roomName.props.numberOfLines).toBeUndefined();

  });

  it("scales setup text and grows its controls at the largest supported size", () => {
    const { getByPlaceholderText, getByText, getByTestId } = render(<SetupScreen />);

    const headlineStyle = StyleSheet.flatten(getByText("DevStudioApp").props.style);
    expect(headlineStyle.fontSize).toBeCloseTo(39.2);

    const capabilityStyle = StyleSheet.flatten(getByText("WebRTC video rooms with peers").props.style);
    expect(capabilityStyle.fontSize).toBeCloseTo(21);
    expect(capabilityStyle.flexShrink).toBe(1);

    const input = getByPlaceholderText("How should your team know you?");
    expect(StyleSheet.flatten(input.props.style)).toEqual(
      expect.objectContaining({
        fontSize: 22.4,
        minHeight: 72.8,
      }),
    );

    const buttonText = getByText("Enter workspace");
    expect(StyleSheet.flatten(buttonText.props.style)).toEqual(
      expect.objectContaining({ fontSize: 22.4, flexShrink: 1 }),
    );
    expect(StyleSheet.flatten(getByTestId("setup-submit-button").props.style)).toEqual(
      expect.objectContaining({ minHeight: 75.6, flexWrap: "wrap" }),
    );
    const hintStyle = StyleSheet.flatten(
      getByText("Choose the display name your team will see.").props.style,
    );
    expect(hintStyle.fontSize).toBeCloseTo(16.8);
    expect(hintStyle.lineHeight).toBeCloseTo(25.2);
  });

  it("keeps setup controls available in a reduced-height large-text scroll area", async () => {
    const reducedViewport = { ...narrowViewport, height: 400 };
    const { getByTestId, getByPlaceholderText } = renderInNarrowViewport(
      <SetupScreen />,
      reducedViewport,
    );
    const scrollView = getByTestId("setup-keyboard-scroll");
    const input = getByTestId("setup-display-name-input");

    expect(scrollView.props.keyboardShouldPersistTaps).toBe("handled");
    expect(scrollView.props.bottomOffset).toBeCloseTo(86.8);
    expect(StyleSheet.flatten(scrollView.props.contentContainerStyle)).toEqual(
      expect.objectContaining({ paddingTop: 84, paddingBottom: 58 }),
    );
    expect(input.props.returnKeyType).toBe("done");
    expect(input.props.onSubmitEditing).toEqual(expect.any(Function));
    expect(getByPlaceholderText("How should your team know you?")).toBe(input);

    fireEvent(input, "focus");
    fireEvent.changeText(input, "Ada");
    await act(async () => {
      fireEvent.press(getByTestId("setup-submit-button"));
    });

    expect(mockSetUsername).toHaveBeenCalledWith("Ada");
    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)");
  });

  it("scales new-room labels, fields, and actions without clipping", () => {
    const { getByPlaceholderText, getByText, getByTestId } = render(<NewRoomScreen />);

    expect(StyleSheet.flatten(getByText("New Room").props.style).fontSize).toBeCloseTo(28);
    expect(StyleSheet.flatten(getByText("Create").props.style)).toEqual(
      expect.objectContaining({ fontSize: 21, flexShrink: 1 }),
    );

    const input = getByPlaceholderText("e.g. Design Team");
    expect(StyleSheet.flatten(input.props.style)).toEqual(
      expect.objectContaining({
        fontSize: 22.4,
        minHeight: 72.8,
      }),
    );

    const buttonText = getByText("Create Room");
    expect(StyleSheet.flatten(buttonText.props.style)).toEqual(
      expect.objectContaining({ fontSize: 22.4, flexShrink: 1 }),
    );
    expect(StyleSheet.flatten(getByTestId("room-submit-button").props.style)).toEqual(
      expect.objectContaining({ minHeight: 75.6, flexWrap: "wrap" }),
    );

    fireEvent.press(getByText("Join"));
    const roomIdInput = getByPlaceholderText("e.g. design-team-a3b2");
    expect(StyleSheet.flatten(getByText("ROOM ID").props.style).fontSize).toBeCloseTo(15.4);
    expect(StyleSheet.flatten(roomIdInput.props.style)).toEqual(
      expect.objectContaining({ fontSize: 22.4, minHeight: 72.8 }),
    );
  });

  it("keeps create and join actions wired in a reduced-height large-text scroll area", () => {
    const reducedViewport = { ...narrowViewport, height: 400 };
    const { getByTestId, getByPlaceholderText, getByText } = renderInNarrowViewport(
      <NewRoomScreen />,
      reducedViewport,
    );
    const scrollView = getByTestId("new-room-scroll-container");
    const createInput = getByPlaceholderText("e.g. Design Team");

    expect(scrollView.props.keyboardShouldPersistTaps).toBe("handled");
    expect(scrollView.props.bottomOffset).toBeCloseTo(112);
    expect(StyleSheet.flatten(scrollView.props.contentContainerStyle)).toEqual(
      expect.objectContaining({ paddingTop: 24, paddingBottom: 58 }),
    );
    expect(createInput.props.autoFocus).toBe(true);
    expect(createInput.props.returnKeyType).toBe("done");
    expect(createInput.props.onSubmitEditing).toEqual(expect.any(Function));

    fireEvent(createInput, "focus");
    fireEvent.changeText(createInput, "Design Team");
    fireEvent.press(getByTestId("room-submit-button"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/room\/design-team-/),
    );

    fireEvent.press(getByText("Join"));
    const joinInput = getByPlaceholderText("e.g. design-team-a3b2");
    expect(joinInput).toBe(createInput);
    expect(joinInput.props.autoFocus).toBe(true);
    expect(joinInput.props.returnKeyType).toBe("done");
    expect(joinInput.props.onSubmitEditing).toEqual(expect.any(Function));

    fireEvent(joinInput, "focus");
    fireEvent.changeText(joinInput, "design-team");
    fireEvent.press(getByTestId("room-submit-button"));
    expect(mockRouter.push).toHaveBeenLastCalledWith("/room/design-team");
  });

  it("keeps the Join field and action usable after switching from Create with the keyboard open", () => {
    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <NewRoomScreen />,
    );

    fireEvent.changeText(getByLabelText("Room name"), "Design Team");
    fireEvent.press(getByLabelText("Join room mode"));
    fireEvent.changeText(getByLabelText("Room ID"), "room-42");
    fireEvent.press(getByLabelText("Create room mode"));

    const focusedInput = getByLabelText("Room name");
    fireEvent(focusedInput, "focus");
    const scrollContainer = getByTestId("new-room-scroll-container");
    expect(scrollContainer.props.keyboardShouldPersistTaps).toBe("handled");
    expect(scrollContainer.props.bottomOffset).toBeCloseTo(112);

    fireEvent.press(getByLabelText("Join room mode"));

    const replacementInput = getByLabelText("Room ID");
    expect(replacementInput).toBe(focusedInput);
    expect(replacementInput.props.autoFocus).toBe(true);
    expect(StyleSheet.flatten(replacementInput.props.style)).toEqual(
      expect.objectContaining({ fontSize: 22.4, minHeight: 72.8 }),
    );
    const submitButton = getByTestId("room-submit-button");
    expect(submitButton.props.accessibilityLabel).toBe("Join room");
    expect(submitButton.props.accessibilityState.disabled).toBe(false);

    fireEvent.press(submitButton);
    expect(mockRouter.push).toHaveBeenCalledWith("/room/room-42");
  });

  it("keeps the Create field and action usable after switching from Join with the keyboard open", () => {
    const { getByLabelText, getByTestId } = renderInNarrowViewport(
      <NewRoomScreen />,
    );

    fireEvent.changeText(getByLabelText("Room name"), "Design Team");
    fireEvent.press(getByLabelText("Join room mode"));
    fireEvent.changeText(getByLabelText("Room ID"), "room-42");

    const focusedInput = getByLabelText("Room ID");
    fireEvent(focusedInput, "focus");
    fireEvent.press(getByLabelText("Create room mode"));

    const replacementInput = getByLabelText("Room name");
    expect(replacementInput).toBe(focusedInput);
    expect(replacementInput.props.autoFocus).toBe(true);
    expect(StyleSheet.flatten(replacementInput.props.style)).toEqual(
      expect.objectContaining({ fontSize: 22.4, minHeight: 72.8 }),
    );
    const submitButton = getByTestId("room-submit-button");
    expect(submitButton.props.accessibilityLabel).toBe("Create room");
    expect(submitButton.props.accessibilityState.disabled).toBe(false);

    fireEvent.press(submitButton);
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/room\/design-team-[a-z0-9]{4}\?roomName=Design%20Team&create=true$/,
      ),
    );
  });
});