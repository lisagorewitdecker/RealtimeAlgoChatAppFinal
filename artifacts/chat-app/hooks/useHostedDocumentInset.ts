import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { webHomeBarInset } from "@/lib/webHomeBar";

/**
 * The bottom inset a screen hands to the document it hosts.
 *
 * The call and sandbox screens draw a document the API server serves — a
 * WebView on a device, an iframe in the browser — and a hosted document owns
 * its own bottom edge: padding added around the host shrinks the hosted
 * viewport rather than lifting the controls inside it. So the document keeps
 * its last control clear of the bar at the foot of the window itself, from
 * the larger of what it can see and what its host hands over (see
 * `@workspace/hosted-document-inset`). This is the host's half of that, and
 * every platform needs it for a different reason:
 *
 * - An iOS WebView reports the home indicator to the document, so the number
 *   here only confirms what it already sees.
 * - An Android WebView reports nothing for its gesture navigation strip,
 *   where the platform's inset is the document's only source.
 * - A browser tells a page in an iframe nothing about the window's insets,
 *   whatever the phone underneath reports, so in the web build the room comes
 *   from `lib/webHomeBar.ts` — the same room every other screen keeps for the
 *   home bar there, and nothing at all in a desktop browser, which floats no
 *   such bar and would be left with dead space at the foot of an editor.
 *
 * @returns The inset in density-independent pixels, which a document scaled
 *   to the device's width reads as CSS pixels.
 */
export function useHostedDocumentInset(): number {
  const insets = useSafeAreaInsets();

  if (Platform.OS !== "web") return insets.bottom;

  return webHomeBarInset();
}
