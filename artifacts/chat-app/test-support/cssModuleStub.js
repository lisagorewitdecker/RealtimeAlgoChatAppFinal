/**
 * Stands in for a stylesheet import in the web jest project.
 *
 * The browser bundle is built by Metro, which understands `import styles from
 * "./x.module.css"` and hands the importer an object of generated class names.
 * Jest has no such transform, so `expo-router/unstable-native-tabs` — which
 * the tab layout imports on every platform — fails to parse the stylesheet it
 * pulls in on web, long before the module contract can look at an export.
 *
 * Returning the requested name is what a CSS-module import resolves to in the
 * real bundle, so a component that reaches for one gets a string rather than
 * `undefined`. Nothing in these contract suites renders; this exists only so
 * the modules under inspection load the way they do in the browser.
 */
module.exports = new Proxy(
  {},
  {
    get: (target, property) =>
      typeof property === "string" && property !== "__esModule"
        ? property
        : Reflect.get(target, property),
  },
);
