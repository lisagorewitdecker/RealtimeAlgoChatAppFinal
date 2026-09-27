/**
 * The bar a browser floats over the foot of its window, and how a page asks
 * whether it is under one at all.
 *
 * Every surface in the web build that ends at the bottom edge of the window
 * has to keep its last control clear of that bar: the app's own screens do it
 * through hooks/useBottomClearance.ts, and the documents the call and sandbox
 * screens host do it through hooks/useHostedDocumentInset.ts. Both ask the
 * question from here, so one window cannot reserve the room on one screen and
 * leave it out on the next.
 */

/**
 * Bottom room the home bar needs in the web build, where the browser reports
 * no bottom safe-area inset of its own.
 *
 * A page is not told what the window's insets are — inside an iframe it is
 * not told them at all, however the phone drawing it is held — so the room
 * for the bar is this fixed number rather than something the platform
 * reports: the height of an iPhone's home indicator, held upright.
 */
export const WEB_HOME_BAR_INSET = 34;

/**
 * The media query a browser answers `true` to when it is drawing the app on a
 * handheld screen, under the bar the system floats over the foot of the
 * window.
 *
 * No browser reports that bar as a safe-area inset, so the room for it has to
 * be decided from something the browser does answer. The pointer driving the
 * page is that answer: a phone or a tablet has no hover and a coarse pointer,
 * a desktop browser has a fine one, and a laptop with a touchscreen still
 * reports the mouse it is driven by. Both features are asked, so a
 * stylus-first device — coarse, but able to hover — is not read as a phone.
 */
export const HOME_BAR_BROWSER_QUERY = "(hover: none) and (pointer: coarse)";

/** Whether the browser drawing this app floats a home bar over the page. */
function browserDrawsHomeBar(): boolean {
  // A render with no browser around it — a static export, a test environment
  // — reports no home bar rather than guessing a phone, which is the same
  // answer a desktop browser gives.
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }

  return window.matchMedia(HOME_BAR_BROWSER_QUERY).matches;
}

/**
 * The bottom room the browser drawing this app keeps for its home bar:
 * {@link WEB_HOME_BAR_INSET} where the system floats one over the page, and
 * nothing at all where it does not.
 *
 * A desktop browser floats no such bar. Room reserved for one there is not
 * clearance for anything: it is a strip of empty space under the last control
 * of every screen, and a window's worth of it lost from a screen that ends in
 * a list or an editor.
 *
 * The browser is asked as each surface reserves its room, rather than once,
 * so a window whose pointer changes — a tablet picking up a mouse — reserves
 * the room its next render asks for.
 *
 * @returns The room in density-independent pixels, which the web build lays
 *   out as CSS pixels.
 */
export function webHomeBarInset(): number {
  return browserDrawsHomeBar() ? WEB_HOME_BAR_INSET : 0;
}
