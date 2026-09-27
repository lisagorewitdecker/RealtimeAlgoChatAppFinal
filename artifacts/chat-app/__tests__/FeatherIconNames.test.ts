import { Feather } from "@expo/vector-icons";

import {
  EVERY_PACKAGE_REAL,
  mockedPackageReport,
} from "../test-support/moduleContract";

/**
 * Contract test for the Feather glyph names the app draws.
 *
 * Every screen test mocks @expo/vector-icons, so if an icon-font release
 * renamed or dropped a glyph the app asks for, the tab bar would render an
 * empty space where the Chats and Profile icons belong and the whole suite
 * would still pass. This file loads the real icon set (no jest.mock) and
 * checks the names the source actually passes to <Feather name="..." /> against
 * Feather.glyphMap. It reads the screens as text rather than rendering them,
 * so it needs no native modules and cannot drift from the names the app ships.
 *
 * Loading the real icon set is the whole of what this file has over the screen
 * tests, so the first check below holds it to that; see INSPECTED_PACKAGES.
 *
 * The iOS tab bar uses SF Symbols through expo-symbols instead; those names
 * live in the system font and cannot be validated offline.
 */

/**
 * The package this suite exists to read for real, written the way the app
 * imports it.
 *
 * Every name below is checked against the glyph map of the import at the top
 * of this file, and an import is what jest.mock replaces. A shared setup file,
 * or a jest.mock added here later, would leave the whole suite checking the
 * app's icon names against a stand-in's glyph map: it would pass while the tab
 * bar drew blanks on a phone, which is the single failure this file exists to
 * catch. The check below names the package instead, and
 * __tests__/ModuleContractMockGuard.test.ts is where it is shown to fire,
 * since a passing run of this file has no mock for it to notice.
 */
const INSPECTED_PACKAGES = ["@expo/vector-icons"] as const;

// Jest runs this file as CommonJS. The app has no @types/node, so the two Node
// APIs this test needs are declared here instead of pulling in a whole type
// package for one file.
declare const __dirname: string;

type DirectoryEntry = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

type FileSystem = {
  readdirSync: (
    path: string,
    options: { withFileTypes: true },
  ) => DirectoryEntry[];
  readFileSync: (path: string, encoding: "utf8") => string;
};

const fs: FileSystem = require("node:fs");

const APP_ROOT = `${__dirname}/..`;
const TAB_LAYOUT = "app/(tabs)/_layout.tsx";

/** Directories under the app root that hold no shipped JSX. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "__tests__",
  "static-build",
]);

const VECTOR_ICONS_IMPORT = 'from "@expo/vector-icons"';

/** Every .tsx file the app ships, so a new screen is covered without edits here. */
function listScreenSources(relativeDir = ""): string[] {
  const entries = fs.readdirSync(
    relativeDir ? `${APP_ROOT}/${relativeDir}` : APP_ROOT,
    { withFileTypes: true },
  );

  return entries.flatMap((entry) => {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      return entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)
        ? []
        : listScreenSources(relativePath);
    }

    return entry.isFile() && entry.name.endsWith(".tsx") ? [relativePath] : [];
  });
}

function readSource(relativePath: string): string {
  return fs.readFileSync(`${APP_ROOT}/${relativePath}`, "utf8");
}

type FeatherUsages = {
  /** Glyph names the source passes as string literals. */
  names: string[];
  /** Usages whose glyph name this scanner could not read, reported so a
   *  refactor cannot quietly shrink what the test checks. The app writes none
   *  of those shapes today, so the two tests below that hold this list empty
   *  say nothing about it filling; the last two tests in this file hand the
   *  scanner sources that do. */
  unreadable: string[];
};

const OPENING_TAG = "<Feather";

/**
 * Reads the glyph names out of a `name={...}` expression. A bare literal is the
 * whole name; otherwise only literals that follow a `?` or `:` count, so the
 * branches of `name={mode === "create" ? "plus-circle" : "log-in"}` are read as
 * icons while the value it compares against is not.
 */
