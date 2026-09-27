import {
  registeredTabScreens,
  screensUnderTabBar,
} from "../test-support/tabScreens";

/**
 * Covers test-support/tabScreens.ts, the discovery TabLayout.test.tsx,
 * AndroidTabBar.test.android.tsx and TabBarClearance.test.tsx derive their
 * expectations from.
 *
 * Those suites check the discovery against the app's real app/(tabs)/, which
 * today holds two route files and nothing else: the shapes expo-router also
 * ships — a tab written as a directory holding an index route, the routes such
 * a directory pushes inside that tab, and the names the router keeps for
 * itself — never appear there, so nothing exercises how the discovery treats
 * them. This file hands the discovery a directory of its own instead, so a
 * route shape it stopped finding fails here rather than silently shrinking
 * what those three suites check.
 *
 * `node:fs` is replaced only for reads of app/(tabs)/; every other path still
 * reaches the real filesystem.
 */

/** The fake tree, as directory path to entry names; a trailing / is a folder. */
const mockDirectories: { entries: Record<string, string[]> } = { entries: {} };

/** The paths the discovery asked for, to check it reads the app's own tabs. */
const mockReadPaths: string[] = [];

const TAB_DIRECTORY = "app/(tabs)";

/**
 * The app has no @types/node, so the one call this file forwards to the real
 * module is described here, the way test-support/tabScreens.ts describes the
 * one it makes.
 */
type RealFileSystem = Record<string, unknown> & {
  readdirSync: (path: string, options: { withFileTypes: true }) => unknown[];
};

jest.mock("node:fs", () => {
  const actual = jest.requireActual<RealFileSystem>("node:fs");

  /** The fake tree's key for a path, or null for a path it does not own. */
  const keyOf = (directory: string): string | null => {
    const marker = directory.indexOf("app/(tabs)");
    if (marker === -1) return null;
    return directory.slice(marker + "app/(tabs)".length).replace(/^\//, "");
  };

  return {
    ...actual,
    readdirSync: (directory: string, options: { withFileTypes: true }) => {
      const key = keyOf(directory);
      if (key === null) return actual.readdirSync(directory, options);

      mockReadPaths.push(directory);
      const names = mockDirectories.entries[key];
      if (!names) {
        throw new Error(
          `ENOENT: no such directory in this test's tab tree: ${directory}`,
        );
      }

      return names.map((name) => ({
        name: name.replace(/\/$/, ""),
        isFile: () => !name.endsWith("/"),
        isDirectory: () => name.endsWith("/"),
      }));
    },
  };
});

/** Stands the fake app/(tabs)/ up: "" is the tab directory itself. */
function givenTabDirectory(entries: Record<string, string[]>): void {
  mockDirectories.entries = entries;
}

beforeEach(() => {
  mockDirectories.entries = {};
  mockReadPaths.length = 0;
});

describe("tab screen discovery", () => {
  it("reads the app's own tab directory", () => {
    // The fake tree below only stands in for app/(tabs)/ while the discovery
    // still reads that directory; pointed anywhere else it would describe a
    // directory the app does not ship its tabs from.
    givenTabDirectory({ "": ["index.tsx"] });

    registeredTabScreens();

    expect(mockReadPaths.map((path) => path.endsWith(TAB_DIRECTORY))).toEqual([
      true,
    ]);
  });

  it("reports a tab written as a file", () => {
    givenTabDirectory({ "": ["_layout.tsx", "index.tsx", "profile.tsx"] });

    expect(registeredTabScreens()).toEqual(["index", "profile"]);
  });

  it("reports a tab written as a folder holding an index route", () => {
    // expo-router ships app/(tabs)/settings/index.tsx as a Settings tab, the
    // same as app/(tabs)/settings.tsx, so the checks have to see it as one.
    givenTabDirectory({
      "": ["_layout.tsx", "index.tsx", "settings/"],
      settings: ["index.tsx"],
    });

    expect(registeredTabScreens()).toEqual(["index", "settings"]);
  });

  it("reports a folder whose index route is a platform variant", () => {
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: ["index.android.tsx", "index.ios.tsx", "SettingsRow.tsx"],
    });

    expect(registeredTabScreens()).toEqual(["index", "settings"]);
  });

  it("reports a folder once however many variants its index has", () => {
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: ["index.tsx", "index.android.tsx", "index.web.tsx"],
    });

    expect(registeredTabScreens()).toEqual(["index", "settings"]);
  });

  it("skips a folder that holds no index route", () => {
    // A folder of parts a tab screen imports is not a tab: the router opens
    // nothing when there is no index route in it.
    givenTabDirectory({
      "": ["index.tsx", "components/"],
      components: ["RoomCard.tsx", "RoomList.tsx"],
    });

    expect(registeredTabScreens()).toEqual(["index"]);
  });

  it("skips the layout, the router's own entry points and dotfiles", () => {
    givenTabDirectory({
      "": [
        "_layout.tsx",
        "+not-found.tsx",
        "+html.tsx",
        ".profile.tsx.swp~",
        ".index.tsx",
        "README.md",
        "index.tsx",
      ],
    });

    expect(registeredTabScreens()).toEqual(["index"]);
  });

  it("skips those names written as folders too", () => {
    givenTabDirectory({
      "": ["index.tsx", "_layout/", "+native-intent/", ".trash/"],
      _layout: ["index.tsx"],
      "+native-intent": ["index.tsx"],
      ".trash": ["index.tsx"],
    });

    expect(registeredTabScreens()).toEqual(["index"]);
  });

  it("sorts the tabs it finds, whatever order the directory lists them in", () => {
    givenTabDirectory({
      "": ["profile.tsx", "settings/", "index.tsx"],
      settings: ["index.tsx"],
    });

    expect(registeredTabScreens()).toEqual(["index", "profile", "settings"]);
  });
});

