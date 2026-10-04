import { Platform } from "react-native";
import * as ExpoBlur from "expo-blur";
import * as ExpoRouter from "expo-router";
import * as NativeTabsModule from "expo-router/unstable-native-tabs";
import * as ExpoGlassEffect from "expo-glass-effect";
import * as ExpoSymbols from "expo-symbols";

import {
  EVERY_LISTED_PACKAGE_LOADED,
  EVERY_PACKAGE_LISTED,
  EVERY_PACKAGE_REAL,
  expectComponent,
  expectFunction,
  functionReport,
  member,
  mockedPackageReport,
  unlistedPackageReport,
  unloadedPackageReport,
} from "./moduleContract";

/**
 * Contract for the tab bar's third-party imports, run once per platform.
 *
 * TabLayout.test.tsx and AndroidTabBar.test.android.tsx mock expo-router,
 * expo-router/unstable-native-tabs, expo-symbols, expo-glass-effect and
 * expo-blur, so they stay green even if an Expo SDK bump renames or drops one
 * of those exports — the real app would then crash on launch with an invalid
 * element type. This suite deliberately uses the real modules (no jest.mock)
 * and inspects the shape of each export that app/(tabs)/_layout.tsx imports,
 * so it needs no native modules and never renders anything. The one exception
 * is `isLiquidGlassAvailable`, which the layout calls rather than renders: off
 * iOS the answer decides whether the bundle even loads, so those runs assert
 * the answer as well as the shape.
 *
 * A jest run resolves modules for a single platform, and these packages ship
 * platform-specific sources — expo-symbols, expo-glass-effect and expo-blur all
 * carry per-platform files, and expo-blur ships a whole BlurView.web.js — so
 * one run only ever inspects one platform's build. The suite therefore lives
 * here and runs three times: __tests__/TabLayoutExports.test.ts under jest's
 * default iOS project, __tests__/TabLayoutExports.test.android.ts under the
 * android project in jest.config.js, and
 * __tests__/TabLayoutExports.test.web.ts under the web one. Android is where
 * the classic tab bar ships in production and web is what the Replit preview
 * and server/serve.js hand out, so a rename on either must not be able to hide
 * behind a green iOS run.
 *
 * The imports above are the part of the contract that holds everywhere:
 * app/(tabs)/_layout.tsx imports all five packages whatever it is bundled for,
 * so an SDK that no longer resolves one of them for Android or for the browser
 * fails this suite where it stands, the way that bundle itself would fail.
 * What each export has to *be* is asserted where the layout builds an element
 * from it, and that is not the same set on every platform.
 *
 * test-support/screenModuleContract.ts does the same for the packages the
 * other screens import.
 */

/**
 * Every package this suite inspects, in the order the imports above load them.
 *
 * Each assertion below reads one of those imports, and an import is what
 * jest.mock replaces, so this list is what keeps the suite unmocked: a run
 * where one of these packages is a stand-in fails here, naming it, instead of
 * inspecting the stand-in's shape and passing. A package added to the imports
 * above belongs here too, and an entry kept here after the import it stood
 * for went away is drift the other way, claiming coverage this suite no
 * longer has; a run fails on either, naming the package. See
 * unlistedPackageReport and unloadedPackageReport in ./moduleContract, and
 * mockedPackageReport in the same module for the one package a contract list
 * may not name.
 */
const INSPECTED_PACKAGES = [
  "react-native",
  "expo-blur",
  "expo-router",
  "expo-router/unstable-native-tabs",
  "expo-glass-effect",
  "expo-symbols",
] as const;

/**
 * This file's own name, for the two checks that read its imports back out of
 * its source and hold the list above to them in both directions.
 */
const CONTRACT_FILE = "tabLayoutModuleContract.ts";

/**
 * Reads what the real `isLiquidGlassAvailable` answers, as a sentence.
 *
 * An export that no longer exists reports itself the way the shape assertion
 * would, rather than throwing a TypeError over the answer being asked for.
 */
function liquidGlassAnswerReport(): string {
  const isLiquidGlassAvailable = ExpoGlassEffect.isLiquidGlassAvailable;
  if (typeof isLiquidGlassAvailable !== "function") {
    return functionReport(
      "expo-glass-effect isLiquidGlassAvailable",
      isLiquidGlassAvailable,
    );
  }
  return `expo-glass-effect isLiquidGlassAvailable() answers ${isLiquidGlassAvailable()}`;
}

/**
 * The exports every platform depends on: `isLiquidGlassAvailable` decides which
 * layout renders on every launch, and the classic `Tabs` navigator it falls
 * back to is what Android and web ship.
 *
 * @param expectedPlatform The platform the calling file's jest project targets.
 */
