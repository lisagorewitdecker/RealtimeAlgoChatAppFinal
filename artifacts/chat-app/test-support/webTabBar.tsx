import { Feather } from "@expo/vector-icons";
import { render } from "@testing-library/react-native";
import { BlurView } from "expo-blur";
import { renderRouter } from "expo-router/testing-library";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import TabLayout from "../app/(tabs)/_layout";
import { WEB_TAB_BAR_HEIGHT } from "../hooks/useTabBarClearance";
import { EVERY_PACKAGE_REAL, mockedPackageReport } from "./moduleContract";
import { TABS_ALREADY_SHIPPED, registeredTabScreens } from "./tabScreens";

/**
 * Draws the classic tab bar the way a browser draws it, and checks that the
 * tabs reach the page: their labels, their Feather icons, the plain view that
 * fills the bar and the height the bar is given.
 *
 * The other two render checks of app/(tabs)/_layout.tsx build the bar for a
 * phone — __tests__/TabLayout.test.tsx on jest-expo's default iOS project and
 * __tests__/AndroidTabBar.test.android.tsx on the android one — and both hand
 * the layout a stand-in navigator, so they read what the layout *registers*
 * rather than what a renderer makes of it. Nothing ran the browser's own
 * build: react-native resolved to react-native-web, `.web` sources preferred,
 * a DOM underneath. That build is what the Replit preview serves and what
 * server/serve.js hands out, and it takes its own branch through the layout —
 * the plain view behind the bar and the fixed height, neither of which any
 * phone run reaches. A style the DOM renderer drops, an icon that resolves to
 * nothing through react-native-web, or a background that stopped being drawn
 * would leave both phone runs green while the browser showed an empty bar.
 *
 * So this suite mounts the app's real layout in a real router under
 * `jest-expo/web` and reads the elements that come out, in the order and shape
 * the browser receives them. The tabs are not listed by hand: expo-router
 * ships every route in app/(tabs)/ as a tab, so the render covers whatever
 * test-support/tabScreens.ts finds there — the same discovery the two phone
 * runs use — while the tabs the app has already shipped keep their names,
 * labels and icons pinned below.
 *
 * Everything the browser resolves is left real, including expo-blur (which
 * this suite asserts stays out of the bar) and expo-glass-effect (whose web
 * answer is what sends the app down the classic branch at all), and
 * PACKAGES_LEFT_REAL below holds the run to that. Two things the page has and
 * jsdom does not are stood in for by the entry point,
 * __tests__/WebTabBar.test.web.tsx: the app's theme, so the colors asserted
 * here are fixed, and the loaded state of the icon font, since a browser gets
 * the font file from the bundler and jsdom has no bundler to get it from.
 */

/**
 * The packages this suite has to be handed for real, written the way the app
 * imports them.
 *
 * __tests__/TabLayout.test.tsx mocks all four, because on a phone it reads
 * what the layout *registers* rather than what a renderer makes of it. This
 * suite exists to render what a browser makes of them, and jest.mock replaces
 * exactly the route both take — so one of those mocks copied into this suite's
 * entry point, or added to a shared setup file, would leave every check below
 * describing the stand-ins and passing. The glyph names are read out of
 * @expo/vector-icons' own map, so a stand-in's map renames whatever the bar
 * drew into whatever the check expected; the fill check only distinguishes a
 * blur from a plain view against the real expo-blur; expo-router is what
 * paints the tabs at all; and expo-glass-effect answering false is what sends
 * a browser down the classic branch this whole file measures.
 *
 * expo-font is missing on purpose. The entry point stands in for its
 * `isLoaded` because jsdom has no bundler to load the icon font, which is the
 * one replacement this render needs, so naming it here would fail every run;
 * see mockedPackageReport in ./moduleContract.
 */
const PACKAGES_LEFT_REAL = [
  "@expo/vector-icons",
  "expo-blur",
  "expo-glass-effect",
  "expo-router",
] as const;

