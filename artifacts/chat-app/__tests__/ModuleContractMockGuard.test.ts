import * as SecureStore from "expo-secure-store";

import {
  contractSource,
  EVERY_LISTED_PACKAGE_LOADED,
  EVERY_PACKAGE_LISTED,
  EVERY_PACKAGE_REAL,
  loadedPackages,
  mockedPackageReport,
  sourcePackageReport,
  unlistedPackageReport,
  unloadedPackageReport,
} from "../test-support/moduleContract";
import { describeMockedPackageGuard } from "../test-support/moduleContractMockGuard";

/**
 * Proof that the two checks keeping the deliberately unmocked suites honest
 * actually fire, over the packages an iOS build of the app resolves.
 *
 * Four suites load packages for real where the rest of the run mocks them:
 * test-support/screenModuleContract.ts and
 * test-support/tabLayoutModuleContract.ts import the app's native packages so
 * an Expo SDK bump that renames or drops an export a screen uses fails there
 * rather than on launch, __tests__/FeatherIconNames.test.ts reads the real
 * Feather glyph map the app's icon names are checked against, and
 * test-support/webTabBar.tsx renders the browser's tab bar out of the real
 * packages. jest.mock replaces exactly the route all four take, so each runs
 * mockedPackageReport over the packages it depends on, and the two contracts
 * also run unlistedPackageReport and unloadedPackageReport over their own
 * source so the list each hands those checks names every package it loads and
 * nothing else — and, before either of those can mean anything, so that every
 * load in the source could be read at all. None of these checks can be shown
 * to fire from inside one of those runs: a passing one has no mock to notice,
 * a list that already agrees with its loads, and every load written out as a
 * name. This file supplies the mock, writes a jest mock over an export of a
 * package nothing replaced, reads a real contract against a list with a
 * package taken out of it and against one with a package left on it, and
 * hands the same check a source that loads a package from a value.
 *
 * How far one run's proof carries differs between the two. The
 * mocked-package check compares what `require` and jest.requireActual hand
 * back, and both are the running jest project's own resolution, so it is
 * shown to fire once per project: test-support/moduleContractMockGuard.ts
 * holds that proof, and ModuleContractMockGuard.test.android.ts and
 * ModuleContractMockGuard.test.web.ts run it against mocks of their own,
 * since three of the four suites above run on those projects too. The
 * package-list check reads a suite's source as text, which is the same text
 * whatever platform a run resolves for, so it is proven once here.
 *
 * The packages below are mocked here and nowhere else — screen tests mock them
 * per file, which is the practice those four suites exist to sit outside of —
 * so none of them is affected by what this run installs. The patched exports
 * further down are narrower still: each is written over for one check and put
 * back before the test ends.
 */

/**
 * expo-haptics stands in for the packages nothing mocks today: the way a
 * shared setup file or a future entry point would mock one, and the state the
 * contracts have to fail in. A factory keeps the stand-in from being built out
 * of the real module, so the check has two genuinely different modules to tell
 * apart.
 */
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
}));

jest.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: jest.fn() }));

/**
 * @expo/vector-icons is the one package two of those suites read a *value* out
 * of rather than the shape of an export, so a stand-in for it is the quietest
 * of the lot: this one carries a glyph for each name the app draws, which is
 * all it takes for __tests__/FeatherIconNames.test.ts to check the app's icon
 * names against nothing. Everything else in that suite would pass against it.
 * Every screen test mocks this package, so it is also the likeliest to end up
 * mocked somewhere shared — and the likeliest to be worth proving twice, which
 * is why ModuleContractMockGuard.test.web.ts stands it in again for
 * test-support/webTabBar.tsx, the suite that names the glyphs a rendered bar
 * drew out of this package's own map.
 */
jest.mock("@expo/vector-icons", () => ({
  Feather: { glyphMap: { "message-circle": 0xe001, user: 0xe002 } },
}));

/**
 * @react-native-async-storage/async-storage needs no jest.mock here:
 * jest.setup.js installs its mock in every run of every project, which is why
 * it is the one package the contracts' lists may not name. Reaching its real
 * module means loading the native module it refuses to start without, so this
 * run answers that lookup the way the native contract entry points do.
 */
