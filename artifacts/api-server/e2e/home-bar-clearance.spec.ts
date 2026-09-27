import { expect, test, type Page } from "@playwright/test";
import {
  browserTestWaiver,
  HOME_BAR_SUITE,
} from "@workspace/browser-test-requirements";
import {
  buildCallHtml,
  buildSandboxHtmlWithAssistant,
} from "../src/routes/roomDocuments";

/**
 * The call and sandbox documents, rendered in a phone-sized window with the
 * bars a phone floats over them emulated: the home bar under the page while
 * it is held upright, the cutout and the home indicator beside it once it is
 * turned sideways.
 *
 * The chat app draws these two documents in a WebView on a device and an
 * iframe in the browser, and keeps nothing at their edges on their behalf, so
 * each reserves those bars' room itself. Its sibling
 * src/routes/rooms.bottomClearance.test.ts reads the bottom half of that out
 * of the stylesheet they serve: it is fast, it runs everywhere, and it can
 * only see what the documents declare. A later rule, a fixed panel over the
 * controls, or a parent that clips could take back the room a declaration
 * still promises, and the only way to tell is to draw the page and measure
 * it.
 *
 * So this suite draws it. Chromium can be told what a device reports for
 * `env(safe-area-inset-*)`, which is the one thing a desktop browser never
 * has, and from there the question is arithmetic: how far from the edge of
 * the window does the nearest control actually end.
 *
 * Both halves are checked, because each fails differently. With a bar
 * emulated, a control ending inside it is one the bar sits on top of. With
 * none reported -- a desktop browser, a phone with buttons, a phone held the
 * other way up -- a document that keeps the same room anyway is reserving a
 * number rather than the device's inset, which is dead space everywhere it is
 * wrong.
 *
 * Where a control ends is still not the whole question. A fixed element drawn
 * over one -- the assistant's panel on a phone, a banner, a toast -- covers it
 * without moving it, so every measurement here reads exactly as it did while
 * the end-call button underneath cannot be tapped. So each control is asked
 * for a second way, by hit test: what the browser finds at its centre has to
 * be that control or something it draws. The two questions are asked in
 * separate cases because they fail separately, and neither answers the other.
 *
 * Sideways is a separate axis rather than the same check rotated. A phone on
 * its side reports nothing under the page and an inset at either edge, the
 * notch or camera cutout taking whichever edge it landed on and the home
 * indicator the other, and a document that reserved only the bottom would put
 * its end-call button under the cutout with nothing to say so. It is measured
 * in two landscape windows because the sandbox lays itself out differently
 * either side of its own width break, and its assistant reaches a different
 * edge in each.
 */

// A run needing something it has not got was stopped by the config's
// globalSetup before this file loaded -- though this suite needs nothing:
// it builds both documents in this process and answers the page's requests
// for them itself. The one way past that setup is the deliberate waiver, an
// environment with no browser to render in, declared here at file scope so
// every case below is marked skipped as it is collected.
const waiver = browserTestWaiver(HOME_BAR_SUITE);
test.skip(waiver.waived, waiver.reason);

/** The room a home bar takes, in CSS pixels: an iPhone's, held upright. */
const HOME_BAR = 34;

/** What a desktop browser reports, and a phone whose navigation is buttons. */
const NO_BAR = 0;

/**
 * How far two measurements may differ and still be the same number. A
 * browser lays out in fractions of a pixel, and a check that read one of
 * those as a regression would fail for a rounding difference nobody can see.
 */
const TOLERANCE = 1;

/**
 * Where this run serves the documents from. Nothing resolves this name:
 * every request to it is answered from this process, so the run needs no
 * server, no room and no signed-in account, and what it measures is the
 * document the route builds rather than one a live room happened to leave
 * behind.
 */
const ORIGIN = "https://room-documents.invalid";

/** The socket client both documents load from this server. */
const SOCKET_CLIENT_PATH = "/api/socket-client.js";

