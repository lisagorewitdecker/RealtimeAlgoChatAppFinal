/**
 * The contract between a document one of this workspace's servers serves and
 * the app screen that hosts it in a WebView or an iframe.
 *
 * A hosted document owns its own bottom edge: padding added around the WebView
 * shrinks the hosted viewport rather than lifting the controls inside it, so
 * the document is the only side that can keep its last control clear of the
 * bar the system draws at the bottom of the window. It takes that room from
 * what the platform reports, so the same stylesheet reserves nothing in a
 * desktop browser and the real inset on a phone.
 *
 * The hosts report it in different ways, which is why this contract has two
 * halves:
 *
 * - An iOS WebView answers `env(safe-area-inset-bottom)` with the height of
 *   the home indicator, so the document can read the inset itself.
 * - An Android WebView generally answers nothing for the gesture navigation
 *   bar, and a browser tells a page inside an iframe nothing about the
 *   window's insets at all, however the phone drawing it is held. The same
 *   CSS then reserves zero and the controls sit inside the bar the system
 *   floats over them. The host screen is the side that knows the number, and
 *   hands it over by setting {@link HOST_BOTTOM_INSET_PROPERTY} on the
 *   document's root element.
 *
 * Both sides name the property from here so the document reads the property
 * its host writes: the served CSS is built from {@link HOSTED_BOTTOM_INSET},
 * and a host hands its measurement over with
 * {@link hostBottomInsetScript}.
 */

/**
 * The CSS custom property a host sets to the bottom inset it measured.
 *
 * It is set on the document's root element, so every rule in the document can
 * read it, and it is absent — rather than zero — until a host sets it, which
 * is what lets the CSS fall back to what the document itself can see.
 */
export const HOST_BOTTOM_INSET_PROPERTY = "--host-bottom-inset";

/**
 * The bottom room a hosted document reserves below its last control.
 *
 * The larger of the two reports wins, so neither platform depends on the
 * other's: an iOS WebView keeps the home indicator's inset even if nothing
 * ever sets the property, and an Android one gets the host's measurement
 * where `env()` reports zero. Both resolve to zero in a desktop browser, where
 * no bar floats over the page and reserving room would only be dead space.
 */
export const HOSTED_BOTTOM_INSET = `max(env(safe-area-inset-bottom,0px),var(${HOST_BOTTOM_INSET_PROPERTY},0px))`;

/**
 * A script that hands a hosted document the bottom inset its host measured.
 *
 * Run inside the document — a WebView's `injectedJavaScript`, or an injection
 * made later when the inset changes — it sets
 * {@link HOST_BOTTOM_INSET_PROPERTY} to `inset`, which is what every rule
 * built from {@link HOSTED_BOTTOM_INSET} then reserves.
 *
 * @param inset Bottom inset the host measured, in density-independent pixels,
 *   which a document scaled to the device's width reads as CSS pixels.
 * @returns The script, ending in `true;` so a WebView injecting it has a
 *   value to hand back rather than warning about the one it did not get.
 */
export function hostBottomInsetScript(inset: number): string {
  // A host that reported nothing usable reserves nothing, rather than writing
  // `NaNpx` into the document and taking the fallback down with it.
  const pixels =
    Number.isFinite(inset) && inset > 0 ? Math.round(inset * 100) / 100 : 0;

  return (
    "(function(){" +
    "var root=typeof document==='undefined'?null:document.documentElement;" +
    `if(root)root.style.setProperty('${HOST_BOTTOM_INSET_PROPERTY}','${pixels}px');` +
    "})();true;"
  );
}
