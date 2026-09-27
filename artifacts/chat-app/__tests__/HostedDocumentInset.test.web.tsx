import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import {
  HOSTED_BOTTOM_INSET,
  HOST_BOTTOM_INSET_PROPERTY,
} from "@workspace/hosted-document-inset";

import CallScreen from "../app/call/[roomId]";
import SandboxScreen from "../app/sandbox/[roomId]";
import { WEB_HOME_BAR_INSET } from "../lib/webHomeBar";
import {
  DESKTOP_BROWSER,
  PHONE_BROWSER,
  browseWith,
  restoreBrowserPointer,
} from "../test-support/browserPointer";

/**
 * What the call and sandbox screens hand the documents they host when the app
 * is a page in a browser.
 *
 * __tests__/HostedDocumentInset.test.tsx measures the device side of the same
 * boundary, where the document is drawn in a WebView. A browser draws it in
 * an iframe instead, and that is the one place the document can see nothing
 * at all: a page inside an iframe is never told the window's safe-area
 * insets, so the `env()` half of the room it reserves (see
 * api-server/src/routes/rooms.bottomClearance.test.ts, which holds the served
 * documents to reserving it) resolves to zero however the phone underneath is
 * held. Unless the host sets the property, both halves are zero and the
 * assistant's buttons sit under the browser's home bar — the same bar
 * `WEB_HOME_BAR_INSET` keeps every other screen in the web build clear of.
 *
 * So each check below renders a screen the way a browser builds it, reads the
 * document it hands its iframe and runs the scripts in it, and reports the
 * room the document ends up reserving. The room has to come from the browser
 * rather than from a number someone typed, which is why the same screen is
 * measured in both browsers: a desktop one floats no bar over the page, and
 * room reserved there would be dead space at the foot of an editor.
 *
 * jest.config.js sends this file to the project built on `jest-expo/web`:
 * `.web` sources are preferred, `react-native` is aliased to
 * `react-native-web`, and `Platform.OS` is `web` throughout, which is what
 * sends these screens down their browser branch at all.
 */

/** The API origin this run's screens load their documents from. */
const API_DOMAIN = "api.example.test";

/**
 * A stand-in for the document the API server serves, cut down to the part
 * these checks are about: an assistant panel padded by the room the server
 * builds from `@workspace/hosted-document-inset`, one half of which is the
 * property a host sets. The server's own checks measure what it declares;
 * this file measures what its host tells it.
 */
const SERVED_DOCUMENT = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  `<style>#assistant-panel{padding-bottom:calc(14px + ${HOSTED_BOTTOM_INSET})}</style>`,
  "</head>",
  '<body><div id="assistant-panel"><button class="assistant-btn">Ask</button></div>',
  '<script src="/api/socket-client.js"></script>',
  "</body></html>",
].join("");

const mockGetToken = jest.fn();
const mockFetch = jest.fn();

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

// The browser build has no safe-area provider of its own to read, and what
// it would report is beside the point here: a browser reports nothing for
// the bar at the foot of its window, on a phone as much as on a desktop.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const RN = require("react-native");
  const mockReact = require("react");
  return {
    Feather: ({ name }: { name: string }) =>
      mockReact.createElement(RN.Text, null, name),
  };
});

type RenderResult = ReturnType<typeof render>;
type TestElement = ReturnType<RenderResult["UNSAFE_getByType"]>;

/** Walks everything a screen drew, element by element. */
function eachElement(
  node: TestElement,
  visit: (element: TestElement) => void,
): void {
  visit(node);

  for (const child of node.children) {
    if (typeof child !== "string") eachElement(child, visit);
  }
}

/** Every document a screen hands an iframe, as the browser receives it. */
function hostedDocuments(view: RenderResult): string[] {
  const documents: string[] = [];

  eachElement(view.UNSAFE_root, (element) => {
    if (element.type !== "iframe") return;
    const { srcDoc } = element.props as { srcDoc?: unknown };
    documents.push(typeof srcDoc === "string" ? srcDoc : "");
  });

  return documents;
}