/**
 * Enough of that client for each document's own script to run past its first
 * statement, which opens a connection. A page whose script stopped there is
 * one the server never serves, and measuring it would prove nothing about
 * the one it does. Nothing here answers back: no measurement below waits on
 * a room.
 */
const SOCKET_CLIENT_STUB = "window.io = () => ({ on() {}, emit() {} });";

/** An edge of the window, as a measurement reads the room beside it. */
type WindowEdge = "bottom" | "left" | "right";

/** The two edges a phone held sideways reports a bar at. */
type SideEdge = Extract<WindowEdge, "left" | "right">;

/** A bar the device floats over one side edge of the window. */
interface SideBar {
  /** The edge it runs along. */
  readonly edge: SideEdge;
  /** The room it takes there, in CSS pixels. */
  readonly inset: number;
  /** What the device puts there, as the failure message names it. */
  readonly bar: string;
}

/**
 * The bars a phone held sideways reports, and the room each takes.
 *
 * The two numbers differ deliberately. A phone on its side reports one edge
 * to the camera cutout and the other to the home indicator, and they are
 * rarely the same width -- so a document that reserved a single number at
 * both edges, or read one edge's inset at the other, is a document one of
 * these two measurements catches.
 */
const CUTOUT: SideBar = { edge: "left", inset: 59, bar: "the camera cutout" };
const SIDE_HOME_BAR: SideBar = {
  edge: "right",
  inset: 34,
  bar: "the home bar",
};
const SIDE_BARS: readonly SideBar[] = [CUTOUT, SIDE_HOME_BAR];

/** Controls whose distance from an edge of the window is measured. */
interface Surface {
  /** What they are, as the failure message names them. */
  readonly description: string;
  /** What draws them. */
  readonly selector: string;
}

/** A document this server serves, and the controls measured in it. */
interface ServedDocument {
  /** The path the route serves it at, which this run answers in its place. */
  readonly path: string;
  /** The document, as that route builds it. */
  readonly html: string;
  /** The controls that end nearest its foot. */
  readonly bottomSurfaces: readonly Surface[];
  /**
   * The controls measured beside both side edges.
   *
   * These are measured as one group rather than one at a time: what a bar at
   * the edge of the window covers is whatever comes nearest it, so the
   * measurement is the smallest room any of them keeps, and the control that
   * kept it is the one the failure names. Full-bleed surfaces are left out on
   * purpose -- the call's video is meant to run under the cutout, and only
   * the controls drawn over it have to stay clear of one.
   */
  readonly sideSurfaces: readonly Surface[];
}

const documents: Record<string, ServedDocument> = {
  "the call document": {
    path: "/api/rooms/call?roomId=room-42",
    html: buildCallHtml({
      roomId: "room-42",
      userId: "user-ada",
      username: "Ada",
      capability: "test-capability",
    }),
    bottomSurfaces: [
      {
        description: "the mute, camera and end-call buttons",
        selector: "#controls .btn",
      },
    ],
    sideSurfaces: [
      {
        description: "the mute, camera and end-call buttons",
        selector: "#controls .btn",
      },
      // The two things drawn over the video at its corners: held sideways,
      // these are what the edge bars reach first.
      { description: "the self-view", selector: "#localVideo" },
      { description: "the participant's name tag", selector: "#nameTag" },
    ],
  },
  "the sandbox document": {
    path: "/api/rooms/sandbox?roomId=room-42",
    html: buildSandboxHtmlWithAssistant({
      roomId: "room-42",
      username: "Ada",
      capability: "test-capability",
    }),
    bottomSurfaces: [
      // The assistant's panel is fixed to the foot of the window on a phone,
      // so it is the panel that reaches the home bar and its buttons that
      // have to stay out of it.
      {
        description: "the assistant's ask, cancel, retry and clear buttons",
        selector: "#assistant-actions .assistant-btn",
      },
      // What that panel is laid over: the editors and the preview end above
      // it, and the room the home bar needs is below them both.
      {
        description: "the editors and the preview under them",
        selector: "#main",
      },
    ],
    sideSurfaces: [
      // The tab strip starts at the document's left edge in either layout.
      {
        description: "the HTML, CSS, JS and preview tabs",
        selector: "#tabs .tab",
      },
      // The editor open first, which fills the document's width: on the
      // narrow layout, where the assistant is a panel across the foot of the
      // window rather than a column down its right edge, it is what reaches
      // the right edge.
      {
        description: "the editor the document opens on",
        selector: "#htmlEditor",
      },
      // The assistant's panel is fixed, so the document's own padding never
      // reaches it: the box the question is typed into spans the panel's
      // width, which puts it against whichever edge that panel is drawn to.
      {
        description: "the assistant's question box",
        selector: "#assistant-input",
      },
      {
        description: "the assistant's ask, cancel, retry and clear buttons",
        selector: "#assistant-actions .assistant-btn",
      },
    ],
  },
};

