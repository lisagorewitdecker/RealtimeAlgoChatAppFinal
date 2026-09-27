/**
 * What expo-router makes of a filename, shared by the discoveries in this
 * directory.
 *
 * test-support/tabScreens.ts reads app/(tabs)/ for the checks that guard the
 * tab bar, and test-support/stackScreens.ts reads the rest of app/ for the
 * check that guards the window's bottom edge. Both have to answer the same
 * three questions about a directory entry first — is it a route file, which
 * route is it, and is it a name the router keeps for itself — and the router
 * answers them the same way wherever the file sits, so they are answered once
 * here rather than twice.
 */

// Jest runs these files as CommonJS. The app has no @types/node, so the one
// Node API these modules need is declared here instead of pulling in a whole
// type package for a single directory read.
export type DirectoryEntry = {
  name: string;
  isFile: () => boolean;
  isDirectory: () => boolean;
};

type FileSystem = {
  readdirSync: (
    path: string,
    options: { withFileTypes: true },
  ) => DirectoryEntry[];
};

const fs: FileSystem = require("node:fs");

/** The file extensions expo-router accepts as routes. */
const ROUTE_EXTENSION = /\.[jt]sx?$/;

/** Variants of a single route; the bundler picks one per platform. */
const PLATFORM_VARIANT = /\.(?:android|ios|native|web)$/;

/**
 * The route a source file becomes, with its extension and any platform suffix
 * removed, or null when it is not a route file at all.
 */
export function routeOfFile(fileName: string): string | null {
  if (!ROUTE_EXTENSION.test(fileName)) return null;

  return fileName.replace(ROUTE_EXTENSION, "").replace(PLATFORM_VARIANT, "");
}

/**
 * Whether a route name is one the app ships, wherever below app/ it sits.
 *
 * `_layout` configures a navigator instead of being a screen, `+`-prefixed
 * names are the router's own entry points rather than screens, and dotfiles
 * are editor leftovers rather than shipped source.
 *
 * `+not-found` is the exception the router makes to its own `+` rule: it
 * ships that file as a real screen. Leaving it out here keeps this answer the
 * one both reads share, and test-support/stackScreens.ts takes it back for
 * the stack, where it is a screen the app draws and a child the root stack
 * holds.
 */
export function isShippedRoute(route: string): boolean {
  return (
    route !== "_layout" && !route.startsWith("+") && !route.startsWith(".")
  );
}

/** The entries of a route directory, named by its absolute path. */
export function entriesOfDirectory(directory: string): DirectoryEntry[] {
  return fs.readdirSync(directory, { withFileTypes: true });
}