/**
 * Every string a screen drew.
 *
 * The browser build draws its text in the elements react-native-web picks,
 * not in the ones a device build uses, and the library's text queries look
 * for the latter — so the strings are read off the tree itself.
 */
function drawnText(view: RenderResult): string[] {
  const strings: string[] = [];

  eachElement(view.UNSAFE_root, (element) => {
    for (const child of element.children) {
      if (typeof child === "string") strings.push(child);
    }
  });

  return strings;
}

/**
 * What a document is left holding for the host's inset, read off a stand-in
 * for the document its scripts run in — the one thing a document served by
 * another package and the screen hosting it agree on by name.
 *
 * The scripts are run rather than read, so a host that names the property
 * itself, or hands over a number it built by hand, is measured by what the
 * document ends up with rather than by the call it makes.
 */
function insetHandedOver(html: string): string {
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

  for (const [, script] of html.matchAll(
    /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    new Function("document", script ?? "")(documentDouble);
  }

  return handedOver.get(HOST_BOTTOM_INSET_PROPERTY) ?? "nothing";
}

/** What the assistant's buttons must stay clear of, named for a reader. */
const ASSISTANT_BUTTONS = "the assistant's ask, cancel, retry and clear buttons";

function clearanceMet(inset: number): string {
  return `the document reserves ${inset}px below ${ASSISTANT_BUTTONS}`;
}

/** What the one document a screen hosts was handed, in the same words. */
function clearanceReport(documents: string[]): string {
  const [document] = documents;

  if (documents.length !== 1 || document === undefined) {
    return (
      `the sandbox screen hands a browser ${documents.length} documents, so ` +
      `there is no one document keeping ${ASSISTANT_BUTTONS} off the home bar`
    );
  }

  return `the document reserves ${insetHandedOver(document)} below ${ASSISTANT_BUTTONS}`;
}

/** Renders `Screen` and waits for the browser branch to settle. */
async function renderInBrowser(
  Screen: () => React.JSX.Element,
  settled: (view: RenderResult) => boolean,
): Promise<RenderResult> {
  const view = render(<Screen />);
  await waitFor(() => expect(settled(view)).toBe(true));
  return view;
}

describe("a hosted document in a browser", () => {
  beforeEach(() => {
    process.env["EXPO_PUBLIC_DOMAIN"] = API_DOMAIN;
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    mockFetch.mockReset().mockResolvedValue({
      ok: true,
      text: async () => SERVED_DOCUMENT,
    });
    (globalThis as { fetch: unknown }).fetch = mockFetch;
  });

  afterEach(() => {
    restoreBrowserPointer();
  });

  it("is drawn by the browser build of these screens", () => {
    // Everything below turns on the browser branch of a screen, which only a
    // run that resolves the app for the web reaches.
    expect(Platform.OS).toBe("web");
  });

  it("is handed the home bar's room in a phone browser", async () => {
    browseWith(PHONE_BROWSER);

    const view = await renderInBrowser(
      SandboxScreen,
      (rendered) => hostedDocuments(rendered).length > 0,
    );

    expect(clearanceReport(hostedDocuments(view))).toBe(
      clearanceMet(WEB_HOME_BAR_INSET),
    );
  });

  it("is handed no room in a desktop browser, which floats no home bar", async () => {
    browseWith(DESKTOP_BROWSER);

    const view = await renderInBrowser(
      SandboxScreen,
      (rendered) => hostedDocuments(rendered).length > 0,
    );

    expect(clearanceReport(hostedDocuments(view))).toBe(clearanceMet(0));
  });

  it("is not drawn at all on the call screen, which a browser cannot join from", async () => {
    browseWith(PHONE_BROWSER);

    // A browser gets the fallback rather than the call document, so nothing
    // of that document's is down at the window's foot to keep clear. A
    // browser branch that started drawing it would have to hand it the room
    // the sandbox screen hands its own, and fails here until it does.
    const view = await renderInBrowser(CallScreen, (rendered) =>
      drawnText(rendered).includes("Video calls"),
    );

    expect(
      `the call screen hands a browser ${hostedDocuments(view).length} documents`,
    ).toBe("the call screen hands a browser 0 documents");
  });
});