test.describe("a phone held upright", () => {
  // The window these documents are measured in: a phone held upright, which
  // is also the width the sandbox's narrow layout is written for.
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [name, served] of Object.entries(documents)) {
    test(`${name} keeps the home bar's room below its controls`, async ({
      page,
    }) => {
      const reportInsets = await emulateDeviceInsets(page);

      await reportInsets({ bottom: NO_BAR });
      await serveDocument(page, served);
      const selectors = served.bottomSurfaces.map((surface) => surface.selector);
      const withoutHomeBar = await roomBeyond(page, selectors, "bottom");

      // The same rendered document, told a home bar appeared under it: the
      // difference between the two measurements is what it reserved for one,
      // rather than what it happens to leave there anyway.
      await reportInsets({ bottom: HOME_BAR });
      const withHomeBar = await roomBeyond(page, selectors, "bottom");

      for (const [index, surface] of served.bottomSurfaces.entries()) {
        expect(
          clearanceReport(surface, {
            withHomeBar: withHomeBar[index] ?? null,
            withoutHomeBar: withoutHomeBar[index] ?? null,
          }),
        ).toBe(clearanceMet(surface));
      }
    });

    test(`${name} keeps nothing drawn over its controls`, async ({ page }) => {
      const reportInsets = await emulateDeviceInsets(page);
      await serveDocument(page, served);

      // Asked in the phone's state rather than the browser's. The panel the
      // sandbox fixes to the foot of a narrow window is at its tallest with a
      // home bar reported under it, which is when it has the most of the
      // window -- and of what is drawn there -- to cover.
      await reportInsets({ bottom: HOME_BAR });
      const found = await topmostAtCentres(
        page,
        served.bottomSurfaces.map((surface) => surface.selector),
      );

      for (const [index, surface] of served.bottomSurfaces.entries()) {
        expect(coverageReport(surface, found[index] ?? [])).toBe(
          nothingOverThem(surface),
        );
      }
    });
  }
});

/**
 * The windows a phone on its side gives these documents.
 *
 * Both are measured because the sandbox breaks its layout at 760px: above
 * that its assistant is a column down the right edge, below it a panel across
 * the foot of the window, and the edge its buttons are drawn against differs
 * between the two. The call document has no such break and is measured in
 * both for the same reason a rotation is measured at all -- nothing says a
 * window's width leaves its controls where the last one did.
 */
const LANDSCAPE_WINDOWS = [
  {
    description: "wide enough for the assistant's column",
    viewport: { width: 844, height: 390 },
  },
  {
    description: "narrow enough for the assistant's panel",
    viewport: { width: 736, height: 414 },
  },
] as const;

