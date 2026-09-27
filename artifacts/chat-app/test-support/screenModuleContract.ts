import { Platform } from "react-native";
import * as Inter from "@expo-google-fonts/inter";
import * as VectorIcons from "@expo/vector-icons";
import * as ExpoCrypto from "expo-crypto";
import * as ExpoRouter from "expo-router";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import * as WebBrowser from "expo-web-browser";
import * as GestureHandler from "react-native-gesture-handler";
import * as KeyboardController from "react-native-keyboard-controller";
import * as SafeAreaContext from "react-native-safe-area-context";
import * as WebViewModule from "react-native-webview";

import {
  EVERY_LISTED_PACKAGE_LOADED,
  EVERY_PACKAGE_LISTED,
  EVERY_PACKAGE_REAL,
  expectComponent,
  expectDefined,
  expectFunction,
  member,
  mockedPackageReport,
  unlistedPackageReport,
  unloadedPackageReport,
} from "./moduleContract";

/**
 * Contract for the third-party imports of the screens outside the tab bar, run
 * once per platform.
 *
 * SignIn.test.tsx, SignUp.test.tsx, Room.test.tsx, EntryBranding.test.tsx and
 * the rest mock @clerk/expo, expo-haptics, expo-secure-store,
 * react-native-keyboard-controller and friends, so they stay green even if an
 * Expo SDK bump renames or drops one of those exports — the real app would then
 * crash on launch with an invalid element type. This suite deliberately uses
 * the real modules (no jest.mock of the packages themselves) and inspects the
 * shape of each export the app imports, so nothing is rendered here. The one
 * check that goes further belongs to
 * @react-native-async-storage/async-storage, the only package here that has to
 * be reached past a mock, and so the only one that has to say out loud which
 * platform's build answered.
 *
 * A jest run resolves modules for a single platform, and several of these
 * packages ship platform-specific sources — react-native-webview,
 * react-native-keyboard-controller and expo-secure-store all resolve something
 * else in the browser — so one run only ever inspects one platform's build.
 * The suite therefore lives here and runs three times:
 * __tests__/ScreenModuleExports.test.ts under jest's default iOS project,
 * __tests__/ScreenModuleExports.test.android.ts under the android project in
 * jest.config.js, and __tests__/ScreenModuleExports.test.web.ts under the web
 * one. So an export that survived only on iOS cannot leave an Android phone
 * crashing on launch, or the browser build the Replit preview and
 * server/serve.js hand out failing to load, behind a green run.
 *
 * Every screen outside the tab bar renders the same tree on every platform, so
 * unlike test-support/tabLayoutModuleContract.ts this suite asserts the same
 * exports on each. Where a package has no browser implementation the export
 * still has to exist: the web build of react-native-webview resolves a
 * placeholder component rather than dropping `WebView`, and expo-secure-store
 * keeps its three async calls over an empty web module, so the screens that
 * import them still load. test-support/tabLayoutModuleContract.ts does the
 * same for app/(tabs)/_layout.tsx, which is why expo-router's Icon, Label and
 * Tabs are asserted there while the navigation exports the other screens use
 * are asserted here.
 *
 * expo-image-picker is a declared dependency but no screen imports it, so there
 * is no import contract for it to protect.
 */

/**
 * Every package this suite inspects, in the order the file loads them: the
 * imports above first, then the two Clerk entry points the require below
 * reaches once the guard is in place.
 *
 * Each assertion below reads one of those bindings, and both routes to them —
 * an import and a require — are what jest.mock replaces, so this list is what
 * keeps the suite unmocked: a run where one of these packages is a stand-in
 * fails, naming it, instead of inspecting the stand-in's shape and passing. A
 * package added above belongs here too, and an entry kept here after the load
 * it stood for went away is drift the other way, claiming coverage this suite
 * no longer has; a run fails on either, naming the package. See
 * unlistedPackageReport and unloadedPackageReport in ./moduleContract.
 *
 * @react-native-async-storage/async-storage is missing on purpose. It is the
 * one package here that jest.setup.js mocks for every run, and the contract
 * below is written to step past that mock rather than inspect what it
 * installed, so naming it here would fail every run; see mockedPackageReport
 * in ./moduleContract. Nothing has to be excused for it: the contract reaches
 * it through jest.requireActual, which is not a route a mock replaces and so
 * not a load the list is held to.
 */
const INSPECTED_PACKAGES = [
  "react-native",
  "@expo-google-fonts/inter",
  "@expo/vector-icons",
  "expo-crypto",
  "expo-router",
  "expo-haptics",
  "expo-secure-store",
  "expo-splash-screen",
  "expo-web-browser",
  "react-native-gesture-handler",
  "react-native-keyboard-controller",
  "react-native-safe-area-context",
  "react-native-webview",
  "@clerk/expo",
  "@clerk/expo/legacy",
] as const;

