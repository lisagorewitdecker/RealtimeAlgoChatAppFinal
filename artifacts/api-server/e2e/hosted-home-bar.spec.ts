import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import {
  browserTestWaiver,
  HOSTED_HOME_BAR_SUITE,
} from "@workspace/browser-test-requirements";

/**
 * The sandbox's assistant buttons, measured where a reader meets them: the
 * app's own sandbox screen, open in a signed-in browser, with the served
 * document drawn in the iframe that screen puts it in.
 *
 * Two checks already meet in the middle here and neither draws the page.
 * `src/routes/rooms.bottomClearance.test.ts` reads the served stylesheet and
 * proves the room below those buttons is `max(env(safe-area-inset-bottom),
 * var(--host-bottom-inset))`. The chat app's own
 * `__tests__/HostedDocumentInset.test.web.tsx` proves the host hands that
 * property a home bar's room on a handheld browser and nothing on a desktop
 * one. Between them the room is proven declared and proven handed over, and
 * the pixels between the last button and the bottom of the window are
 * measured nowhere.
 *
 * `home-bar-clearance.spec.ts` beside this one does draw the document, but at
 * an inset it emulates itself, which is the half a browser can never deliver:
 * a page inside an iframe is told nothing about the window's safe areas
 * however the phone underneath is held, so `env(safe-area-inset-bottom)`
 * resolves to zero there and every pixel of room those buttons keep in a
 * browser comes from the property the host sets. Nothing measures the result
 * of that handover, and it crosses three things at once -- the host reading
 * the browser, the screen writing the script into the document it hands the
 * iframe, and the document's own stylesheet -- so each of them can be right
 * on its own while the buttons still end up under the home bar.
 *
 * So this run signs in, opens the sandbox, and measures. Nothing about the
 * inset is emulated: the one thing that differs between the two readings
 * below is whether the browser reports a touch screen, which is what the host
 * reads to decide a phone is drawing the page.
 *
 * Both readings are needed, because each fails differently. On the phone
 * browser, buttons ending inside the bottom of the window are buttons the
 * home bar sits over. On the desktop one -- no bar over the page, nothing to
 * keep clear of -- the same page keeping the same room is a host reserving a
 * number everywhere rather than one it measured, which is dead space in every
 * browser that has no bar. So what is asserted is the room on the phone and
 * the difference between the two, and the difference is the part that says
 * where the room came from.
 */

// A run missing any of these settings has already been stopped by the
// config's globalSetup, before this file was loaded. The one way past it is
// the deliberate waiver, declared here at file scope so the case below is
// marked skipped as it is collected -- before a browser is launched or the
// provider is asked for anything -- and the run's own list still names the
// check it left out.
const waiver = browserTestWaiver(HOSTED_HOME_BAR_SUITE);
test.skip(waiver.waived, waiver.reason);

const chatUrl = process.env["E2E_CHAT_URL"]!;
const publishableKey = process.env["CLERK_PUBLISHABLE_KEY"]!;
const secretKey = process.env["CLERK_SECRET_KEY"]!;
const administratorEmail = process.env["E2E_MODERATOR_EMAIL"]!;

/**
 * The room a home bar takes in a browser, in CSS pixels, and what the host
 * hands a hosted document when it decides a phone is drawing the page.
 *
 * Written here rather than imported from the app: this side is asking whether
 * the buttons clear a home bar, and a check that took its answer from the
 * number under test would pass a host that had quietly stopped reserving one.
 * A change to what the app hands over is meant to fail here and say so.
 */
const HOME_BAR = 34;

/**
 * How far two measurements may differ and still be the same number. A browser
 * lays out in fractions of a pixel, and a check that read one of those as a
 * regression would fail for a rounding difference nobody can see.
 */
const TOLERANCE = 1;

/** The window both readings are taken in: a phone held upright. */
const PHONE_WINDOW = { width: 390, height: 844 } as const;

/** What draws the buttons, inside the document the iframe holds. */
const ASSISTANT_BUTTONS = "#assistant-actions .assistant-btn";