test.describe("a phone turned sideways", () => {
  for (const window of LANDSCAPE_WINDOWS) {
    test.describe(window.description, () => {
      test.use({ viewport: window.viewport });

      for (const [name, served] of Object.entries(documents)) {
        test(`${name} keeps the side bars' room beside its controls`, async ({
          page,
        }) => {
          const reportInsets = await emulateDeviceInsets(page);

          await reportInsets(reportedBy([]));
          await serveDocument(page, served);
          const selectors = served.sideSurfaces.map(
            (surface) => surface.selector,
          );
          const withoutBars = await roomBeside(page, selectors);

          // The same rendered document, told the phone reports a bar at
          // either edge: what the controls give up between the two
          // measurements is the room the document reserved for them, rather
          // than room it happens to leave there anyway.
          await reportInsets(reportedBy(SIDE_BARS));
          const withBars = await roomBeside(page, selectors);

          for (const bar of SIDE_BARS) {
            expect(
              sideClearanceReport(served.sideSurfaces, bar, {
                withBar: withBars[bar.edge],
                withoutBar: withoutBars[bar.edge],
              }),
            ).toBe(sideClearanceMet(bar));
          }
        });
      }
    });
  }
});

/** What a device reports at the edges of its window, in CSS pixels. */
interface ReportedInsets {
  readonly bottom?: number;
  readonly left?: number;
  readonly right?: number;
}

/** What a device carrying `bars`, and nothing at its other edges, reports. */
function reportedBy(bars: readonly SideBar[]): ReportedInsets {
  const insets: { left?: number; right?: number } = {
    left: NO_BAR,
    right: NO_BAR,
  };

  for (const bar of bars) insets[bar.edge] = bar.inset;
  return insets;
}

/**
 * Makes this page report `insets` for `env(safe-area-inset-*)`, the way the
 * device does to the WebView these documents are drawn in.
 *
 * Chromium applies the override to the page as it stands, so a document is
 * measured at both insets without being loaded twice: what the two
 * measurements are compared across is one rendered document, not two loads
 * that could have differed for some other reason. The override belongs to
 * this page alone, and the run's config gives it a Chromium to ask.
 */
async function emulateDeviceInsets(
  page: Page,
): Promise<(insets: ReportedInsets) => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  return async (insets: ReportedInsets) => {
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
  };
}

/** Loads one document into `page`, answering its requests from this process. */
async function serveDocument(
  page: Page,
  served: ServedDocument,
): Promise<void> {
  const documentPath = new URL(served.path, ORIGIN).pathname;
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === documentPath) {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: served.html,
      });
      return;
    }
    if (pathname === SOCKET_CLIENT_PATH) {
      await route.fulfill({
        contentType: "application/javascript",
        body: SOCKET_CLIENT_STUB,
      });
      return;
    }
    // An icon, or anything a document starts asking for later: answered so
    // the page is not left waiting on it, and no part of what is measured.
    await route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}${served.path}`);
}

/**
 * The room each selector's controls keep beside `edge`: the smallest gap
 * between the nearest edge of anything one draws and that edge of the window,
 * in the order the selectors were given.
 *
 * A selector that draws nothing comes back `null` rather than as room
 * without end. Controls that are gone keep no room for a bar, and
 * reading their absence as clearance is how this check would pass a document
 * that had stopped rendering them.
 */
async function roomBeyond(
  page: Page,
  selectors: readonly string[],
  edge: WindowEdge,
): Promise<(number | null)[]> {
  return page.evaluate(
    ({ list, side }) =>
      list.map((selector) => {
        const drawn = Array.from(document.querySelectorAll(selector))
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        if (drawn.length === 0) return null;

        return Math.min(
          ...drawn.map((rect) => {
            if (side === "bottom") return window.innerHeight - rect.bottom;
            if (side === "left") return rect.left;
            return window.innerWidth - rect.right;
          }),
        );
      }),
    { list: [...selectors], side: edge },
  );
}

/** The room those controls keep beside each side edge of the window. */
async function roomBeside(
  page: Page,
  selectors: readonly string[],
): Promise<Record<SideEdge, (number | null)[]>> {
  return {
    left: await roomBeyond(page, selectors, "left"),
    right: await roomBeyond(page, selectors, "right"),
  };
}

/** What the browser finds at the centre of one drawn control. */
interface Topmost {
  /** Whether it found that control, or something the control itself draws. */
  readonly isControl: boolean;
  /**
   * What it found, named the way a reader would point at it in the document,
   * and `null` where the point it asked about holds nothing at all.
   */
  readonly found: string | null;
}

/**
 * What the browser finds at the centre of each selector's controls: one
 * reading per control it draws, in the order the selectors were given.
 *
 * `document.elementFromPoint` answers the question a measurement cannot --
 * what a finger put there would reach -- and it answers it about the page as
 * drawn, so anything laid over a control shows up as the thing found in its
 * place. A selector that draws nothing comes back with no readings rather
 * than with nothing to report, for the same reason its clearance comes back
 * `null`: controls that are gone cannot be tapped either.
 */
async function topmostAtCentres(
  page: Page,
  selectors: readonly string[],
): Promise<Topmost[][]> {
  return page.evaluate((list) => {
    const name = (element: Element): string => {
      const id = element.id ? `#${element.id}` : "";
      const classes = Array.from(element.classList)
        .map((value) => `.${value}`)
        .join("");
      return `${element.tagName.toLowerCase()}${id}${classes}`;
    };
    // What a covering element is part of. The browser answers with the
    // deepest thing at the point, which in an overlay is whatever it happens
    // to hold there -- a line of text, an empty box -- and naming that alone
    // leaves the reader to work out what it belongs to. The layer it is
    // positioned in is the thing that was drawn over the control.
    const layerOf = (element: Element): Element | null => {
      const layers = ["fixed", "absolute", "sticky"];
      let node: Element | null = element;
      while (node !== null) {
        if (layers.includes(window.getComputedStyle(node).position)) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    };
    return list.map((selector) =>
      Array.from(document.querySelectorAll(selector))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .map(({ element, rect }) => {
          const found = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          if (found === null) {
            return { isControl: false, found: null };
          }
          if (element.contains(found)) {
            return { isControl: true, found: name(found) };
          }
          const layer = layerOf(found);
          return {
            isControl: false,
            found:
              layer === null || layer === found
                ? name(found)
                : `${name(found)} inside ${name(layer)}`,
          };
        }),
    );
  }, [...selectors]);
}