describe("screens under the tab bar", () => {
  it("reports every tab, whichever shape it is written as", () => {
    givenTabDirectory({
      "": ["_layout.tsx", "index.tsx", "profile.tsx", "settings/"],
      settings: ["index.tsx"],
    });

    expect(screensUnderTabBar()).toEqual(["index", "profile", "settings"]);
  });

  it("reports a route a tab folder pushes inside that tab", () => {
    // expo-router ships app/(tabs)/settings/details.tsx as a route pushed
    // inside the Settings tab, and React Navigation keeps the classic tab bar
    // on screen while it is open, so the bar floats over it too.
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: ["index.tsx", "details.tsx"],
    });

    expect(screensUnderTabBar()).toEqual([
      "index",
      "settings",
      "settings/details",
    ]);
  });

  it("reports a nested route once however many variants it has", () => {
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: ["index.tsx", "details.tsx", "details.android.tsx"],
    });

    expect(screensUnderTabBar()).toEqual([
      "index",
      "settings",
      "settings/details",
    ]);
  });

  it("skips the layout, the router's own entry points and dotfiles inside the folder", () => {
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: [
        "_layout.tsx",
        "+not-found.tsx",
        ".details.tsx.swp~",
        ".details.tsx",
        "README.md",
        "index.tsx",
        "details.tsx",
      ],
    });

    expect(screensUnderTabBar()).toEqual([
      "index",
      "settings",
      "settings/details",
    ]);
  });

  it("skips those names written as folders inside the tab folder too", () => {
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: ["index.tsx", "_layout/", "+native-intent/", ".trash/"],
      "settings/_layout": ["index.tsx"],
      "settings/+native-intent": ["index.tsx"],
      "settings/.trash": ["index.tsx"],
    });

    expect(screensUnderTabBar()).toEqual(["index", "settings"]);
  });

  it("reports the routes of a folder nested inside a tab folder", () => {
    // The router opens settings/account because it holds an index route, and
    // pushes settings/account/edit inside the same tab, bar and all.
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: ["index.tsx", "account/"],
      "settings/account": ["index.tsx", "edit.tsx"],
    });

    expect(screensUnderTabBar()).toEqual([
      "index",
      "settings",
      "settings/account",
      "settings/account/edit",
    ]);
  });

  it("reports a route in a folder that holds no index route of its own", () => {
    // expo-router makes a route out of every source file it finds, so
    // settings/account/edit ships whether or not settings/account/index.tsx
    // exists; only settings/account itself opens nothing without one.
    givenTabDirectory({
      "": ["index.tsx", "settings/"],
      settings: ["index.tsx", "account/"],
      "settings/account": ["edit.tsx"],
    });

    expect(screensUnderTabBar()).toEqual([
      "index",
      "settings",
      "settings/account/edit",
    ]);
  });

  it("reports a route in a top-level folder that ships no tab of its own", () => {
    // Such a folder is not a tab — registeredTabScreens leaves it out — but
    // the router still ships the files in it as routes inside the navigator,
    // so the bar floats over them and they have to reserve room for it.
    givenTabDirectory({
      "": ["index.tsx", "shared/"],
      shared: ["Row.tsx"],
    });

    expect(registeredTabScreens()).toEqual(["index"]);
    expect(screensUnderTabBar()).toEqual(["index", "shared/Row"]);
  });

  it("reports nothing inside a tab written as a file", () => {
    givenTabDirectory({ "": ["index.tsx", "profile.tsx"] });

    expect(screensUnderTabBar()).toEqual(["index", "profile"]);
  });

  it("sorts the screens it finds, whatever order the directories list them in", () => {
    givenTabDirectory({
      "": ["profile.tsx", "settings/", "index.tsx"],
      settings: ["details.tsx", "account/", "index.tsx"],
      "settings/account": ["index.tsx"],
    });

    expect(screensUnderTabBar()).toEqual([
      "index",
      "profile",
      "settings",
      "settings/account",
      "settings/details",
    ]);
  });
});