function describeSharedExports(
  expectedPlatform: "android" | "ios" | "web",
): void {
  describe("expo-glass-effect", () => {
    it("exports isLiquidGlassAvailable as a function", () => {
      expectFunction(
        "expo-glass-effect isLiquidGlassAvailable",
        ExpoGlassEffect.isLiquidGlassAvailable,
      );
    });

    if (expectedPlatform !== "ios") {
      it("answers false, so this bundle takes the classic tab bar branch", () => {
        // app/(tabs)/_layout.tsx renders NativeTabs — an iOS-only native view
        // — whenever this answers true, so Android and the browser load at all
        // only because the package's non-iOS source returns false. An SDK bump
        // that changed that would fail those bundles on launch while every
        // shape assertion here still passed, and TabLayout.test.tsx mocks the
        // module, so this unmocked run is the only place it can be caught.
        //
        // The iOS run deliberately skips this: there the answer comes from the
        // native module and a real iPhone may legitimately say either.
        expect(liquidGlassAnswerReport()).toBe(
          "expo-glass-effect isLiquidGlassAvailable() answers false",
        );
      });
    }
  });

  describe("expo-router", () => {
    it("exports Tabs as a component", () => {
      expectComponent("expo-router Tabs", ExpoRouter.Tabs);
    });

    it("exposes Tabs.Screen for registering tab routes", () => {
      expectComponent("expo-router Tabs.Screen", member(ExpoRouter.Tabs, "Screen"));
    });
  });
}

/**
 * The exports only an iOS build ever renders.
 *
 * `NativeTabs`, and the `Icon` and `Label` it takes as children, live behind
 * `isLiquidGlassAvailable()`, which describeSharedExports pins to false off
 * iOS for exactly this reason — nothing here may ever render there; `SymbolView`
 * and `BlurView` sit behind `Platform.OS === "ios"` checks inside the classic
 * layout, which draws Feather icons everywhere else and fills the tab bar with
 * a plain `View` in the browser. expo-symbols in particular is an SF Symbols
 * binding, and expo-blur does ship a BlurView.web.js — but nothing in the app
 * asks Android for the first or the browser for the second, so requiring them
 * everywhere would fail those runs over an iOS API those bundles never touch.
 *
 * The icon the classic bar draws on Android and web instead is
 * `@expo/vector-icons` Feather, which test-support/screenModuleContract.ts
 * asserts on every platform because the other screens draw it too.
 */
function describeIOSOnlyExports(): void {
  describe("expo-router/unstable-native-tabs", () => {
    it("exports NativeTabs as a component", () => {
      expectComponent("NativeTabs", NativeTabsModule.NativeTabs);
    });

    it("exposes NativeTabs.Trigger for registering native tabs", () => {
      expectComponent(
        "NativeTabs.Trigger",
        member(NativeTabsModule.NativeTabs, "Trigger"),
      );
    });
  });

  describe("expo-router's native tab children", () => {
    it("exports Icon as a component", () => {
      expectComponent("expo-router Icon", ExpoRouter.Icon);
    });

    it("exports Label as a component", () => {
      expectComponent("expo-router Label", ExpoRouter.Label);
    });
  });

  describe("expo-symbols", () => {
    it("exports SymbolView as a component", () => {
      expectComponent("expo-symbols SymbolView", ExpoSymbols.SymbolView);
    });
  });

  describe("expo-blur", () => {
    it("exports BlurView as a component", () => {
      expectComponent("expo-blur BlurView", ExpoBlur.BlurView);
    });
  });
}

/**
 * Registers the tab layout's module contract for one platform.
 *
 * @param expectedPlatform The platform the calling file's jest project targets.
 */
export function describeTabLayoutModuleContract(
  expectedPlatform: "android" | "ios" | "web",
): void {
  describe(`tab layout module contract on ${expectedPlatform}`, () => {
    it("runs on the platform this file exists to inspect", () => {
      // Each entry point only inspects another platform's build of these
      // packages while its project in jest.config.js keeps targeting the
      // platform it was written for. A project that quietly stopped doing so
      // would leave two runs reading the same build, and both would pass.
      expect(`the suite is running on ${Platform.OS}`).toBe(
        `the suite is running on ${expectedPlatform}`,
      );
    });

    it("inspects the real packages, not stand-ins for them", () => {
      // Everything below reads an import at the top of this file, which is
      // the route jest.mock replaces. A shared setup file, or a future entry
      // point, that mocked one of these packages would leave every assertion
      // reading the mock's shape and passing, with nothing left watching what
      // the SDK builds for the tab bar.
      expect(mockedPackageReport(INSPECTED_PACKAGES)).toBe(EVERY_PACKAGE_REAL);
    });

    it("leaves no package it loads off that list", () => {
      // The check above only covers the packages INSPECTED_PACKAGES names, so
      // a package imported here and left off that list is read by every
      // assertion below and skipped by the mock check — the same silent pass,
      // narrowed to the newest package. This reads this file's own imports
      // back and holds the list to them.
      expect(unlistedPackageReport(CONTRACT_FILE, INSPECTED_PACKAGES)).toBe(
        EVERY_PACKAGE_LISTED,
      );
    });

    it("keeps no package on that list it does not load", () => {
      // The same drift the other way: an entry left on INSPECTED_PACKAGES
      // after the import it stood for was removed claims coverage this suite
      // no longer has, and the mock check passes it — it loads that package
      // itself and finds the real module. Reading the list against this
      // file's own imports is what notices.
      expect(unloadedPackageReport(CONTRACT_FILE, INSPECTED_PACKAGES)).toBe(
        EVERY_LISTED_PACKAGE_LOADED,
      );
    });

    describeSharedExports(expectedPlatform);

    if (expectedPlatform === "ios") {
      describeIOSOnlyExports();
    }
  });
}