/** What controls with nothing drawn over them read as. */
function nothingOverThem(surface: Surface): string {
  return `${surface.description} are what the browser finds at their own centres, with nothing drawn over them`;
}

/** What the browser did find at `surface`, in the same words where it is it. */
function coverageReport(surface: Surface, found: readonly Topmost[]): string {
  if (found.length === 0) {
    return `${surface.description} are not drawn at all (${surface.selector} matches nothing visible), so there is nothing there to tap`;
  }

  const index = found.findIndex((reading) => !reading.isControl);
  const covered = found[index];
  if (covered === undefined) {
    return nothingOverThem(surface);
  }

  // Which of them, where a selector draws several: without the position, a
  // failure names four buttons and leaves the reader to find the one.
  const which =
    found.length === 1 ? "them" : `number ${index + 1} of the ${found.length}`;
  if (covered.found === null) {
    return `${surface.description} have nothing at the centre of ${which}, which is a point outside the window where no tap can land`;
  }
  return `${surface.description} have ${covered.found} drawn over ${which}: the browser finds it at that control's centre, so a tap there never reaches the control`;
}

/** What a surface measured at both insets is measured against. */
interface MeasuredRoom {
  /** The room below it while the device reports a home bar. */
  readonly withHomeBar: number | null;
  /** The room below it while the device reports none. */
  readonly withoutHomeBar: number | null;
}

/** What a surface keeping the home bar's room, and only that, reads as. */
function clearanceMet(surface: Surface): string {
  return `${surface.description} keep the home bar's ${HOME_BAR}px below them, and none of it where the device reports no inset`;
}

