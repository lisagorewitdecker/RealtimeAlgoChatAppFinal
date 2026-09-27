/**
 * The tabs the app ships, read from the router's own source of truth.
 *
 * expo-router turns every route in app/(tabs)/ into a tab whether or not
 * app/(tabs)/_layout.tsx names it, so a tab added without a matching
 * `<Tabs.Screen>` and `<NativeTabs.Trigger>` still ships — with no icon and its
 * raw route name as its label. A route is a file, `app/(tabs)/profile.tsx`, or
 * a directory holding an index route, `app/(tabs)/profile/index.tsx`; the two
 * ship the same tab, so this module finds both. Every check that guards the tab
 * bar therefore reads that directory instead of listing the tabs by hand:
 * __tests__/TabLayout.test.tsx and __tests__/AndroidTabBar.test.android.tsx
 * assert each tab found by `registeredTabScreens` is registered in both
 * branches of the layout, and __tests__/TabBarClearance.test.tsx renders every
 * screen found by `screensUnderTabBar` to measure the room it reserves for the
 * bar.
 *
 * The two lists differ because a directory holds more than the tab it ships.
 * expo-router makes a route out of every source file below app/(tabs)/, so
 * `app/(tabs)/profile/details.tsx` is not a tab of its own, but the router
 * pushes it inside the Profile tab and the classic bar keeps floating over it:
 * the bar covers it exactly the way it covers the tab. `screensUnderTabBar`
 * therefore reports every route file below app/(tabs)/, while
 * `registeredTabScreens` reports only what reaches the bar as a tab.
 *
 * __tests__/TabScreenDiscovery.test.ts covers this module itself, because the
 * app ships no folder-based tab today: without it the directory half of the
 * read would be unexercised, and could stop working while every suite above
 * stayed green.
 *
 * What the router makes of a filename — which files are routes, and which
 * names it keeps for itself — lives in test-support/routeFiles.ts, because
 * test-support/stackScreens.ts reads the rest of app/ by the same rules.
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

/** The directory expo-router builds the app's tabs from. */
const TAB_SCREEN_DIRECTORY = `${__dirname}/../app/(tabs)`;

/**
 * The entries of a directory below app/(tabs)/, named by its route path;
 * `""` is app/(tabs)/ itself.
 */
function entriesOf(routePath: string): DirectoryEntry[] {
  return entriesOfDirectory(
    routePath === ""
      ? TAB_SCREEN_DIRECTORY
      : `${TAB_SCREEN_DIRECTORY}/${routePath}`,
  );
}

/**
 * Whether a directory reaches the tab bar as a tab of its own: it does when it
 * holds an index route, `index.tsx` or any of its platform variants, since
 * that is the screen the router opens when the tab is selected.
 *
 * This says nothing about whether the directory holds routes — the router
 * makes one out of every source file in it either way.
 */
function holdsIndexRoute(entries: DirectoryEntry[]): boolean {
  return entries.some(
    (entry) => entry.isFile() && routeOfFile(entry.name) === "index",
  );
}

/**
 * Every route below a directory in app/(tabs)/, as paths below app/(tabs)/:
 * `settings` for app/(tabs)/settings/index.tsx, `settings/details` for
 * app/(tabs)/settings/details.tsx.
 *
 * expo-router makes a route out of every source file it finds, so a directory
 * holds routes whether or not it holds an index route: without one the
 * directory's own path opens nothing, but the files in it are still routes the
 * router ships. Each is pushed inside the tab the directory belongs to, and
 * React Navigation keeps the tab bar on screen while one is open, so the
 * classic bar floats over them the way it floats over the tab itself.
 */
function routesUnder(routePath: string, entries: DirectoryEntry[]): string[] {
  const routes: string[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      const route = routeOfFile(entry.name);
      if (route === null || !isShippedRoute(route)) continue;

      // An index route is the directory's own path rather than a route below
      // it, which is also why a directory without one is no route itself.
      routes.push(route === "index" ? routePath : `${routePath}/${route}`);
      continue;
    }

    if (!entry.isDirectory() || !isShippedRoute(entry.name)) continue;

    const nestedPath = `${routePath}/${entry.name}`;
    routes.push(...routesUnder(nestedPath, entriesOf(nestedPath)));
  }

  return routes;
}

/**
 * app/(tabs)/ read once: the tabs the bar shows, and every screen it floats
 * over.
 *
 * Both shapes expo-router accepts as a tab are read, because both ship the
 * same tab: a file, `app/(tabs)/profile.tsx`, and a directory holding an index
 * route, `app/(tabs)/profile/index.tsx`. A directory is named by the tab it
 * ships, so its own name is the route either way. The screens go further: a
 * directory's other files are routes too, and a directory that ships no tab of
 * its own still holds routes the navigator shows the bar over.
 */
function readTabDirectory(): { tabs: string[]; screens: string[] } {
  const tabs = new Set<string>();
  const screens = new Set<string>();

  for (const entry of entriesOf("")) {
    if (entry.isFile()) {
      const route = routeOfFile(entry.name);
      if (route === null || !isShippedRoute(route)) continue;

      tabs.add(route);
      screens.add(route);
      continue;
    }

    if (!entry.isDirectory() || !isShippedRoute(entry.name)) continue;

    const entries = entriesOf(entry.name);
    if (holdsIndexRoute(entries)) tabs.add(entry.name);

    for (const route of routesUnder(entry.name, entries)) screens.add(route);
  }

  return { tabs: [...tabs].sort(), screens: [...screens].sort() };
}

/**
 * Every tab screen the app registers, read from the router's own source of
 * truth: a route in app/(tabs)/ becomes a tab whether or not _layout.tsx also
 * names it.
 */
export function registeredTabScreens(): string[] {
  return readTabDirectory().tabs;
}

/**
 * Every screen the classic tab bar floats over, as the path it lives at below
 * app/(tabs)/: each tab, `settings`, and each route a directory there holds,
 * `settings/details`.
 *
 * The bar is absolutely positioned and React Navigation keeps it on screen
 * while a route pushed inside a tab is open, so a route below a tab directory
 * has to reserve the same room for it as the tab's own screen.
 */
export function screensUnderTabBar(): string[] {
  return readTabDirectory().screens;
}

/**
 * The tabs the app shipped when these checks were written, in the order the
 * tab bar shows them — an order the directory cannot express, since it is a
 * product decision rather than a filename.
 *
 * A check that derives its expectations from the directory passes vacuously if
 * the read ever finds nothing, which is the silent pass this discovery exists
 * to prevent, so each one compares the discovery against this floor. It is not
 * the list of tabs under test.
 */
export const TABS_ALREADY_SHIPPED = ["index", "profile"];
