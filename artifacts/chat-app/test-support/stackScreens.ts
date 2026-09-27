/**
 * app/ read for the checks that guard the root stack: the screens it pushes,
 * and the names it knows them by.
 *
 * expo-router makes a route out of every source file below app/, so a screen
 * added there ships whether or not app/_layout.tsx names it in its `<Stack>`.
 * Two checks are driven by that read, and each needs a different list out of
 * it.
 *
 * `stackScreens` reports the screens to render. Each of them ends at the
 * bottom edge of the window, where the home indicator floats over whatever it
 * draws last, so __tests__/BottomClearance.test.tsx renders every route this
 * module finds instead of importing the screens by hand: a stack route added
 * later is measured without anyone remembering to come back to that file, and
 * one that reserves no bottom room fails under its own path.
 *
 * `rootStackRoutes` reports the names the root stack knows its children by,
 * which is what a `<Stack.Screen>` has to be named to configure one.
 * __tests__/StackLayout.test.tsx compares them against the screens the layout
 * registers, so a route the layout never names — which the router ships
 * anyway, opening with the stack's default behaviour instead of the one it was
 * meant to have — fails under its own path.
 *
 * The two lists differ because a name is not a file. React Navigation names a
 * screen by its path relative to the nearest _layout, so app/(auth)/, which
 * holds one of its own, is a single child of the root stack while holding
 * three screens to render, and app/(tabs)/ is a child of the root stack too
 * even though the tab bar, not the home indicator, covers its screens' bottom
 * edge: `stackScreens` therefore leaves that group out, and
 * __tests__/TabBarClearance.test.tsx measures those screens instead — from
 * test-support/tabScreens.ts, which reads that directory the same way this
 * module reads the rest of app/.
 *
 * Both lists hold the catch-all, app/+not-found.tsx. The router pushes it in
 * place of an address that matches nothing, so it is a screen the app draws
 * and a child the root stack holds like any other, whatever its name looks
 * like.
 *
 * __tests__/StackScreenDiscovery.test.ts covers this module itself, because
 * app/ holds only some of the shapes expo-router ships: without it the route
 * shapes the app has no example of today would be unexercised, and could stop
 * working while the checks above stayed green over a shrinking list.
 */

import {
  type DirectoryEntry,
  entriesOfDirectory,
  isShippedRoute,
  routeOfFile,
} from "./routeFiles";

// Jest runs these files as CommonJS; see test-support/routeFiles.ts for why
// the Node types are hand-declared.
declare const __dirname: string;

/** The directory expo-router builds the app's routes from. */
const APP_DIRECTORY = `${__dirname}/../app`;

/**
 * The catch-all: the one `+` name that is a screen of the app's own rather
 * than a file the router reads for itself.
 *
 * expo-router ships app/+not-found.tsx as a route and pushes it whenever an
 * address matches no other one, so it is a screen the app draws and a child
 * the root stack holds, while +html and +native-intent are files the router
 * reads and never pushes. test-support/routeFiles.ts leaves every `+` name
 * out, that being the rule both directory reads share; this is the stack's
 * own exception to it.
 */
const CATCH_ALL_ROUTE = "+not-found";

/** Whether a route file below app/ is a screen rather than the router's own. */
function isStackRoute(route: string): boolean {
  return route === CATCH_ALL_ROUTE || isShippedRoute(route);
}

/**
 * The tab group, which is a navigator of its own rather than a stack route;
 * see the note above for the check that measures what is inside it.
 */
const TAB_GROUP = "(tabs)";

/** A route path below app/: `""` is app/ itself. */
function pathOf(routePath: string, name: string): string {
  return routePath === "" ? name : `${routePath}/${name}`;
}

/** The entries of a directory below app/, named by its route path. */
function entriesOf(routePath: string): DirectoryEntry[] {
  return entriesOfDirectory(
    routePath === "" ? APP_DIRECTORY : `${APP_DIRECTORY}/${routePath}`,
  );
}

/**
 * Every route below a directory in app/, as paths below app/: `setup` for
 * app/setup.tsx, `room/[roomId]` for app/room/[roomId].tsx, `(auth)/sign-in`
 * for app/(auth)/sign-in.tsx.
 *
 * A group directory, `(auth)`, adds no segment to the URL but is still part of
 * the path a screen is loaded from, so it is kept here: these paths are how
 * the check requires each screen.
 *
 * expo-router makes a route out of every source file it finds, so a directory
 * holds routes whether or not it holds an index route: without one the
 * directory's own path opens nothing, but the files in it are still routes the
 * router ships.
 */
