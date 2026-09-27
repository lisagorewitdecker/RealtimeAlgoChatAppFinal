/**
 * Fills the gaps between jsdom and a real browser for the web jest project.
 *
 * jest-expo's web preset runs in jsdom, which implements most of the DOM but
 * not `window.matchMedia`. Expo's web builds do use it: expo-haptics reads
 * `(pointer: coarse)` at import to decide whether the device has a
 * touchscreen, so the module contract cannot even load the package without it.
 * A browser always answers this call, so the absence is jsdom's, not the app's
 * — stubbing it keeps the run measuring the packages rather than the test
 * environment.
 *
 * The stub reports every query as unmatched, which is what a desktop browser
 * with no touchscreen reports for the queries these packages ask about.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
