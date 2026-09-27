import { describeScreenModuleContract } from "../test-support/screenModuleContract";

/**
 * Runs the screens' module contract against the packages a browser build of
 * the app resolves.
 *
 * The app ships a web build as well as the two native ones — the Replit
 * preview serves it and server/serve.js serves the built copy — and several of
 * these packages resolve something else there: react-native-webview falls back
 * to a placeholder WebView, react-native-keyboard-controller drops its
 * `.native` bindings, expo-secure-store loads an empty web module behind its
 * async calls, and react-native itself becomes react-native-web. Neither the
 * iOS run nor the Android one can see that, so an SDK upgrade that renamed or
 * dropped a web export would leave both of them green while the browser app
 * failed to load.
 *
 * jest.config.js sends this file to a third project built on `jest-expo/web`:
 * module resolution prefers `.web` sources, sources are transformed for web,
 * `react-native` is aliased to `react-native-web` and `Platform.OS` is `web`
 * throughout, so the contract reads what the browser bundle actually resolves
 * rather than restating what a native run found.
 * test-support/screenModuleContract.ts holds the suite all three entry points
 * share.
 *
 * The native entry points stub three TurboModules the packages demand at
 * import. A browser build asks for no native module at all, so nothing is
 * stubbed here and the registry stays untouched.
 */

describeScreenModuleContract("web");
