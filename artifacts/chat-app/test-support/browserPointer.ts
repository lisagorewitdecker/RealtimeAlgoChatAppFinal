/**
 * The kind of browser a web run's renders are drawn by, as the app can ask
 * about it.
 *
 * `lib/webHomeBar.ts` decides whether to reserve room for the bar the system
 * floats over the foot of a window by asking the browser about the pointer
 * driving the page: no browser reports that bar as a safe-area inset, and the
 * pointer is the one thing that separates a phone, which has one, from a
 * desktop window, which does not. Checks about that room therefore have to
 * answer that question as a browser would, and answer it the same way
 * wherever they ask — one stand-in, so a suite cannot pass by describing a
 * browser no reader has.
 *
 * jsdom implements no `matchMedia` at all, so jest.setup.web.js leaves a
 * stand-in that reports every query unmatched. That is a desktop browser's
 * answer, and the one every web suite starts each test from;
 * {@link restoreBrowserPointer} puts it back.
 */

/** What a browser answers about the pointer its reader is driving it with. */
export type BrowserFeatures = Record<string, string>;

/** A phone or a tablet: nothing to hover with, and a fingertip to point. */
export const PHONE_BROWSER: BrowserFeatures = {
  hover: "none",
  pointer: "coarse",
  "any-hover": "none",
  "any-pointer": "coarse",
};

/** A desktop browser, which floats no bar over the foot of its window. */
export const DESKTOP_BROWSER: BrowserFeatures = {
  hover: "hover",
  pointer: "fine",
  "any-hover": "hover",
  "any-pointer": "fine",
};

/** The stand-in jest.setup.web.js leaves behind, kept to be restored. */
const setupMatchMedia = window.matchMedia;

/**
 * Answers this page's media queries the way `features` would.
 *
 * The queries are read rather than matched as text, so a surface asking about
 * the pointer in any of the ways a browser understands gets the answer that
 * browser would give. A feature this stand-in knows nothing about comes back
 * unmatched, which is what a browser answers for a condition it cannot meet.
 */
export function browseWith(features: BrowserFeatures): void {
  window.matchMedia = ((query: string) => ({
    matches: query.split(" and ").every((term) => {
      const [feature, value] = term.replace(/[()]/g, "").split(":");
      return features[feature?.trim() ?? ""] === value?.trim();
    }),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Hands the page back the browser the run's setup left it with. */
export function restoreBrowserPointer(): void {
  window.matchMedia = setupMatchMedia;
}