/** What `surface` did keep, in the same words where it did keep it. */
function clearanceReport(surface: Surface, room: MeasuredRoom): string {
  const { withHomeBar, withoutHomeBar } = room;
  if (withHomeBar === null || withoutHomeBar === null) {
    return `${surface.description} are not drawn at all (${surface.selector} matches nothing visible), so nothing there keeps room for a home bar`;
  }
  if (withHomeBar < HOME_BAR - TOLERANCE) {
    return `${surface.description} end ${round(withHomeBar)}px above the window bottom, inside the ${HOME_BAR}px the home bar covers`;
  }

  const reserved = withHomeBar - withoutHomeBar;
  if (reserved < HOME_BAR - TOLERANCE) {
    return `${surface.description} rise by ${round(reserved)}px when the device reports a ${HOME_BAR}px home bar, so ${round(HOME_BAR - reserved)}px of the ${round(withHomeBar)}px below them is a fixed number: dead space in a browser, and the wrong room on the next device`;
  }
  if (reserved > HOME_BAR + TOLERANCE) {
    return `${surface.description} rise by ${round(reserved)}px when the device reports a ${HOME_BAR}px home bar, taking ${round(reserved - HOME_BAR)}px more of the phone's window than the bar covers`;
  }
  return clearanceMet(surface);
}

/** The controls measured beside one edge, at both of the insets reported. */
interface MeasuredSideRoom {
  /** What each keeps there while the device reports the bar. */
  readonly withBar: readonly (number | null)[];
  /** What each keeps there while the device reports no inset. */
  readonly withoutBar: readonly (number | null)[];
}

/** A control, and the room it kept beside the edge being measured. */
interface Measured {
  readonly surface: Surface;
  readonly room: number;
}

/** What controls keeping a side bar's room, and only that, read as. */
function sideClearanceMet(bar: SideBar): string {
  return `nothing is drawn inside the ${bar.inset}px ${bar.bar} covers at the window's ${bar.edge} edge, and none of that room is kept where the device reports no inset`;
}

/**
 * What the controls did keep beside `bar`, in the same words where they did
 * keep it.
 *
 * The control that comes nearest the edge is the one that answers for all of
 * them: it is what the bar covers first, and -- since the room beside it is
 * the document's own padding rather than the space a centred row happens to
 * leave -- it is also the one whose movement says whether that room came from
 * the device or from a number somebody typed.
 */
function sideClearanceReport(
  surfaces: readonly Surface[],
  bar: SideBar,
  room: MeasuredSideRoom,
): string {
  let withBar: Measured | null = null;
  let withoutBar: Measured | null = null;

  for (const [index, surface] of surfaces.entries()) {
    const reported = room.withBar[index] ?? null;
    const unreported = room.withoutBar[index] ?? null;

    if (reported === null || unreported === null) {
      return `${surface.description} are not drawn at all (${surface.selector} matches nothing visible), so nothing there keeps room beside ${bar.bar}`;
    }
    if (withBar === null || reported < withBar.room) {
      withBar = { surface, room: reported };
    }
    if (withoutBar === null || unreported < withoutBar.room) {
      withoutBar = { surface, room: unreported };
    }
  }

  if (withBar === null || withoutBar === null) {
    return `no control is measured beside ${bar.bar} at all, so nothing there could fail`;
  }
  if (withBar.room < bar.inset - TOLERANCE) {
    return `there is ${round(withBar.room)}px between the window's ${bar.edge} edge and ${withBar.surface.description}, inside the ${bar.inset}px ${bar.bar} covers`;
  }

  const reserved = withBar.room - withoutBar.room;
  if (reserved < bar.inset - TOLERANCE) {
    return `the controls give up ${round(reserved)}px at the window's ${bar.edge} edge when the device reports a ${bar.inset}px inset there, so ${round(bar.inset - reserved)}px of the ${round(withBar.room)}px beside ${withBar.surface.description} is a fixed number: dead space in a browser, and the wrong room on the next device`;
  }
  if (reserved > bar.inset + TOLERANCE) {
    return `the controls give up ${round(reserved)}px at the window's ${bar.edge} edge when the device reports a ${bar.inset}px inset there, taking ${round(reserved - bar.inset)}px more of the phone's window than ${bar.bar} covers`;
  }
  return sideClearanceMet(bar);
}

/** A measurement as a reader would say it, rather than to the femtometre. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
