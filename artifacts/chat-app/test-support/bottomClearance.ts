/**
 * The surfaces the bottom-clearance checks measure, and how each of them
 * reads the room a rendered surface reserves.
 *
 * __tests__/BottomClearance.test.tsx renders these screens the way a phone
 * builds them, and fails when one stops reserving the room the home indicator
 * covers. __tests__/BottomClearance.test.web.tsx renders the same screens the
 * way a browser builds them, and fails when one reserves that room in a
 * desktop browser, where nothing floats over the page and the room is a strip
 * of empty space below the last control instead.
 *
 * The two runs ask different questions of different builds, so each keeps its
 * own stand-ins and its own reports. What they cannot keep apart is which
 * screens they ask: a screen measured by one and left out of the other is a
 * screen nobody holds to both answers, and a browser keeping room a phone
 * needs — or losing room a phone needs — is exactly what would follow. So the
 * list, the exclusions from it, and the reading of a rendered tree live here,
 * once.
 */

import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import type { ComponentType } from "react";
import type { render } from "@testing-library/react-native";

import { stackScreens } from "./stackScreens";

/**
 * Stack routes these checks do not render, and why.
 *
 * A route belongs here only when the app itself draws nothing at the window's
 * bottom edge on it. Anything else — a screen whose last control is the app's
 * own — is measured by both runs, whether or not anyone remembers it.
 */
export const SCREENS_WITHOUT_A_BOTTOM_CONTROL: Record<string, string> = {
  "+not-found":
    "the screen the router pushes for an address that matches nothing " +
    "centres its message and its one link in the window, so the app draws " +
    "nothing down at the bottom edge for the home bar to float over",
  "call/[roomId]":
    "everything below the app's top bar is the call document the API server " +
    "serves, drawn by a WebView on a device and an iframe in the browser, so " +
    "the app has no control of its own down there to keep clear; the call " +
    "controls are the document's own and it pads them by the device's bottom " +
    "inset, which api-server/src/routes/rooms.bottomClearance.test.ts " +
    "measures. The screen's one part in that is handing the document the " +
    "inset it measured, since an Android WebView reports none of its own and " +
    "a browser tells a page in an iframe nothing at all, which " +
    "__tests__/HostedDocumentInset.test.tsx and its .test.web.tsx half " +
    "measure",
  "sandbox/[roomId]":
    "the editor below the app's top bar is a document the API server serves " +
    "in the same way, and it lays out its own bottom edge — the editors and " +
    "the assistant's buttons are padded by the device's bottom inset there, " +
    "measured by the same two checks",
};

/** Every stack screen both runs render, as the path it is loaded from. */
export function measuredStackScreens(): string[] {
  return stackScreens().filter(
    (route) => !(route in SCREENS_WITHOUT_A_BOTTOM_CONTROL),
  );
}

/**
 * The routes excused above that the app no longer ships.
 *
 * A screen that was deleted or renamed would otherwise keep its excuse, and
 * the route that replaced it would inherit the exclusion unmeasured.
 */
export function staleExclusions(): string[] {
  const shipped = stackScreens();

  return Object.keys(SCREENS_WITHOUT_A_BOTTOM_CONTROL).filter(
    (route) => !shipped.includes(route),
  );
}

type ScreenModule = { default?: unknown };

/** Loads a screen by its route path, the way the router loads it. */
export function loadStackScreen(route: string): ComponentType {
  const screenModule = require(`../app/${route}`) as ScreenModule;
  const Screen = screenModule.default;

  if (
    Screen === null ||
    (typeof Screen !== "function" && typeof Screen !== "object")
  ) {
    throw new Error(
      `app/${route} default-exports ${String(Screen)} instead of a screen ` +
        "component, so this check cannot render it",
    );
  }

  return Screen as ComponentType;
}

/** The bottom padding a style reserves, which has to be a number to read. */
export function bottomPaddingOf(style: StyleProp<ViewStyle>): number {
  const paddingBottom = StyleSheet.flatten(style)?.paddingBottom;
  if (typeof paddingBottom !== "number") {
    throw new Error(
      `Expected a numeric paddingBottom, received ${String(paddingBottom)}`,
    );
  }
  return paddingBottom;
}

type RenderResult = ReturnType<typeof render>;
type TestElement = ReturnType<RenderResult["UNSAFE_getByType"]>;

/**
 * The bottom room a style reserves, or null when it reserves none.
 *
 * React Native resolves the shorthands in the same order, so a screen that
 * reserves its room as `padding` or `paddingVertical` is read here the way the
 * layout reads it rather than counted as reserving nothing.
 */
export function bottomRoomOf(style: StyleProp<ViewStyle>): number | null {
  const flattened = StyleSheet.flatten(style);
  if (!flattened) return null;

  for (const room of [
    flattened.paddingBottom,
    flattened.paddingVertical,
    flattened.padding,
  ]) {
    if (typeof room === "number") return room;
  }

  return null;
}

/**
 * Every bottom room a rendered screen reserves.
 *
 * The screens put it in different places — a scroll view's content, a list's
 * content, the view a composer sits in, the view a status message sits in — so
 * the whole tree is read rather than naming the element screen by screen.
 *
 * The rooms are read off the app's own elements, which carry the numbers the
 * screens asked for on either build: the browser build draws each of them as
 * a DOM element underneath, whose padding react-native-web has already
 * rewritten as `34px`, and a string is no room to this read.
 */
export function reservedBottomRoom(view: RenderResult): number[] {
  const rooms: number[] = [];

  const visit = (node: TestElement): void => {
    for (const style of [node.props.style, node.props.contentContainerStyle]) {
      const room = bottomRoomOf(style as StyleProp<ViewStyle>);
      if (room !== null) rooms.push(room);
    }

    for (const child of node.children) {
      if (typeof child !== "string") visit(child);
    }
  };

  visit(view.UNSAFE_root);
  return rooms;
}