function routesUnder(routePath: string, entries: DirectoryEntry[]): string[] {
  const routes: string[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      const route = routeOfFile(entry.name);
      if (route === null || !isStackRoute(route)) continue;

      // An index route is the directory's own path rather than a route below
      // it, which is also why a directory without one is no route itself.
      routes.push(
        route === "index" && routePath !== ""
          ? routePath
          : pathOf(routePath, route),
      );
      continue;
    }

    if (!entry.isDirectory() || !isShippedRoute(entry.name)) continue;
    if (routePath === "" && entry.name === TAB_GROUP) continue;

    const nestedPath = pathOf(routePath, entry.name);
    routes.push(...routesUnder(nestedPath, entriesOf(nestedPath)));
  }

  return routes;
}

/**
 * Every stack screen the app ships, as the path it is loaded from below app/.
 *
 * Platform variants of one route — `setup.tsx` and `setup.android.tsx` — are
 * the same screen and are reported once.
 */
export function stackScreens(): string[] {
  return [...new Set(routesUnder("", entriesOf("")))].sort();
}

/**
 * Whether a directory is a navigator of its own rather than a folder the
 * router hoists routes out of: it is one when it holds a layout route.
 *
 * expo-router names a screen by its path relative to the nearest _layout, so
 * a directory holding one reaches the root stack as a single screen — its own
 * path — however many routes are inside it, while the routes of a directory
 * without one are children of the root stack themselves.
 */
function holdsLayoutRoute(entries: DirectoryEntry[]): boolean {
  return entries.some(
    (entry) => entry.isFile() && routeOfFile(entry.name) === "_layout",
  );
}

/**
 * Every child the root stack has below a directory in app/, named the way a
 * `<Stack.Screen name>` has to name it: `setup` for app/setup.tsx,
 * `room/[roomId]` for app/room/[roomId].tsx, `(auth)` for the whole of
 * app/(auth)/, which has a layout of its own.
 *
 * The tab group is one of these names. It is a navigator rather than a screen
 * the app draws, but the root stack still holds it as a child, and
 * app/_layout.tsx still has to name it to configure how it opens.
 *
 * `index` stays part of a name here: the root stack would know
 * app/room/index.tsx as `room/index`, while `routesUnder` above reports
 * `room`, the path that screen is loaded from. That is the one place the two
 * reads disagree about a route they both find.
 */
function routeNamesUnder(
  routePath: string,
  entries: DirectoryEntry[],
): string[] {
  const names: string[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      const route = routeOfFile(entry.name);
      if (route === null || !isStackRoute(route)) continue;

      names.push(pathOf(routePath, route));
      continue;
    }

    if (!entry.isDirectory() || !isShippedRoute(entry.name)) continue;

    const nestedPath = pathOf(routePath, entry.name);
    const nestedEntries = entriesOf(nestedPath);

    // A navigator of its own is one child of this stack; anything else is a
    // folder whose routes the router hoists up to the nearest layout, which
    // for these is the root one.
    if (holdsLayoutRoute(nestedEntries)) {
      names.push(nestedPath);
      continue;
    }

    names.push(...routeNamesUnder(nestedPath, nestedEntries));
  }

  return names;
}

/**
 * Every screen the root stack ships, named the way app/_layout.tsx has to
 * name it to configure one.
 *
 * Platform variants of one route — `setup.tsx` and `setup.android.tsx` — are
 * the same screen and are reported once.
 */
export function rootStackRoutes(): string[] {
  return [...new Set(routeNamesUnder("", entriesOf("")))].sort();
}

/**
 * The stack screens the app shipped when this check was written.
 *
 * A check that derives its expectations from the directory passes vacuously if
 * the read ever finds nothing, which is the silent pass this discovery exists
 * to prevent, so the clearance check compares the discovery against this
 * floor. It is not the list of screens under test: a screen added later is
 * measured without being added here.
 */
export const STACK_SCREENS_ALREADY_SHIPPED = [
  "(auth)/forgot-password",
  "(auth)/sign-in",
  "(auth)/sign-up",
  "+not-found",
  "admin-rooms",
  "call/[roomId]",
  "new-room",
  "room/[roomId]",
  "sandbox/[roomId]",
  "setup",
];

/**
 * The children the root stack had when this check was written — the same
 * floor as above, for the other read: `(auth)` and `(tabs)` stand for whole
 * navigators here rather than for the screens inside them.
 */
export const ROOT_STACK_ROUTES_ALREADY_SHIPPED = [
  "(auth)",
  "(tabs)",
  "+not-found",
  "admin-rooms",
  "call/[roomId]",
  "new-room",
  "room/[roomId]",
  "sandbox/[roomId]",
  "setup",
];