/**
 * This file's own name, for the two checks that read its loads back out of
 * its source and hold the list above to them in both directions.
 */
const CONTRACT_FILE = "screenModuleContract.ts";

/**
 * @clerk/expo opens a BroadcastChannel as it loads, but only when the runtime
 * it lands in has one, and the three runtimes behind this suite disagree about
 * that. React Native has none, so a phone never takes that branch. Jest's Node
 * environment, which the iOS and Android projects run in, does, and the
 * channel Clerk opens there holds the event loop open long after the
 * assertions finish. jsdom, which the web project runs in, has none either, so
 * that run never opens one — while the browser the Replit preview and
 * server/serve.js hand the web build to does, which means the browser build of
 * the app genuinely takes the branch, just nowhere this suite can watch it.
 *
 * So the global is hidden only where the runtime actually declares one, which
 * is Node: the single runtime here offering a channel no build of the app
 * would find. Where there is none there is nothing to hide, and writing the
 * absent global back afterwards would leave jsdom holding a
 * `BroadcastChannel` of `undefined` it never had.
 */
const broadcastChannel = Reflect.getOwnPropertyDescriptor(
  globalThis,
  "BroadcastChannel",
);
if (broadcastChannel) {
  Reflect.deleteProperty(globalThis, "BroadcastChannel");
}

/**
 * These two are loaded here rather than imported at the top of the file so the
 * guard above is in place first, and they are loaded with a plain `require` —
 * what the screens' own imports compile to — so they resolve exactly the way
 * the app resolves them and the contract reads the same copy the rest of the
 * run holds. On the web run that means the browser build, where `react-native`
 * is react-native-web and Clerk finds the `Platform` it reads `OS` off.
 *
 * jest.requireActual is a second route. Stepping over a mock is the whole of
 * what it offers, nothing here needs that — no entry point mocks Clerk — and
 * on the web run it answers with its own copy of a package rather than the one
 * the rest of the run holds. The AsyncStorage contract below has no other way
 * past the mock jest.setup.js installs, and the react-native check in the
 * suite holds that route to this platform's build.
 */
const Clerk = require<typeof import("@clerk/expo")>("@clerk/expo");
const ClerkLegacy = require<
  typeof import("@clerk/expo/legacy")
>("@clerk/expo/legacy");

/**
 * Read here, while the guard above still stands, rather than inside the test
 * that reports it. The check asks for the real module behind whatever the run
 * installed for each package, so a run that mocked @clerk/expo would load the
 * real one through jest.requireActual — and Clerk opening a BroadcastChannel
 * outside this guard would hold Node's event loop open long after the failure
 * it exists to report.
 */
const packageReport = mockedPackageReport(INSPECTED_PACKAGES);

if (broadcastChannel) {
  Reflect.defineProperty(globalThis, "BroadcastChannel", broadcastChannel);
}

/**
 * Registers the screens' module contract for one platform.
 *
 * @param expectedPlatform The platform the calling file's jest project targets.
 */