/**
 * The room this run opens the sandbox for.
 *
 * The screen takes it from the address, and the server builds the document
 * for any well-formed name the signed-in account asks for, so no room has to
 * exist and none is created: the socket client that would join one is
 * answered below, and this run leaves nothing behind it.
 */
const ROOM_ID = "home-bar-clearance";

/**
 * Enough of the socket client for the document's own script to run past its
 * first statement, which opens a connection and joins the room.
 *
 * The real client is served, and left to itself it would join -- creating the
 * room named above on a server this case is only measuring a layout on. A
 * page whose script stopped at its first statement is not the page the app
 * draws either, so the client is answered rather than blocked. Nothing here
 * answers back: no measurement below waits on a room.
 */
const SOCKET_CLIENT_STUB = "window.io = () => ({ on() {}, emit() {} });";

/** The address of the app's sandbox screen for that room. */
function sandboxUrl(): string {
  return `${chatUrl.replace(/\/+$/, "")}/sandbox/${ROOM_ID}`;
}

type SessionStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * A signed-in browser session, established once and restored into each
 * reading's own context.
 *
 * The sign-in is a ticket the provider issues for a configured account, not
 * the password form: a development instance answers a synthetic browser's
 * password sign-in with a client-trust step this run has no inbox for, and
 * rate-limits a burst of attempts into what reads as a broken app. So the
 * provider is asked twice in the whole run, and the two readings differ in
 * nothing but the browser they are taken in.
 */
async function establishSession(browser: Browser): Promise<SessionStorageState> {
  const client = createClerkClient({ secretKey, publishableKey });
  const matches = await client.users.getUserList({
    emailAddress: [administratorEmail],
  });
  const identity = matches.data[0];
  if (!identity) {
    throw new Error(
      "The configured test account is not on this Clerk instance, so this run cannot sign in to open the sandbox",
    );
  }
  const ticket = await client.signInTokens.createSignInToken({
    userId: identity.id,
    expiresInSeconds: 120,
  });

  const context = await browser.newContext({ viewport: { ...PHONE_WINDOW } });
  try {
    await setupClerkTestingToken({ context });
    const page = await context.newPage();
    await page.goto(chatUrl);
    await clerk.signIn({
      page,
      signInParams: { strategy: "ticket", ticket: ticket.token },
    });
    // The room list is where the app lands a signed-in account, and waiting
    // for it is what proves the session is established rather than still
    // being written: a context copied too early restores as a signed-out one
    // and the sandbox screen below sends it back to the sign-in form.
    //
    // Given longer than the app needs and less than this case is allowed, so
    // that a sign-in going nowhere -- a provider rate-limiting a burst of
    // runs answers slowly rather than refusing -- is reported as the room
    // list never arriving, rather than as the whole case timing out
    // somewhere between two browsers and a measurement.
    await page
      .getByTestId("new-room-button")
      .waitFor({ state: "visible", timeout: 90_000 });
    return await context.storageState();
  } finally {
    // The readings get contexts of their own; this one only carried the
    // sign-in, and its browser is not one of the two being compared.
    await context.close();
  }
}

/**
 * The room the assistant's buttons keep below them, in a browser that does or
 * does not report a touch screen: the distance from the lowest point any of
 * them is drawn to the foot of the document holding them, or to the foot of
 * the window where the iframe reaches past it, in CSS pixels.
 *
 * The nearer of the two is the reading, and neither alone would do. The room
 * a hosted document keeps is room inside itself, so anything the host draws
 * below the iframe -- a footer, a strip of its own -- is not room these
 * buttons kept and must not be counted as it: the host's chrome moves for its
 * own reasons, and a measurement crediting it would read those changes as
 * this document reserving more or less than it does. But a bar floats over
 * the window rather than over the iframe, so a frame reaching below the
 * window's foot has room in it that is already behind the bar, and counting
 * that would credit the document with clearance nobody can see.
 *
 * Buttons that are not drawn come back `null` rather than as room without
 * end. Controls that are gone keep no room for a bar, and reading their
 * absence as clearance is how this check would pass a screen that had stopped
 * drawing the document at all.
 */
