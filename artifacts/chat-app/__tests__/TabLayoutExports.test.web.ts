import { describeTabLayoutModuleContract } from "../test-support/tabLayoutModuleContract";

/**
 * Runs the tab layout's module contract against the packages a browser build
 * of the app resolves.
 *
 * The app ships a web build as well as the two native ones — the Replit
 * preview serves it and server/serve.js serves the built copy — and several of
 * these packages resolve different sources there: expo-blur ships a whole
 * BlurView.web.js, and react-native itself becomes react-native-web. Neither
 * the iOS run nor the Android one can see that, so an SDK upgrade that renamed
 * or dropped a web export would leave both of them green while the browser app
 * failed to load.
 *
 * jest.config.js sends this file to a third project built on `jest-expo/web`:
 * module resolution prefers `.web` sources, sources are transformed for web,
 * `react-native` is aliased to `react-native-web` and `Platform.OS` is `web`
 * throughout, so the contract reads what the browser bundle actually resolves
 * rather than restating what a native run found.
 * test-support/tabLayoutModuleContract.ts holds the suite all three entry
 * points share, and explains which exports are asserted on which platform —
 * the browser draws a plain View instead of BlurView and never reaches the
 * native tabs branch, so those exports are left to the iOS run.
 */

describeTabLayoutModuleContract("web");
