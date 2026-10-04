import { rootStackRoutes, stackScreens } from "../test-support/stackScreens";

/**
 * Covers test-support/stackScreens.ts: the screens
 * __tests__/BottomClearance.test.tsx measures, and the names
 * __tests__/StackLayout.test.tsx requires app/_layout.tsx to register.
 *
 * Those suites check the discovery against the app's real app/, which today
 * holds a handful of route files, two folders of them and two groups: the
 * other shapes expo-router also ships — a folder holding an index route, a
 * folder nested inside another, a folder with a layout of its own below the
 * top level, a group without one, and the names the router keeps for itself
 * written as folders — never appear there, so nothing exercises how the
 * discovery treats them. This file hands the discovery a directory of its own
 * instead, so a route shape it stopped finding fails here rather than
 * silently shrinking the list of screens those suites check.
 *
 * `node:fs` is replaced only for reads of the app's route directory; every
 * other path still reaches the real filesystem.
 */

/** The fake tree, as directory path to entry names; a trailing / is a folder. */
const mockDirectories: { entries: Record<string, string[]> } = { entries: {} };

/** The paths the discovery asked for, to check it reads the app's own routes. */
const mockReadPaths: string[] = [];

/** How test-support/stackScreens.ts names app/, relative to its own folder. */
const APP_DIRECTORY = "/../app";

/**
 * The app has no @types/node, so the one call this file forwards to the real
 * module is described here, the way test-support/routeFiles.ts describes the
 * one it makes.
 */
type RealFileSystem = Record<string, unknown> & {
  readdirSync: (path: string, options: { withFileTypes: true }) => unknown[];
};