jest.mock("react-native/Libraries/TurboModule/TurboModuleRegistry", () =>
  jest
    .requireActual<typeof import("../test-support/turboModuleRegistryStub")>(
      "../test-support/turboModuleRegistryStub",
    )
    .registryWithStubbedNativeModules(),
);

describeMockedPackageGuard({
  expectedPlatform: "ios",
  mockedPackages: ["expo-haptics", "expo-web-browser", "@expo/vector-icons"],
  // Left alone, and read for real by the screen contract on this platform, so
  // the check has to pass over them while it names the three above.
  realPackages: ["expo-crypto", "expo-splash-screen"],
});

describe("the mocked-package check's wording, and its one exemption", () => {
  // Neither depends on how this project resolves a package, so both are
  // proven on this run alone rather than repeated on the android and web
  // entry points.

  it("names every mocked package, not just the first", () => {
    expect(
      mockedPackageReport([
        "expo-haptics",
        "expo-crypto",
        "expo-web-browser",
      ]),
    ).toBe(
      "expo-haptics, expo-web-browser are mocks, not the real modules",
    );
  });

  it("would name the one package the contracts leave out", () => {
    // The exemption is what the screen contract's jest.requireActual call is
    // for, and it is load-bearing in both directions: this package is mocked
    // in every run, so a list that named it would fail every run, and the
    // check has to be the reason it is left out rather than an oversight.
    expect(
      mockedPackageReport(["@react-native-async-storage/async-storage"]),
    ).toBe(
      "@react-native-async-storage/async-storage is a mock, not the real module",
    );
  });
});