/** Theme the entry point feeds the layout through its `useColors` mock. */
export const mockColors = {
  background: "#0E1118",
  foreground: "#F4F6FA",
  mutedForeground: "#9AA4B5",
  card: "#171B24",
  border: "#343D4C",
  primary: "#5AA5FA",
  primaryForeground: "#FFFFFF",
  radius: 12,
};

type FeatherName = keyof typeof Feather.glyphMap;

type ShippedTab = {
  /** The route's name below app/(tabs)/. */
  route: string;
  /** The address the tab opens, which is how the rendered tab names itself. */
  href: string;
  /** The label a user reads under the icon. */
  label: string;
  /** The Feather icon the classic layout draws off the phone. */
  icon: FeatherName;
};

/**
 * What the tabs the app has already shipped look like in a browser, in the
 * order the bar shows them.
 *
 * The per-tab checks below are driven by the route discovery, which passes
 * vacuously if the read ever finds nothing, so this stays as the floor — and
 * its routes are compared against the list the phone runs share.
 */
const SHIPPED_TABS: ShippedTab[] = [
  { route: "index", href: "/", label: "Chats", icon: "message-circle" },
  { route: "profile", href: "/profile", label: "Profile", icon: "user" },
];

/** The font family the icons carry once react-native-web has drawn them. */
const ICON_FONT: string = Feather.getFontFamily();

type RenderResult = ReturnType<typeof renderRouter>;
type TestElement = ReturnType<RenderResult["UNSAFE_getByProps"]>;

/** The address a tab opens: the group's index route is served at the root. */
function hrefOf(route: string): string {
  return route === "index" ? "/" : `/${route}`;
}

/** One glyph as the icon font draws it, the way @expo/vector-icons picks it. */
function glyphOf(icon: FeatherName): string {
  const glyph = Feather.glyphMap[icon];
  return typeof glyph === "number" ? String.fromCodePoint(glyph) : glyph;
}

/**
 * Every Feather name by the glyph it draws, so a wrong icon can be reported
 * under the name someone would search for. Names sharing a glyph are the same
 * drawing, so the first one is as good as any.
 */
const featherNamesByGlyph = new Map<string, string>();
for (const name of Object.keys(Feather.glyphMap) as FeatherName[]) {
  const glyph = glyphOf(name);
  if (!featherNamesByGlyph.has(glyph)) {
    featherNamesByGlyph.set(glyph, name);
  }
}

/** Every DOM element in a rendered subtree, the subtree's own root included. */
function domElements(element: TestElement): TestElement[] {
  return element.findAll((node) => typeof node.type === "string");
}

function styleOf(element: TestElement): Record<string, unknown> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

/** A length the DOM renderer writes as `84px` rather than as a number. */
function pixelsOf(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const pixels = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
    if (pixels) {
      return Number(pixels[1]);
    }
  }
  return null;
}

/**
 * A color as channels, so the theme's `#0E1118` and the `rgba(14,17,24,1.00)`
 * the DOM renderer writes compare equal without pinning either spelling.
 */
function channelsOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1];
    const pairs =
      digits.length <= 4
        ? [...digits].map((digit) => digit + digit)
        : (digits.match(/../g) ?? []);
    const [r, g, b, a = "ff"] = pairs;
    return [r, g, b, a].map((pair) => parseInt(pair, 16)).join(",");
  }

  const rgb = /^rgba?\(([^)]*)\)$/i.exec(value.trim());
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter((part) => part !== "");
    const [r, g, b, a = 1] = parts.map(Number);
    return [r, g, b, Math.round(a * 255)].join(",");
  }

  return null;
}

function sameColor(drawn: unknown, expected: string): boolean {
  const channels = channelsOf(drawn);
  return channels !== null && channels === channelsOf(expected);
}

function renderTabNavigator(): RenderResult {
  const routes: Record<string, () => React.ReactElement | null> = {
    "(tabs)/_layout": TabLayout,
  };
  for (const route of registeredTabScreens()) {
    routes[`(tabs)/${route}`] = () => null;
  }

  return renderRouter(routes, { initialUrl: "/" });
}

