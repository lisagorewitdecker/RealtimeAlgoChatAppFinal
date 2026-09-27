import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { webHomeBarInset } from "@/lib/webHomeBar";

/**
 * Which bottom inset a surface has to stay clear of.
 *
 * Every screen takes the default, so the same control keeps the same room from
 * the home bar whichever screen it sits on, in the browser as much as on a
 * device. The other two sources are for the surfaces that are not a screen:
 *
 * - `"device-or-web"`: the reported inset on native, and the room the browser
 *   keeps for its home bar in the web build (see `lib/webHomeBar.ts`), where
 *   the browser reports nothing for that bar.
 * - `"device"`: only the inset the platform reports, for the app-wide footer
 *   (`components/AppFooter.tsx`), which owns that inset on behalf of the whole
 *   app and leaves web layout as the browser lays it out.
 * - `"web"`: the browser's home bar only, for a surface nested inside a host
 *   that already reserves the native inset, so the inset is not counted twice.
 */
export type BottomInsetSource = "device-or-web" | "device" | "web";

export interface BottomClearanceOptions {
  /** Which bottom inset the surface reserves room for. */
  source?: BottomInsetSource;
  /** Smallest bottom room to keep when the inset is smaller than this. */
  minimum?: number;
  /** Visual gap to leave between the content and the reserved room. */
  gap?: number;
}

/**
 * Bottom room a stack (non-tab) screen must reserve so its last control stays
 * clear of the home indicator.
 *
 * Stack screens sit below the tab navigator, so they have no tab bar to clear
 * (see `useTabBarClearance` for that) but still end at the bottom edge of the
 * window, where the home indicator floats over whatever the screen draws last.
 * Every screen therefore needs the same three numbers — the inset it honours,
 * the smallest room it keeps without one, and the gap it leaves on top — and
 * keeping them here stops the next screen from re-deriving them by hand.
 *
 * No screen opts out of the web home bar: the browser reports no bottom inset,
 * so a screen that skipped the room `lib/webHomeBar.ts` reports would leave
 * its last control closer to the home bar than the same control one screen
 * over. Nor does any screen decide for itself whether there is a bar to clear.
 * That answer comes from the same module as the room does — a browser floats
 * one over a handheld screen and none over a desktop one — so a window either
 * keeps the room on every screen or keeps it on none, rather than reserving a
 * strip of empty space on one screen and not the next.
 *
 * @returns The reserved inset, raised to `minimum`, plus `gap`.
 */
export function useBottomClearance({
  source = "device-or-web",
  minimum = 0,
  gap = 0,
}: BottomClearanceOptions = {}): number {
  const insets = useSafeAreaInsets();
  const reportedInset = source === "web" ? 0 : insets.bottom;
  const inset =
    Platform.OS === "web" && source !== "device"
      ? webHomeBarInset()
      : reportedInset;

  return Math.max(inset, minimum) + gap;
}