jest.mock("node:fs", () => {
  const actual = jest.requireActual<RealFileSystem>("node:fs");

  /** The fake tree's key for a path, or null for a path it does not own. */
  const keyOf = (directory: string): string | null => {
    const marker = directory.lastIndexOf("/../app");
    if (marker === -1) return null;
    return directory.slice(marker + "/../app".length).replace(/^\//, "");
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
          `ENOENT: no such directory in this test's route tree: ${directory}`,
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

/** Stands the fake app/ up: "" is the route directory itself. */
function givenAppDirectory(entries: Record<string, string[]>): void {
  mockDirectories.entries = entries;
}

beforeEach(() => {
  mockDirectories.entries = {};
  mockReadPaths.length = 0;
});

describe("stack screen discovery", () => {
  it("reads the app's own route directory", () => {
    // The fake tree below only stands in for app/ while the discovery still
    // reads that directory; pointed anywhere else it would describe a
    // directory the app does not ship its screens from.
    givenAppDirectory({ "": ["setup.tsx"] });

    stackScreens();

    expect(mockReadPaths.map((path) => path.endsWith(APP_DIRECTORY))).toEqual([
      true,
    ]);
  });

  it("reports a screen written as a file", () => {
    givenAppDirectory({ "": ["_layout.tsx", "setup.tsx", "new-room.tsx"] });

    expect(stackScreens()).toEqual(["new-room", "setup"]);
  });

  it("reports a screen inside a folder, under the path it is loaded from", () => {
    givenAppDirectory({
      "": ["setup.tsx", "room/"],
      room: ["[roomId].tsx"],
    });

    expect(stackScreens()).toEqual(["room/[roomId]", "setup"]);
  });

  it("keeps a group in the path, since that is where the screen lives", () => {
    // A group adds no segment to the URL, but app/(auth)/sign-in.tsx is still
    // loaded from that folder, and the clearance check requires it by path.
    givenAppDirectory({
      "": ["setup.tsx", "(auth)/"],
      "(auth)": ["_layout.tsx", "sign-in.tsx", "sign-up.tsx"],
    });

    expect(stackScreens()).toEqual([
      "(auth)/sign-in",
      "(auth)/sign-up",
      "setup",
    ]);
  });

  it("reports a folder's index route as the folder's own path", () => {
    // expo-router opens app/room/index.tsx at /room, the same as app/room.tsx.
    givenAppDirectory({
      "": ["room/"],
      room: ["index.tsx", "[roomId].tsx"],
    });

    expect(stackScreens()).toEqual(["room", "room/[roomId]"]);
  });

  it("reports the routes of a folder nested inside another", () => {
    givenAppDirectory({
      "": ["room/"],
      room: ["[roomId].tsx", "settings/"],
      "room/settings": ["index.tsx", "members.tsx"],
    });

    expect(stackScreens()).toEqual([
      "room/[roomId]",
      "room/settings",
      "room/settings/members",
    ]);
  });

  it("reports a screen once however many platform variants it has", () => {
    givenAppDirectory({
      "": ["setup.tsx", "setup.android.tsx", "setup.web.tsx"],
    });

    expect(stackScreens()).toEqual(["setup"]);
  });

  it("skips the tab group, which has a clearance check of its own", () => {
    // The tab bar covers those screens' bottom edge rather than the home
    // indicator; test-support/tabScreens.ts reads that directory instead.
    givenAppDirectory({
      "": ["setup.tsx", "(tabs)/"],
      "(tabs)": ["index.tsx", "profile.tsx"],
    });

    expect(stackScreens()).toEqual(["setup"]);
  });

  it("skips the layout, the router's own files and dotfiles", () => {
    givenAppDirectory({
      "": [
        "_layout.tsx",
        "+html.tsx",
        "+native-intent.ts",
        ".setup.tsx.swp~",
        ".new-room.tsx",
        "README.md",
        "setup.tsx",
      ],
    });

    expect(stackScreens()).toEqual(["setup"]);
  });

  it("reports the catch-all, which is a screen the app draws", () => {
    // The router pushes app/+not-found.tsx for an address that matches
    // nothing, so it reaches the window's bottom edge like any other screen.
    givenAppDirectory({ "": ["_layout.tsx", "+not-found.tsx", "setup.tsx"] });

    expect(stackScreens()).toEqual(["+not-found", "setup"]);
  });

  it("skips those names written as folders too", () => {
    givenAppDirectory({
      "": ["setup.tsx", "_layout/", "+native-intent/", ".trash/"],
      _layout: ["index.tsx"],
      "+native-intent": ["index.tsx"],
      ".trash": ["index.tsx"],
    });

    expect(stackScreens()).toEqual(["setup"]);
  });

  it("skips those names inside a folder as well", () => {
    givenAppDirectory({
      "": ["room/"],
      room: ["_layout.tsx", "+html.tsx", ".[roomId].tsx~", "[roomId].tsx"],
    });

    expect(stackScreens()).toEqual(["room/[roomId]"]);
  });

  it("reports a catch-all inside a folder under that folder's path", () => {
    givenAppDirectory({
      "": ["room/"],
      room: ["+not-found.tsx", "[roomId].tsx"],
    });

    expect(stackScreens()).toEqual(["room/+not-found", "room/[roomId]"]);
  });

  it("sorts the screens it finds, whatever order the directories list them in", () => {
    givenAppDirectory({
      "": ["setup.tsx", "room/", "admin-rooms.tsx"],
      room: ["[roomId].tsx"],
    });

    expect(stackScreens()).toEqual([
      "admin-rooms",
      "room/[roomId]",
      "setup",
    ]);
  });
});

describe("root stack route discovery", () => {
  it("reads the app's own route directory", () => {
    givenAppDirectory({ "": ["setup.tsx"] });

    rootStackRoutes();

    expect(mockReadPaths.map((path) => path.endsWith(APP_DIRECTORY))).toEqual([
      true,
    ]);
  });

  it("names a screen written as a file by its route", () => {
    givenAppDirectory({ "": ["_layout.tsx", "setup.tsx", "new-room.tsx"] });

    expect(rootStackRoutes()).toEqual(["new-room", "setup"]);
  });

  it("names a screen inside a plain folder by the path below app/", () => {
    // Without a layout of its own the folder is no navigator: the router
    // hoists its routes up to the root stack, which knows each of them by the
    // path it sits at.
    givenAppDirectory({
      "": ["setup.tsx", "room/"],
      room: ["[roomId].tsx"],
    });

    expect(rootStackRoutes()).toEqual(["room/[roomId]", "setup"]);
  });

  it("keeps index in the name of a hoisted screen", () => {
    // React Navigation knows app/room/index.tsx as `room/index`, so that is
    // what a <Stack.Screen> has to be named to configure it — unlike the
    // `room` the clearance check loads that screen from.
    givenAppDirectory({
      "": ["room/"],
      room: ["index.tsx", "[roomId].tsx"],
    });

    expect(rootStackRoutes()).toEqual(["room/[roomId]", "room/index"]);
  });

  it("names a folder with a layout of its own once, whatever it holds", () => {
    // app/(auth)/ is a navigator, so the root stack holds one child for the
    // whole of it rather than one per screen inside.
    givenAppDirectory({
      "": ["setup.tsx", "(auth)/"],
      "(auth)": ["_layout.tsx", "sign-in.tsx", "sign-up.tsx"],
    });

    expect(rootStackRoutes()).toEqual(["(auth)", "setup"]);
  });

  it("names the tab group, which the root stack holds like any other child", () => {
    // The clearance check skips this group, since the tab bar rather than the
    // home indicator covers those screens; the layout still has to name it.
    givenAppDirectory({
      "": ["setup.tsx", "(tabs)/"],
      "(tabs)": ["_layout.tsx", "index.tsx", "profile.tsx"],
    });

    expect(rootStackRoutes()).toEqual(["(tabs)", "setup"]);
  });

  it("names a nested folder's layout by the path it sits at", () => {
    givenAppDirectory({
      "": ["room/"],
      room: ["[roomId].tsx", "settings/"],
      "room/settings": ["_layout.tsx", "index.tsx", "members.tsx"],
    });

    expect(rootStackRoutes()).toEqual(["room/[roomId]", "room/settings"]);
  });

  it("hoists the routes of a group that has no layout of its own", () => {
    // A group adds no segment to the URL, but the route is still loaded from
    // that folder, and the name the root stack knows it by keeps the folder.
    givenAppDirectory({
      "": ["setup.tsx", "(legal)/"],
      "(legal)": ["privacy.tsx", "terms.tsx"],
    });

    expect(rootStackRoutes()).toEqual([
      "(legal)/privacy",
      "(legal)/terms",
      "setup",
    ]);
  });

  it("names a screen once however many platform variants it has", () => {
    givenAppDirectory({
      "": ["setup.tsx", "setup.android.tsx", "setup.web.tsx"],
    });

    expect(rootStackRoutes()).toEqual(["setup"]);
  });

  it("skips the layout, the router's own files and dotfiles", () => {
    // The root layout configures the stack rather than being a screen in it,
    // and +html and +native-intent are files the router reads for itself
    // rather than screens it ever pushes.
    givenAppDirectory({
      "": [
        "_layout.tsx",
        "+html.tsx",
        "+native-intent.ts",
        ".setup.tsx.swp~",
        ".new-room.tsx",
        "README.md",
        "setup.tsx",
      ],
    });

    expect(rootStackRoutes()).toEqual(["setup"]);
  });

  it("names the catch-all, which the stack holds like any other child", () => {
    // The router pushes app/+not-found.tsx for an address that matches
    // nothing, and the layout has to name it to configure how it opens.
    givenAppDirectory({ "": ["_layout.tsx", "+not-found.tsx", "setup.tsx"] });

    expect(rootStackRoutes()).toEqual(["+not-found", "setup"]);
  });

  it("skips those names written as folders too", () => {
    givenAppDirectory({
      "": ["setup.tsx", "_layout/", "+native-intent/", ".trash/"],
      _layout: ["index.tsx"],
      "+native-intent": ["index.tsx"],
      ".trash": ["index.tsx"],
    });

    expect(rootStackRoutes()).toEqual(["setup"]);
  });

  it("skips those names inside a folder as well", () => {
    givenAppDirectory({
      "": ["room/"],
      room: ["+html.tsx", ".[roomId].tsx~", "[roomId].tsx"],
    });

    expect(rootStackRoutes()).toEqual(["room/[roomId]"]);
  });

  it("names a catch-all inside a folder by the path it sits at", () => {
    givenAppDirectory({
      "": ["room/"],
      room: ["+not-found.tsx", "[roomId].tsx"],
    });

    expect(rootStackRoutes()).toEqual(["room/+not-found", "room/[roomId]"]);
  });

  it("sorts the names it finds, whatever order the directories list them in", () => {
    givenAppDirectory({
      "": ["setup.tsx", "room/", "admin-rooms.tsx"],
      room: ["[roomId].tsx"],
    });

    expect(rootStackRoutes()).toEqual([
      "admin-rooms",
      "room/[roomId]",
      "setup",
    ]);
  });
});