/** The list of tabs the navigator painted, as the browser marks it up. */
function tabList(view: RenderResult): TestElement {
  const lists = domElements(view.root).filter(
    (element) => element.props.role === "tablist",
  );

  if (lists.length === 1) {
    return lists[0];
  }

  if (lists.length === 0) {
    throw new Error(
      "The browser build drew no tab list at all, so the classic tab bar " +
        "never reached the page: app/(tabs)/_layout.tsx only renders <Tabs> " +
        "while isLiquidGlassAvailable() answers false, which is what a " +
        "browser answers today",
    );
  }

  throw new Error(
    `The browser build drew ${lists.length} tab lists, so this check can no ` +
      "longer tell which one is the app's tab bar and needs updating before " +
      "it can read the tabs again",
  );
}

/** The bar itself: the element the navigator paints around the tab list. */
function tabBar(view: RenderResult): TestElement {
  for (
    let ancestor: TestElement | null = tabList(view).parent;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (typeof ancestor.type === "string") {
      return ancestor;
    }
  }

  throw new Error(
    "The tab list has no element around it, so the navigator no longer paints " +
      "a bar the way this check measures it and this check needs updating",
  );
}

/** What a bar the browser branch filled reads as. */
const PLAIN_FILL =
  "a plain view painted with the theme background fills the bar";

function fillReport(bar: TestElement): string {
  const fills = domElements(bar).filter((element) => element !== bar);

  const blurred = fills.some(
    (element) => styleOf(element).backdropFilter !== undefined,
  );
  if (blurred) {
    return "a blurred view fills the bar";
  }

  const painted = fills.some((element) =>
    sameColor(styleOf(element).backgroundColor, mockColors.background),
  );
  if (!painted) {
    return "no view of its own fills the bar";
  }

  return PLAIN_FILL;
}

/** What a bar held to the height tab screens reserve reads as. */
const FIXED_HEIGHT = `the bar is ${WEB_TAB_BAR_HEIGHT}px tall`;

function heightReport(bar: TestElement): string {
  const height = pixelsOf(styleOf(bar).height);
  if (height === null) {
    return (
      "the bar is left to size itself, so nothing holds it to the room tab " +
      "screens reserve for it"
    );
  }
  return `the bar is ${height}px tall`;
}

type DrawnTab = {
  /** The address the rendered tab links to. */
  href: string;
  /** Text the tab draws in a reading font: its label. */
  labels: string[];
  /** Text the tab draws in the icon font: its glyphs. */
  glyphs: string[];
};

/** Every tab the bar drew, in the order the bar shows them. */
function drawnTabs(view: RenderResult): DrawnTab[] {
  return domElements(tabList(view))
    .filter((element) => element.props.role === "tab")
    .map((tab) => {
      const texts = domElements(tab)
        .map((element) => ({
          text: element.children
            .filter((child): child is string => typeof child === "string")
            .join(""),
          fontFamily: styleOf(element).fontFamily,
        }))
        .filter(({ text }) => text !== "");

      return {
        href: String(tab.props.href),
        labels: texts
          .filter(({ fontFamily }) => fontFamily !== ICON_FONT)
          .map(({ text }) => text),
        // Each tab draws its icon once per state and crossfades between them,
        // so the same glyph arriving more than once is the bar working.
        glyphs: [
          ...new Set(
            texts
              .filter(({ fontFamily }) => fontFamily === ICON_FONT)
              .map(({ text }) => text),
          ),
        ],
      };
    });
}

/** What a tab drawn with its label and its icon reads as. */
function drawnReport(tab: ShippedTab): string {
  return `the ${tab.href} tab draws "${tab.label}" beside the Feather ${tab.icon} icon`;
}