describe("the unmocked suites' patched-package check", () => {
  /**
   * The module object behind a specifier, held the way a setup file written in
   * JavaScript holds it: something to write an export onto. jest.setup.js is
   * that file here, and a `require("pkg").thing = jest.fn()` added to it is
   * the patch the same check has to catch.
   */
  const moduleObject = (specifier: string): Record<string, unknown> =>
    require<Record<string, unknown>>(specifier);

  /**
   * Writes a jest mock over one property for the length of one check and puts
   * the real one back afterwards, so the packages the rest of this file reads
   * are the packages it left alone.
   */
  function whilePatched(
    target: Record<string, unknown>,
    name: string,
    check: () => void,
  ): void {
    const real = target[name];
    target[name] = jest.fn();
    try {
      check();
    } finally {
      target[name] = real;
    }
  }

  it("names an export a spy replaced on the real module", () => {
    // What no comparison of modules can see: jest.spyOn leaves the package
    // where it was and every other export of it untouched, so both routes to
    // it still answer with the one object. expo-crypto rides along to show
    // that a package beside the patched one is still read as real.
    const spy = jest.spyOn(SecureStore, "getItemAsync");
    try {
      expect(mockedPackageReport(["expo-crypto", "expo-secure-store"])).toBe(
        "expo-secure-store getItemAsync is a mock written onto the real module",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("names an export a setup file assigned over", () => {
    whilePatched(moduleObject("expo-crypto"), "getRandomBytes", () => {
      expect(mockedPackageReport(["expo-crypto"])).toBe(
        "expo-crypto getRandomBytes is a mock written onto the real module",
      );
    });
  });

  it("names a mock written onto a call of an export", () => {
    // One level below the export itself, which is where a spy on a method of
    // an exported object lands — test-support/webTabBar.tsx reads the icon
    // font out of Feather.getFontFamily() that way, and the browser's
    // Dimensions.get is the same shape.
    whilePatched(
      moduleObject("react-native-webview").default as Record<string, unknown>,
      "isFileUploadSupported",
      () => {
        expect(mockedPackageReport(["react-native-webview"])).toBe(
          "react-native-webview default.isFileUploadSupported is a mock " +
            "written onto the real module",
        );
      },
    );
  });

  it("names every patched export, not just the first", () => {
    whilePatched(moduleObject("expo-crypto"), "digest", () => {
      whilePatched(moduleObject("expo-secure-store"), "setItemAsync", () => {
        expect(mockedPackageReport(["expo-crypto", "expo-secure-store"])).toBe(
          "expo-crypto digest, expo-secure-store setItemAsync are mocks " +
            "written onto the real modules",
        );
      });
    });
  });

  it("reports a replaced package and a patched one in one sentence", () => {
    // Also what keeps a replaced package from being reported twice over: the
    // stand-in installed for expo-haptics at the top of this file is three
    // jest.fn()s, and a scan that ran over it as well would name each of them
    // under a package this had already named.
    whilePatched(moduleObject("expo-secure-store"), "getItemAsync", () => {
      expect(mockedPackageReport(["expo-haptics", "expo-secure-store"])).toBe(
        "expo-haptics is a mock, not the real module; expo-secure-store " +
          "getItemAsync is a mock written onto the real module",
      );
    });
  });

  it("reads the patched packages as real again once the patches are gone", () => {
    // Nothing above is left installed, so a package this file borrowed is not
    // a package the next suite to read it finds patched.
    expect(
      mockedPackageReport([
        "expo-crypto",
        "expo-secure-store",
        "react-native-webview",
      ]),
    ).toBe(EVERY_PACKAGE_REAL);
  });
});

describe("the module contracts' package-list check", () => {
  const SCREEN_CONTRACT = "screenModuleContract.ts";

  /** The screen contract's own loads, read the way the check reads them. */
  const loaded = loadedPackages(
    SCREEN_CONTRACT,
    contractSource(SCREEN_CONTRACT),
  ).packages;

  it("reads a package whichever route a suite loads it by", () => {
    expect(
      loadedPackages(
        "contract.ts",
        [
          `import { Platform } from "react-native";`,
          `import * as Haptics from "expo-haptics";`,
          `import { expectFunction } from "./moduleContract";`,
          `const Clerk = require<typeof import("@clerk/expo")>("@clerk/expo");`,
        ].join("\n"),
      ),
    ).toEqual({
      packages: ["react-native", "expo-haptics", "@clerk/expo"],
      unreadable: [],
    });
  });

  it("counts no package a suite only reaches past a mock for", () => {
    // jest.requireActual is the route past a mock rather than the route a mock
    // replaces, and the `typeof import(...)` beside it is a type the file
    // never loads. The screen contract reaches
    // @react-native-async-storage/async-storage exactly that way, which is how
    // its list can leave out the one package jest.setup.js mocks in every run
    // without the check asking for it back.
    expect(
      loadedPackages(
        "contract.ts",
        `const AsyncStorage = jest.requireActual<
           typeof import("@react-native-async-storage/async-storage")
         >("@react-native-async-storage/async-storage").default;`,
      ),
    ).toEqual({ packages: [], unreadable: [] });

    expect(loaded).not.toContain("@react-native-async-storage/async-storage");
    // The read above found the real file, including the package the contract
    // loads with a plain require rather than an import.
    expect(loaded).toContain("@clerk/expo");
  });

  it("names a load whose package it cannot read, and where it sits", () => {
    // `require(name)` pulls a package in like any other load, and the shape
    // assertions read whatever it brought — but no name for it is written
    // anywhere in the file. Read as no load at all it would leave the list
    // below complete and that package inspected by nobody: the silent pass
    // again, one step further along. The packages beside it are still read,
    // so the report says what was lost rather than giving up on the file.
    expect(
      loadedPackages(
        "contract.ts",
        [
          `import * as Haptics from "expo-haptics";`,
          `const entry = "@clerk/expo";`,
          `const Clerk = require(entry);`,
        ].join("\n"),
      ),
    ).toEqual({
      packages: ["expo-haptics"],
      unreadable: ["contract.ts:3 loads a package from a value, not a literal"],
    });
  });

  it("fails a suite that loads a package from a value, list or no list", () => {
    // What a contract's own check answers in that state. Both packages the
    // source names are on the list it is handed, so nothing is unlisted —
    // and the list is still worth nothing, because the load beneath it names
    // no package for the list to be held to.
    expect(
      sourcePackageReport(
        SCREEN_CONTRACT,
        [
          `import * as Haptics from "expo-haptics";`,
          `const entry = "@clerk/expo";`,
          `const Clerk = require(entry);`,
        ].join("\n"),
        ["expo-haptics", "@clerk/expo"],
      ),
    ).toBe(
      "screenModuleContract.ts:3 loads a package from a value, not a literal",
    );
  });

  it("names every load it could not read, not just the first", () => {
    // The other shapes a specifier takes when it is not written out: a name
    // built from a constant, a value handed to import(), and a call that
    // names nothing at all.
    expect(
      sourcePackageReport(
        "contract.ts",
        [
          `const scope = "@clerk";`,
          "const Clerk = require(`${scope}/expo`);",
          `const entry = "expo-haptics";`,
          `const Haptics = import(entry);`,
          `const nothing = require();`,
        ].join("\n"),
        [],
      ),
    ).toBe(
      "contract.ts:2 loads a package from a value, not a literal; " +
        "contract.ts:4 loads a package from a value, not a literal; " +
        "contract.ts:5 passes no module specifier",
    );
  });

  it("names a package the suite loads but its list leaves out", () => {
    // The real screen contract against its own loads with one entry taken
    // away: the state a package added to that file's imports and not to its
    // INSPECTED_PACKAGES leaves the suite in.
    expect(
      unlistedPackageReport(
        SCREEN_CONTRACT,
        loaded.filter((specifier) => specifier !== "expo-haptics"),
      ),
    ).toBe("expo-haptics is loaded but not on the list");
  });

  it("names every package left out, not just the first", () => {
    expect(
      unlistedPackageReport(
        SCREEN_CONTRACT,
        loaded.filter(
          (specifier) =>
            specifier !== "expo-haptics" &&
            specifier !== "react-native-webview",
        ),
      ),
    ).toBe("expo-haptics, react-native-webview are loaded but not on the list");
  });

  it("passes a list that names every package the suite loads", () => {
    expect(unlistedPackageReport(SCREEN_CONTRACT, loaded)).toBe(
      EVERY_PACKAGE_LISTED,
    );
  });

  it("names a package the list keeps but the suite does not load", () => {
    // The real screen contract against its own loads with one entry added:
    // the state an INSPECTED_PACKAGES entry left behind after the import it
    // stood for was removed leaves the suite in. expo-blur is the tab
    // layout's package and nothing mocks it here, so the mocked-package
    // check reads the leftover as clean — the list would go on claiming
    // coverage of an export no assertion in that suite inspects, and this is
    // the check that notices.
    expect(mockedPackageReport(["expo-blur"])).toBe(EVERY_PACKAGE_REAL);
    expect(
      unloadedPackageReport(SCREEN_CONTRACT, [...loaded, "expo-blur"]),
    ).toBe("expo-blur is on the list but not loaded");
  });

  it("names every leftover entry, not just the first", () => {
    expect(
      unloadedPackageReport(SCREEN_CONTRACT, [
        ...loaded,
        "expo-blur",
        "expo-symbols",
      ]),
    ).toBe("expo-blur, expo-symbols are on the list but not loaded");
  });

  it("would name the one package the contracts leave out here too", () => {
    // Nothing exempts @react-native-async-storage/async-storage from this
    // check: it is clear of it only because no list names it. The screen
    // contract reaches it through jest.requireActual, which is not a load,
    // so a list that named it would fail here as well as in the
    // mocked-package check above — leaving it off is what satisfies both.
    expect(
      unloadedPackageReport(SCREEN_CONTRACT, [
        ...loaded,
        "@react-native-async-storage/async-storage",
      ]),
    ).toBe(
      "@react-native-async-storage/async-storage is on the list but not loaded",
    );
  });

  it("passes a list that names only packages the suite loads", () => {
    expect(unloadedPackageReport(SCREEN_CONTRACT, loaded)).toBe(
      EVERY_LISTED_PACKAGE_LOADED,
    );
  });
});