export function describeScreenModuleContract(
  expectedPlatform: "android" | "ios" | "web",
): void {
  describe(`screen module contract on ${expectedPlatform}`, () => {
    it("runs on the platform this file exists to inspect", () => {
      // Each entry point only inspects another platform's build of these
      // packages while its project in jest.config.js keeps targeting the
      // platform it was written for. A project that quietly stopped doing so
      // would leave two runs reading the same build, and both would pass.
      expect(`the suite is running on ${Platform.OS}`).toBe(
        `the suite is running on ${expectedPlatform}`,
      );
    });

    it("reads this platform's build through jest.requireActual too", () => {
      // The AsyncStorage contract below has to reach past the mock
      // jest.setup.js installs, and jest.requireActual is the only way to do
      // that — a route the app itself never takes, resolving on its own
      // terms. Anything loaded that way has to land on the build the app
      // lands on, and nothing about the route says which one that was: a run
      // that resolved the phone build there would inspect it while still
      // reporting itself as web. On web the app's `react-native` is
      // react-native-web, and the native package the alias replaces has no
      // web source for the `Platform` that @clerk/expo and the screens read,
      // so asking this route for react-native names the build it hands back.
      const routed =
        jest.requireActual<typeof import("react-native")>("react-native");
      expect(`jest.requireActual reads the ${routed.Platform.OS} build`).toBe(
        `jest.requireActual reads the ${expectedPlatform} build`,
      );
    });

    it("inspects the real packages, not stand-ins for them", () => {
      // Everything below reads a binding this file imported or required, and
      // those are the routes jest.mock replaces. A shared setup file, or a
      // future entry point, that mocked one of these packages would leave
      // every assertion reading the mock's shape and passing, with nothing
      // left watching what the SDK hands the screens.
      expect(packageReport).toBe(EVERY_PACKAGE_REAL);
    });

    it("leaves no package it loads off that list", () => {
      // The check above only covers the packages INSPECTED_PACKAGES names, so
      // a package imported here and left off that list is read by every
      // assertion below and skipped by the mock check — the same silent pass,
      // narrowed to the newest package. This reads this file's own imports and
      // requires back and holds the list to them.
      expect(unlistedPackageReport(CONTRACT_FILE, INSPECTED_PACKAGES)).toBe(
        EVERY_PACKAGE_LISTED,
      );
    });

    it("keeps no package on that list it does not load", () => {
      // The same drift the other way: an entry left on INSPECTED_PACKAGES
      // after the import or require it stood for was removed claims coverage
      // this suite no longer has, and the mock check passes it — it loads
      // that package itself and finds the real module. Reading the list
      // against this file's own loads is what notices.
      expect(unloadedPackageReport(CONTRACT_FILE, INSPECTED_PACKAGES)).toBe(
        EVERY_LISTED_PACKAGE_LOADED,
      );
    });

    describe("@clerk/expo", () => {
      it("exports ClerkProvider as a component", () => {
        expectComponent("@clerk/expo ClerkProvider", Clerk.ClerkProvider);
      });

      it("exports the hooks the screens and contexts call", () => {
        expectFunction("@clerk/expo useAuth", Clerk.useAuth);
        expectFunction("@clerk/expo useClerk", Clerk.useClerk);
        expectFunction("@clerk/expo useOAuth", Clerk.useOAuth);
        expectFunction("@clerk/expo useSignIn", Clerk.useSignIn);
      });
    });

    describe("@clerk/expo/legacy", () => {
      it("exports the sign-in and sign-up hooks", () => {
        expectFunction("@clerk/expo/legacy useSignIn", ClerkLegacy.useSignIn);
        expectFunction("@clerk/expo/legacy useSignUp", ClerkLegacy.useSignUp);
      });
    });

    describe("expo-router", () => {
      it("exports Link and Stack as components", () => {
        expectComponent("expo-router Link", ExpoRouter.Link);
        expectComponent("expo-router Stack", ExpoRouter.Stack);
      });

      it("exposes Stack.Screen for registering stack routes", () => {
        expectComponent(
          "expo-router Stack.Screen",
          member(ExpoRouter.Stack, "Screen"),
        );
      });

      it("exports the navigation hooks the screens call", () => {
        expectFunction("expo-router useRouter", ExpoRouter.useRouter);
        expectFunction("expo-router useSegments", ExpoRouter.useSegments);
        expectFunction(
          "expo-router useLocalSearchParams",
          ExpoRouter.useLocalSearchParams,
        );
      });
    });

    describe("expo-web-browser", () => {
      it("exports maybeCompleteAuthSession as a function", () => {
        expectFunction(
          "expo-web-browser maybeCompleteAuthSession",
          WebBrowser.maybeCompleteAuthSession,
        );
      });
    });

    describe("expo-splash-screen", () => {
      it("exports the splash controls the root layout calls", () => {
        expectFunction(
          "expo-splash-screen preventAutoHideAsync",
          SplashScreen.preventAutoHideAsync,
        );
        expectFunction("expo-splash-screen hideAsync", SplashScreen.hideAsync);
      });
    });

    describe("@expo-google-fonts/inter", () => {
      it("exports useFonts as a function", () => {
        expectFunction("@expo-google-fonts/inter useFonts", Inter.useFonts);
      });

      it("exports the four Inter weights the app loads", () => {
        expectDefined("Inter_400Regular", Inter.Inter_400Regular);
        expectDefined("Inter_500Medium", Inter.Inter_500Medium);
        expectDefined("Inter_600SemiBold", Inter.Inter_600SemiBold);
        expectDefined("Inter_700Bold", Inter.Inter_700Bold);
      });
    });

    describe("@expo/vector-icons", () => {
      it("exports Feather as a component", () => {
        expectComponent("@expo/vector-icons Feather", VectorIcons.Feather);
      });
    });

    describe("expo-haptics", () => {
      it("exports the feedback functions the screens call", () => {
        expectFunction("expo-haptics impactAsync", Haptics.impactAsync);
        expectFunction(
          "expo-haptics notificationAsync",
          Haptics.notificationAsync,
        );
        expectFunction("expo-haptics selectionAsync", Haptics.selectionAsync);
      });

      it("exposes the impact styles the screens pass", () => {
        expectDefined(
          "Haptics.ImpactFeedbackStyle.Light",
          member(Haptics.ImpactFeedbackStyle, "Light"),
        );
        expectDefined(
          "Haptics.ImpactFeedbackStyle.Medium",
          member(Haptics.ImpactFeedbackStyle, "Medium"),
        );
      });

      it("exposes the notification types the screens pass", () => {
        expectDefined(
          "Haptics.NotificationFeedbackType.Success",
          member(Haptics.NotificationFeedbackType, "Success"),
        );
        expectDefined(
          "Haptics.NotificationFeedbackType.Warning",
          member(Haptics.NotificationFeedbackType, "Warning"),
        );
        expectDefined(
          "Haptics.NotificationFeedbackType.Error",
          member(Haptics.NotificationFeedbackType, "Error"),
        );
      });
    });

    describe("expo-secure-store", () => {
      it("exports the calls the key store and token cache make", () => {
        expectFunction(
          "expo-secure-store getItemAsync",
          SecureStore.getItemAsync,
        );
        expectFunction(
          "expo-secure-store setItemAsync",
          SecureStore.setItemAsync,
        );
        expectFunction(
          "expo-secure-store deleteItemAsync",
          SecureStore.deleteItemAsync,
        );
      });
    });

    describe("expo-crypto", () => {
      it("exports getRandomBytes as a function", () => {
        expectFunction("expo-crypto getRandomBytes", ExpoCrypto.getRandomBytes);
      });
    });

    describe("react-native-keyboard-controller", () => {
      it("exports the keyboard components the chat surfaces render", () => {
        expectComponent(
          "react-native-keyboard-controller KeyboardProvider",
          KeyboardController.KeyboardProvider,
        );
        expectComponent(
          "react-native-keyboard-controller KeyboardAvoidingView",
          KeyboardController.KeyboardAvoidingView,
        );
        expectComponent(
          "react-native-keyboard-controller KeyboardAwareScrollView",
          KeyboardController.KeyboardAwareScrollView,
        );
      });
    });

    describe("react-native-safe-area-context", () => {
      it("exports SafeAreaProvider as a component", () => {
        expectComponent(
          "react-native-safe-area-context SafeAreaProvider",
          SafeAreaContext.SafeAreaProvider,
        );
      });

      it("exports useSafeAreaInsets as a function", () => {
        expectFunction(
          "react-native-safe-area-context useSafeAreaInsets",
          SafeAreaContext.useSafeAreaInsets,
        );
      });
    });

    describe("react-native-gesture-handler", () => {
      it("exports GestureHandlerRootView as a component", () => {
        expectComponent(
          "react-native-gesture-handler GestureHandlerRootView",
          GestureHandler.GestureHandlerRootView,
        );
      });
    });

    describe("react-native-webview", () => {
      it("exports WebView as the default component", () => {
        expectComponent("react-native-webview WebView", WebViewModule.default);
      });
    });

    describe("@react-native-async-storage/async-storage", () => {
      /**
       * jest.setup.js swaps this package for the mock it ships with, so the
       * real module has to be asked for explicitly, and jest.requireActual is
       * the one route that steps over a mock. Stepping over it is all it
       * does: which source file answers is still the running project's
       * choice, so the web run gets the browser build — the one that stores
       * through window.localStorage rather than through the native module a
       * phone build talks to — and the check below has that run prove it
       * rather than assume it.
       */
      const AsyncStorage = jest.requireActual<
        typeof import("@react-native-async-storage/async-storage")
      >("@react-native-async-storage/async-storage").default;

      it("exports the reads and writes the accessibility store makes", () => {
        expectFunction("AsyncStorage.getItem", member(AsyncStorage, "getItem"));
        expectFunction("AsyncStorage.setItem", member(AsyncStorage, "setItem"));
      });

      if (expectedPlatform === "web") {
        it("answers the browser run with its browser build", async () => {
          // Both builds export these calls, so their shape says nothing about
          // which one this run reached past the mock for. What sits behind
          // them does: the browser build writes straight to localStorage,
          // which no phone build has.
          const key = "screen-module-contract";
          await AsyncStorage.setItem(key, "written by the browser build");
          const stored = window.localStorage.getItem(key);
          window.localStorage.removeItem(key);

          expect(`AsyncStorage stored: ${stored}`).toBe(
            "AsyncStorage stored: written by the browser build",
          );
        });
      }
    });
  });
}