function readNameExpression(expression: string): string[] {
  const trimmed = expression.trim();

  const bareLiteral = /^"([^"]*)"$/.exec(trimmed);
  if (bareLiteral) {
    return [bareLiteral[1] ?? ""];
  }

  return [...trimmed.matchAll(/[?:]\s*"([^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
}

function collectFeatherUsages(source: string, label: string): FeatherUsages {
  const names: string[] = [];
  const unreadable: string[] = [];

  for (
    let at = source.indexOf(OPENING_TAG);
    at !== -1;
    at = source.indexOf(OPENING_TAG, at + OPENING_TAG.length)
  ) {
    // Skip a component whose name merely starts with "Feather".
    if (!/[\s/>]/.test(source[at + OPENING_TAG.length] ?? "")) {
      continue;
    }

    const where = `${label}:${source.slice(0, at).split("\n").length}`;
    const rest = source.slice(at + OPENING_TAG.length);
    const closesAt = rest.indexOf("/>");
    const props = closesAt === -1 ? rest : rest.slice(0, closesAt);

    if (closesAt === -1 || props.includes("<")) {
      unreadable.push(`${where} is not a self-closing <Feather ... /> element`);
      continue;
    }

    const nameProps = [...props.matchAll(/\bname=(?:"([^"]*)"|\{([^}]*)\})/g)];
    if (nameProps.length === 0) {
      unreadable.push(`${where} passes no name prop`);
      continue;
    }

    for (const [, literal, expression] of nameProps) {
      if (literal !== undefined) {
        names.push(literal);
        continue;
      }

      const fromExpression = readNameExpression(expression ?? "");
      if (fromExpression.length === 0) {
        unreadable.push(`${where} builds its name from a value, not a literal`);
        continue;
      }
      names.push(...fromExpression);
    }
  }

  return { names, unreadable };
}

function collectAllFeatherUsages(): FeatherUsages & {
  checkedFiles: string[];
  /** `<Feather` tags counted separately from the parse loop above, so a
   *  scanner that stops seeing an element cannot hide it. */
  tagCount: number;
} {
  const names: string[] = [];
  const unreadable: string[] = [];
  const checkedFiles: string[] = [];
  let tagCount = 0;

  for (const relativePath of listScreenSources()) {
    const source = readSource(relativePath);
    if (!source.includes(VECTOR_ICONS_IMPORT)) {
      continue;
    }

    checkedFiles.push(relativePath);
    tagCount += [...source.matchAll(/<Feather[\s/>]/g)].length;
    const usages = collectFeatherUsages(source, relativePath);
    names.push(...usages.names);
    unreadable.push(...usages.unreadable);
  }

  return { names, unreadable, checkedFiles, tagCount };
}

const glyphNames = new Set(Object.keys(Feather.glyphMap));

/** Names the installed icon font has no glyph for, sorted for a stable failure. */
function missingFromFont(names: string[]): string[] {
  return [...new Set(names)].filter((name) => !glyphNames.has(name)).sort();
}

function uniqueSorted(names: string[]): string[] {
  return [...new Set(names)].sort();
}

describe("Feather glyph names the app draws", () => {
  it("reads the real icon set, not a stand-in for it", () => {
    expect(mockedPackageReport(INSPECTED_PACKAGES)).toBe(EVERY_PACKAGE_REAL);
  });

  it("loads the real glyph map from @expo/vector-icons", () => {
    // A mocked or restructured icon set would leave this empty and make every
    // other assertion in this file meaningless.
    expect(glyphNames.size).toBeGreaterThan(100);
  });

  it("finds a glyph for both tab bar icons", () => {
    const { names, unreadable } = collectFeatherUsages(
      readSource(TAB_LAYOUT),
      TAB_LAYOUT,
    );

    // Pins what the scanner read, so a tab bar rewrite cannot leave this test
    // checking nothing at all.
    expect(unreadable).toEqual([]);
    expect(uniqueSorted(names)).toEqual(["message-circle", "user"]);
    expect(missingFromFont(names)).toEqual([]);
  });

  it("finds a glyph for every icon the rest of the app draws", () => {
    const { names, checkedFiles } = collectAllFeatherUsages();

    expect(checkedFiles).toContain(TAB_LAYOUT);
    expect(checkedFiles.length).toBeGreaterThan(1);
    expect(missingFromFont(names)).toEqual([]);
  });

  it("reads the glyph name out of every <Feather /> the app renders", () => {
    const { unreadable, names, tagCount } = collectAllFeatherUsages();

    expect(unreadable).toEqual([]);
    // Every icon the app renders contributed at least one name to check.
    expect(tagCount).toBeGreaterThan(0);
    expect(names.length).toBeGreaterThanOrEqual(tagCount);
  });

  it("reports a name the font has no glyph for", () => {
    // Proves the checks above fail rather than pass vacuously when a glyph the
    // app asks for is missing from the font.
    expect(
      missingFromFont(["message-circle", "user", "no-such-glyph"]),
    ).toEqual(["no-such-glyph"]);
  });

  /**
   * The other half of that proof, for the other way these checks can empty
   * out. Two tests above hold `unreadable` empty over the app's own sources,
   * and a scanner that stopped recording an icon it cannot read would leave
   * both passing — over icons then checked against the font by nobody. A
   * passing run says nothing about it, since every <Feather /> the app ships
   * today writes its glyph name where this can read it, and none of these
   * shapes may be added to the app to prove otherwise. So the scanner is
   * handed sources of its own here, the way
   * __tests__/ModuleContractMockGuard.test.ts hands the load reader in
   * test-support/moduleContract.ts one.
   */

  it("names an icon whose glyph name it cannot read, and where it sits", () => {
    // A name held in a value draws an icon as surely as a literal does, and
    // the source never says which glyph that is — read as no name at all, it
    // would be an icon the font check silently skipped. The literal beside it
    // is still read, so the report says what was lost rather than giving up on
    // the file.
    expect(
      collectFeatherUsages(
        [
          `<Feather name="message-circle" size={22} color={color} />`,
          `<Feather name={icon} size={22} color={color} />`,
        ].join("\n"),
        "screen.tsx",
      ),
    ).toEqual({
      names: ["message-circle"],
      unreadable: ["screen.tsx:2 builds its name from a value, not a literal"],
    });
  });

  it("reaches every reason it can give, not just the first", () => {
    // Each shape the scanner refuses to guess at: a name computed from a
    // value, an element carrying no name prop, and one that is not
    // self-closing — both as the scanner meets it, with markup of its own
    // inside the tag it was reading, and as the last thing in a source, where
    // there is no `/>` left to find. The ternary and the plain literal after
    // them are read as usual, so one usage it cannot read costs only that one.
    expect(
      collectFeatherUsages(
        [
          `<Feather name={ICON_BY_MODE[mode]} size={18} />`,
          `<Feather size={18} color={colors.primary} />`,
          `<Feather name="user" size={18}></Feather>`,
          `<Feather name={mode === "create" ? "plus-circle" : "log-in"} />`,
          `<Feather name="lock" size={26} />`,
          `<Feather name="grid" size={16}>`,
        ].join("\n"),
        "screen.tsx",
      ),
    ).toEqual({
      names: ["plus-circle", "log-in", "lock"],
      unreadable: [
        "screen.tsx:1 builds its name from a value, not a literal",
        "screen.tsx:2 passes no name prop",
        "screen.tsx:3 is not a self-closing <Feather ... /> element",
        "screen.tsx:6 is not a self-closing <Feather ... /> element",
      ],
    });
  });
});