function describeGlyphs(glyphs: string[]): string {
  if (glyphs.length === 0) {
    return "no icon";
  }

  const names = glyphs.map(
    (glyph) => featherNamesByGlyph.get(glyph) ?? `an unnamed glyph "${glyph}"`,
  );
  return names.length === 1
    ? `the Feather ${names[0]} icon`
    : `the Feather ${names.join(" and ")} icons`;
}

function tabReport(view: RenderResult, shipped: ShippedTab): string {
  const tab = drawnTabs(view).find(
    (candidate) => candidate.href === shipped.href,
  );

  if (!tab) {
    return `the browser build drew no tab for ${shipped.href}`;
  }

  const labels =
    tab.labels.length === 0
      ? "no label"
      : tab.labels.map((label) => `"${label}"`).join(" and ");

  return `the ${tab.href} tab draws ${labels} beside ${describeGlyphs(tab.glyphs)}`;
}

/**
 * Registers the browser's own rendering of the classic tab bar.
 *
 * Called from __tests__/WebTabBar.test.web.tsx, the only entry point: this
 * measures the browser build, which is the one jest project that resolves
 * `.web` sources and react-native-web.
 */
export function describeWebTabBar(): void {
  describe("the browser draws the classic tab bar", () => {
    it("runs on the platform this file exists to measure", () => {
      // Everything below only describes a browser while this file's project in
      // jest.config.js keeps targeting web. If that stopped being true the
      // suite would still run, against a bar no browser builds.
      expect(`the suite is running on ${Platform.OS}`).toBe(
        "the suite is running on web",
      );
    });

    it("renders the real packages, not stand-ins for them", () => {
      expect(mockedPackageReport(PACKAGES_LEFT_REAL)).toBe(EVERY_PACKAGE_REAL);
    });

    it("pins the tabs the app has shipped, as the phone runs do", () => {
      // The per-tab checks read the routes off the filesystem, so they pass
      // vacuously if that read finds nothing; this is the floor for it.
      expect(SHIPPED_TABS.map((tab) => tab.route)).toEqual(
        TABS_ALREADY_SHIPPED,
      );
      expect(registeredTabScreens()).toEqual(
        expect.arrayContaining(TABS_ALREADY_SHIPPED),
      );
    });

    it("draws one tab per tab screen, with the shipped tabs in order", () => {
      const drawn = drawnTabs(renderTabNavigator()).map((tab) => tab.href);
      const expected = registeredTabScreens().map(hrefOf);

      expect([...drawn].sort()).toEqual([...expected].sort());
      // The bar's own order, which the directory listing cannot express.
      const shipped = SHIPPED_TABS.map((tab) => tab.href);
      expect(drawn.filter((href) => shipped.includes(href))).toEqual(shipped);
    });

    it.each(SHIPPED_TABS)(
      "draws the $href tab with its label and its icon",
      (shipped) => {
        const view = renderTabNavigator();

        expect(tabReport(view, shipped)).toBe(drawnReport(shipped));
      },
    );

    it("fills the bar with a plain view rather than the iOS blur", () => {
      const view = renderTabNavigator();

      expect(fillReport(tabBar(view))).toBe(PLAIN_FILL);
    });

    it("reports a blurred fill when a blur does reach the bar", () => {
      // Without this the check above would also pass on a browser build where
      // react-native-web dropped the blur's style instead of drawing it, which
      // is the one way it could stop being able to fail.
      const blurred = render(
        <View>
          <BlurView
            intensity={100}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
        </View>,
      );

      expect(fillReport(blurred.UNSAFE_getByType(View))).toBe(
        "a blurred view fills the bar",
      );
    });

    it("gives the bar the height the tab screens reserve for it", () => {
      const view = renderTabNavigator();

      // The navigator sizes the bar itself on a phone, which is what
      // __tests__/NavigatorTabBarHeight.test.tsx measures there. In a browser
      // the layout sets the height, so the number tab screens reserve and the
      // number the bar is given are the same number or the last control on a
      // tab sits under the bar.
      expect(heightReport(tabBar(view))).toBe(FIXED_HEIGHT);
    });
  });
}