async function roomBelowButtons(
  browser: Browser,
  storageState: SessionStorageState,
  onATouchScreen: boolean,
): Promise<number | null> {
  const context = await browser.newContext({
    storageState,
    viewport: { ...PHONE_WINDOW },
    hasTouch: onATouchScreen,
  });
  try {
    await setupClerkTestingToken({ context });
    const page = await context.newPage();
    await page.route("**/api/socket-client.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: SOCKET_CLIENT_STUB,
      }),
    );
    await page.goto(sandboxUrl());

    const frame = page.locator("iframe");
    const buttons = page.frameLocator("iframe").locator(ASSISTANT_BUTTONS);
    await buttons.first().waitFor({ state: "visible", timeout: 90_000 });

    // Playwright reports a box inside an iframe in the window's own
    // coordinates, so the document's own foot and the window's can be
    // compared against the buttons without converting between the two.
    const boxes = await Promise.all(
      Array.from({ length: await buttons.count() }, (_, index) =>
        buttons.nth(index).boundingBox(),
      ),
    );
    const frameBox = await frame.boundingBox();
    const windowFoot = page.viewportSize()?.height ?? PHONE_WINDOW.height;
    const foot =
      frameBox === null
        ? windowFoot
        : Math.min(frameBox.y + frameBox.height, windowFoot);
    const room = boxes.flatMap((box) =>
      box === null || box.height <= 0 ? [] : [foot - (box.y + box.height)],
    );
    return room.length === 0 ? null : Math.min(...room);
  } finally {
    await context.close();
  }
}

/** What buttons keeping the home bar's room, and only that, read as. */
function clearanceMet(): string {
  return `the assistant's buttons keep the home bar's ${HOME_BAR}px above the foot of the document in a phone browser, and none of it in a browser with no home bar`;
}

/** What they did keep, in the same words where they did keep it. */
function clearanceReport(
  onAPhone: number | null,
  onADesktop: number | null,
): string {
  if (onAPhone === null || onADesktop === null) {
    return `the assistant's buttons are not drawn at all (${ASSISTANT_BUTTONS} matches nothing visible in the sandbox screen's iframe), so nothing there keeps room for a home bar`;
  }
  if (onAPhone < HOME_BAR - TOLERANCE) {
    return `the assistant's buttons end ${round(onAPhone)}px above the foot of the document in a phone browser, inside the ${HOME_BAR}px the home bar covers`;
  }

  const reserved = onAPhone - onADesktop;
  if (reserved < HOME_BAR - TOLERANCE) {
    return `the assistant's buttons keep ${round(onAPhone)}px above the foot of the document in a phone browser and ${round(onADesktop)}px in a browser with no home bar, a difference of ${round(reserved)}px: ${round(HOME_BAR - reserved)}px of what they clear is room kept whatever the browser rather than room handed over for the bar, which is dead space everywhere there is no bar`;
  }
  if (reserved > HOME_BAR + TOLERANCE) {
    return `the assistant's buttons rise by ${round(reserved)}px between a browser with no home bar and a phone's, taking ${round(reserved - HOME_BAR)}px more of the window than the ${HOME_BAR}px bar covers`;
  }
  return clearanceMet();
}

/** A measurement as a reader would say it, rather than to the femtometre. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

test("the sandbox the app hosts keeps the home bar's room below the assistant's buttons", async ({
  browser,
}) => {
  const session = await establishSession(browser);

  // The same address, the same window, the same signed-in session: the one
  // difference is the touch screen, which is the whole of what the host reads
  // to decide whether a home bar is drawn over this page.
  const onAPhone = await roomBelowButtons(browser, session, true);
  const onADesktop = await roomBelowButtons(browser, session, false);

  expect(clearanceReport(onAPhone, onADesktop)).toBe(clearanceMet());
});
