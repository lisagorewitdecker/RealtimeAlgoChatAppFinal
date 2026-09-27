import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { HOST_BOTTOM_INSET_PROPERTY } from "@workspace/hosted-document-inset";

import CallScreen from "../app/call/[roomId]";
import SandboxScreen from "../app/sandbox/[roomId]";

/**
 * The call and sandbox screens hand the documents they host the bottom inset
 * they measured.
 *
 * Everything below their top bar is a document the API server serves into a
 * WebView, and a document owns its own bottom edge: padding around the WebView
 * would shrink the hosted viewport rather than lift the controls inside it.
 * api-server/src/routes/rooms.bottomClearance.test.ts holds those documents to
 * reserving that room, and __tests__/BottomClearance.test.tsx leaves both
 * screens out of the app's own clearance check for the same reason.
 *
 * A document can only read the inset a WebView reports it, and an Android one
 * reports nothing for the gesture navigation strip — the call buttons and the
 * assistant's buttons would sit inside it. The host screen is the side that
 * knows the number, so this file fails if either stops passing it through: not
 * by naming the call it makes, but by running what it hands the WebView and
 * reading the inset the document ends up with.
 *
 * This run builds the app for a device, which is the only place a WebView is
 * drawn at all. __tests__/HostedDocumentInset.test.web.tsx measures the other
 * side of the same boundary, where a browser draws the document in an iframe
 * and tells it even less than an Android WebView does.
 *
 * The inset is the one the platform reported, so a host that hardcoded a
 * height would fail here — the reported one changes below, the way a rotation
 * changes it on a phone, and both values have to arrive.
 */

/** What a phone reports for its gesture strip while these tests run. */
const GESTURE_STRIP = 24;

/** What it reports once something moves the bars, such as a rotation. */
const MOVED_GESTURE_STRIP = 48;

const mockInjectJavaScript = jest.fn();
const mockGetToken = jest.fn();
let mockInsets = { top: 47, bottom: GESTURE_STRIP, left: 0, right: 0 };

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isLoaded: true,
    isSignedIn: true,
  }),
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ roomId: "room-42", roomName: "Compiler room" }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock("@/contexts/AppContext", () => ({
  useApp: () => ({ username: "Ada", avatarEmoji: "👩‍💻" }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#0d0d1a",
    foreground: "#f8fafc",
    secondaryForeground: "#c7d2fe",
    mutedForeground: "#a5b4fc",
    card: "#171B24",
    border: "#343D4C",
    accent: "#22d3ee",
    radius: 10,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock("@expo/vector-icons", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return {
    Feather: ({ name }: { name: string }) =>
      mockReact.createElement(RN.Text, null, name),
  };
});

jest.mock("react-native-webview", () => {
  const RN = require("react-native");
  const mockReact = require("react");

  /**
   * Stands in for the WebView, keeping the two routes a script reaches the
   * document by: the prop it runs once the page has loaded, and the calls a
   * host makes on the ref afterwards. React 19 hands a function component its
   * `ref` as a plain prop, so the ref the screen holds is filled in here the
   * way the real component fills it — once the view exists, and emptied again
   * when it goes away.
   */
  function MockWebView(props: {
    injectedJavaScript?: string;
    ref?: { current: unknown };
  }) {
    const { ref } = props;

    mockReact.useEffect(() => {
      if (!ref) return undefined;
      ref.current = { injectJavaScript: mockInjectJavaScript };
      return () => {
        ref.current = null;
      };
    }, [ref]);

    return mockReact.createElement(RN.Text, {
      testID: "hosted-document",
      injectedJavaScript: props.injectedJavaScript,
    });
  }

  return { __esModule: true, default: MockWebView };
});

/**
 * What `script` leaves the document holding for the host's inset, read off a
 * stand-in for the document it runs in — the one thing a document served by
 * another package and a screen that hosts it agree on by name.
 */
function insetHandedOver(script: unknown): string {
  if (typeof script !== "string") return "no script at all";

  const handedOver = new Map<string, string>();
  const documentDouble = {
    documentElement: {
      style: {
        setProperty(property: string, value: string) {
          handedOver.set(property, value);
        },
      },
    },
  };

  new Function("document", script)(documentDouble);

  return handedOver.get(HOST_BOTTOM_INSET_PROPERTY) ?? "nothing";
}

interface Host {
  /** The document this screen hosts, for the test name. */
  document: string;
  /** The screen itself. */
  Screen: () => React.JSX.Element;
  /** What sits at the document's bottom edge, for the failure message. */
  controls: string;
}

const hosts: Host[] = [
  {
    document: "the call document",
    Screen: CallScreen,
    controls: "the mute, camera and end-call buttons",
  },
  {
    document: "the sandbox document",
    Screen: SandboxScreen,
    controls: "the assistant's ask, cancel, retry and clear buttons",
  },
];

describe.each(hosts)("$document", ({ Screen, controls }) => {
  beforeEach(() => {
    process.env["EXPO_PUBLIC_DOMAIN"] = "api.example.test";
    mockInsets = { top: 47, bottom: GESTURE_STRIP, left: 0, right: 0 };
    mockInjectJavaScript.mockReset();
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
  });

  it(`is handed the inset the platform reports, keeping ${controls} clear`, async () => {
    const { findByTestId } = render(<Screen />);
    const hosted = await findByTestId("hosted-document");

    expect(
      `the document reserves ${insetHandedOver(
        hosted.props.injectedJavaScript,
      )} below ${controls}`,
    ).toBe(`the document reserves ${GESTURE_STRIP}px below ${controls}`);
  });

  it("is handed the new inset when the platform reports one", async () => {
    const { findByTestId, rerender } = render(<Screen />);
    await findByTestId("hosted-document");

    // The prop above is read once, as the page loads, so a phone that turns
    // in the middle of a call reaches the document only through the ref.
    mockInsets = { ...mockInsets, bottom: MOVED_GESTURE_STRIP };
    rerender(<Screen />);

    await waitFor(() => expect(mockInjectJavaScript).toHaveBeenCalled());

    expect(
      `the document reserves ${insetHandedOver(
        mockInjectJavaScript.mock.calls.at(-1)?.[0],
      )} below ${controls}`,
    ).toBe(`the document reserves ${MOVED_GESTURE_STRIP}px below ${controls}`);
  });
});
