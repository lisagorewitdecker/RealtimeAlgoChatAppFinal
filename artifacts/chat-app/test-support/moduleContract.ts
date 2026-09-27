/**
 * The assertions shared by the unmocked module contract suites
 * (test-support/tabLayoutModuleContract.ts and
 * test-support/screenModuleContract.ts), which each run once per platform:
 * shape-only reads of an export, the mockedPackageReport check that holds the
 * word "unmocked" to its meaning, and the pair of checks —
 * unlistedPackageReport and unloadedPackageReport — that hold each suite's
 * list of packages and the packages it actually loads to each other, so
 * neither can drift past the other.
 *
 * That first check is shared more widely than the contracts — every suite that
 * only means something while a package is the real module calls it; see its
 * own comment below.
 *
 * Every screen test mocks the native packages its screen imports, so those
 * tests stay green even when an Expo SDK upgrade renames or drops an export the
 * app relies on — the real app would then crash on launch with an invalid
 * element type. The contract tests import those packages for real and only
 * inspect the shape of the exports the app uses, so they need no native modules
 * and never render anything.
 *
 * Each assertion compares two sentences rather than a boolean so a failure says
 * what the export actually is ("Feather is not exported", "BlurView is an
 * object, not a component") instead of "expected true, received false".
 */

type UnknownRecord = Record<string, unknown>;

/**
 * React components come in several shapes: plain function components, and
 * objects tagged with a $$typeof symbol (React.memo, React.forwardRef and the
 * host components some Expo packages export).
 */
export function componentReport(name: string, value: unknown): string {
  if (value === undefined) {
    return `${name} is not exported`;
  }
  if (value === null) {
    return `${name} is null`;
  }
  if (typeof value === "function") {
    return `${name} is a component`;
  }
  if (
    typeof value === "object" &&
    typeof (value as UnknownRecord).$$typeof === "symbol"
  ) {
    return `${name} is a component`;
  }
  return `${name} is a ${typeof value}, not a component`;
}

export function expectComponent(name: string, value: unknown): void {
  expect(componentReport(name, value)).toBe(`${name} is a component`);
}

export function functionReport(name: string, value: unknown): string {
  if (value === undefined) {
    return `${name} is not exported`;
  }
  return `${name} is a ${typeof value}`;
}

export function expectFunction(name: string, value: unknown): void {
  expect(functionReport(name, value)).toBe(`${name} is a function`);
}

/**
 * For exports that are neither components nor functions, such as the members of
 * the Haptics feedback enums, where only presence matters.
 */
export function definedReport(name: string, value: unknown): string {
  if (value === undefined) {
    return `${name} is not exported`;
  }
  if (value === null) {
    return `${name} is null`;
  }
  return `${name} is defined`;
}

export function expectDefined(name: string, value: unknown): void {
  expect(definedReport(name, value)).toBe(`${name} is defined`);
}

/**
 * Reads a nested export such as Tabs.Screen or Haptics.ImpactFeedbackStyle.Light
 * without assuming the parent survived the upgrade; a missing parent reports the
 * child as not exported instead of throwing.
 */
export function member(parent: unknown, key: string): unknown {
  if (
    parent === null ||
    (typeof parent !== "object" && typeof parent !== "function")
  ) {
    return undefined;
  }
  return (parent as UnknownRecord)[key];
}

/** The sentence mockedPackageReport returns when nothing was mocked. */
export const EVERY_PACKAGE_REAL = "every package is the real module";

/**
 * Whether a value is one of jest's mock functions, read off the value itself
 * so nothing has to be called to find out. A value that refuses to be read at
 * all — a proxy with a throwing trap — answers no rather than failing a run
 * over a package this check cannot see into.
 */
function isJestMock(value: unknown): boolean {
  try {
    return jest.isMockFunction(value);
  } catch {
    return false;
  }
}
/**
 * Names the packages a run answered with a mock instead of the real module.
 *
 * Every assertion above reads a value the calling suite imported, and an
 * import is exactly what jest.mock replaces. A shared setup file, or a future
 * entry point, that mocked one of these packages would leave the whole
 * contract reading the stand-in's shape: it would pass and quietly stop saying
 * anything about the SDK the app launches against. Each suite therefore hands
 * this its own list of the packages it inspects.
 *
 * A mocked specifier is one the run answers two ways. `require` — the route
 * the suites' own imports compile to — hands back whatever the run installed
 * for that package, while jest.requireActual reaches past a mock to the real
 * module behind it. For a package nothing mocked both routes resolve the same
 * file, and jest caches a module by its resolved path, so the two are the same
 * object; on web that holds through the react-native alias as well, which both
 * routes follow.
 *
 * That comparison is about which module a specifier answers with, and a
 * package can stop being itself without being replaced: a run can keep the
 * real module and write over what it exports. jest.spyOn does exactly that,
 * and so does `require("pkg").thing = jest.fn()` in a setup file — both routes
 * still hand back the one object, patch and all, so the comparison above sees
 * nothing. What they leave behind is a jest mock sitting where one of the
 * package's own exports belongs, and patchedExports above looks for that, one
 * level in as well: `jest.spyOn(Dimensions, "get")` patches an export's method
 * rather than the export.
 *
 * That scan reads property descriptors and never reads an export that is a
 * getter. Most of these packages are babel's ES-module output, where a
 * re-export is a getter that loads the module behind it on first read;
 * react-native's index is nothing but those, several of them throw on purpose
 * for the APIs it has removed, and what a good many of the rest hand back
 * under the React Native jest preset is the preset's own mock —
 * AccessibilityInfo, Linking, UIManager and forty more, in every run of every
 * suite. Reading them would cost seconds per suite and report the platform's
 * own test setup as a patch, so a lazy export is left unread and the getter
 * itself is checked instead, since that is what a spy on one replaces.
 *
 * A stand-in carrying no trace of jest — a hand-written stub, an icon set's
 * glyph map overwritten with a plain object — reads as the real export here.
 * Telling those apart needs a pristine copy of the package to compare against,
 * and the only way to get one is to evaluate it a second time in a registry of
 * its own, which re-runs whatever the package does as it loads: @clerk/expo
 * opens a BroadcastChannel that holds jest's event loop open, which is why
 * test-support/screenModuleContract.ts loads it behind a guard. So this names
 * what it can show rather than guessing at the rest.
 *
 * The two contracts are not the only callers:
 * __tests__/FeatherIconNames.test.ts checks the app's icon names against the
 * real Feather glyph map, and test-support/webTabBar.tsx renders the browser's
 * tab bar out of the real packages, so both are exposed the same way and hand
 * this the same kind of list.
 *
 * @react-native-async-storage/async-storage is the one package no list may
 * name: jest.setup.js mocks it for every run, and
 * test-support/screenModuleContract.ts deliberately steps past that mock with
 * jest.requireActual rather than inspecting what it installed.
 * test-support/moduleContractMockGuard.ts is where this check is shown to
 * fire, since a passing run of any of those suites has no mock for it to
 * notice, and it runs once per jest project — the two routes it compares are
 * each project's own resolution, so one project's proof says nothing about
 * another's.
 *
 * @param specifiers The packages the calling suite inspects, written the way
 * the app imports them.
 */
export function mockedPackageReport(specifiers: readonly string[]): string {
  const mocked: string[] = [];
  const patched: string[] = [];

  for (const specifier of specifiers) {
    const loaded: unknown = require(specifier);
    const actual: unknown = jest.requireActual(specifier);

    if (loaded !== actual) {
      // Every export of a stand-in is a stand-in, and a factory usually builds
      // them out of jest.fn(), so listing them under the package that was
      // already named would bury it in its own mock's shape.
      mocked.push(specifier);
      continue;
    }

    patched.push(...patchedExports(specifier, loaded));
  }

  const findings: string[] = [];
  if (mocked.length === 1) {
    findings.push(`${mocked[0]} is a mock, not the real module`);
  } else if (mocked.length > 1) {
    findings.push(`${mocked.join(", ")} are mocks, not the real modules`);
  }
  if (patched.length === 1) {
    findings.push(`${patched[0]} is a mock written onto the real module`);
  } else if (patched.length > 1) {
    findings.push(
      `${patched.join(", ")} are mocks written onto the real modules`,
    );
  }

  return findings.length === 0 ? EVERY_PACKAGE_REAL : findings.join("; ");
}

/**
 * Jest runs these files as CommonJS. The app has no @types/node, so the two
 * Node facilities the list check below needs — the directory this module sits
 * in and a file read — are declared here rather than pulling in a whole type
 * package for them; test-support/routeFiles.ts declares its own the same way.
 */
declare const __dirname: string;

type FileSystem = {
  readFileSync: (path: string, encoding: "utf8") => string;
};

const fs: FileSystem = require("node:fs");

/**
 * TypeScript's own parser reads the suites' loads, rather than a search
 * through the text, because the two are told apart by grammar alone. A suite
 * writes `jest.requireActual<typeof import("pkg")>("pkg")` for the one
 * package it steps past a mock for: the `import(...)` there is a type, erased
 * before the file runs, and the call beside it is the route past a mock
 * rather than the route a mock replaces. A search for `import("` or for a
 * package's name would read both as loads and demand that package on the
 * list, which would fail every run — see mockedPackageReport above for why.
 */
type TypeScriptApi = typeof import("typescript");
type SourceNode = import("typescript").Node;

const ts: TypeScriptApi = require("typescript");

/**
 * What one node does when the file runs: nothing at all, a load this reader
 * can name, or a load it cannot read the name of.
 *
 * The last of those is what a bare `string | undefined` answer cannot tell
 * from the first. `require(name)` pulls a package in as surely as
 * `require("expo-haptics")` does, and the shape assertions read whatever it
 * brought, but the source never writes which package that was — so it is
 * reported rather than passed over, the way
 * __tests__/FeatherIconNames.test.ts reports an icon whose glyph name it
 * cannot read instead of checking one fewer name.
 */
type NodeLoad =
  | { readonly kind: "nothing" }
  | { readonly kind: "package"; readonly specifier: string }
  | { readonly kind: "unreadable"; readonly reason: string };

const LOADS_NOTHING: NodeLoad = { kind: "nothing" };

/**
 * What a module specifier loads: the text of a string literal — including a
 * template with nothing substituted into it — and an unreadable load for
 * every other expression, which is a variable, a call, or a name built out of
 * a constant.
 */
function specifierLoad(node: SourceNode | undefined): NodeLoad {
  if (node === undefined) {
    return { kind: "unreadable", reason: "passes no module specifier" };
  }
  return ts.isStringLiteralLike(node)
    ? { kind: "package", specifier: node.text }
    : {
        kind: "unreadable",
        reason: "loads a package from a value, not a literal",
      };
}

/**
 * Whether a call loads a module the way the app's own imports do: `require`,
 * which is what an import compiles to and what the suites write by hand for
 * the packages they load after a guard is in place, and `import()`.
 *
 * jest.requireActual is a call too, and deliberately not one of these.
 */
function isLoadCall(callee: SourceNode): boolean {
  return (
    (ts.isIdentifier(callee) && callee.text === "require") ||
    callee.kind === ts.SyntaxKind.ImportKeyword
  );
}

/**
 * What a single node loads when the file runs, which for most nodes is
 * nothing — including the `import type` and `typeof import(...)` forms
 * TypeScript erases, and an `export { ... }` that names no module to take
 * them from.
 */
function nodeLoad(node: SourceNode): NodeLoad {
  if (ts.isImportDeclaration(node)) {
    return node.importClause?.isTypeOnly === true
      ? LOADS_NOTHING
      : specifierLoad(node.moduleSpecifier);
  }
  if (ts.isExportDeclaration(node)) {
    return node.isTypeOnly || node.moduleSpecifier === undefined
      ? LOADS_NOTHING
      : specifierLoad(node.moduleSpecifier);
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return ts.isExternalModuleReference(node.moduleReference)
      ? specifierLoad(node.moduleReference.expression)
      : LOADS_NOTHING;
  }
  if (ts.isCallExpression(node) && isLoadCall(node.expression)) {
    return specifierLoad(node.arguments[0]);
  }
  return LOADS_NOTHING;
}

/** What a suite's source says about the packages it loads. */
export type SourceLoads = {
  /** The packages it loads by a name it writes out, in the order it loads them. */
  readonly packages: readonly string[];
  /** The loads whose package this reader could not name, each said where. */
  readonly unreadable: readonly string[];
};

/**
 * Reads a TypeScript source's loads: the packages it names, and the loads it
 * leaves unreadable.
 *
 * A specifier starting with a dot is the suite's own neighbour —
 * ./moduleContract — rather than a package the SDK ships, so nothing here has
 * to be said about it. An unreadable load is reported even though it may have
 * been one of those: a value holds a neighbour's path as easily as a
 * package's name, and which of the two it was is exactly what the source does
 * not say.
 *
 * @param fileName The suite's file name, which names the source to the parser
 * and says where an unreadable load sits.
 * @param source The text of a suite, which is a TypeScript module that renders
 * nothing; there is no JSX here to parse.
 */
export function loadedPackages(fileName: string, source: string): SourceLoads {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );

  const packages: string[] = [];
  const unreadable: string[] = [];

  const visit = (node: SourceNode): void => {
    const load = nodeLoad(node);
    if (load.kind === "unreadable") {
      const { line } = parsed.getLineAndCharacterOfPosition(
        node.getStart(parsed),
      );
      unreadable.push(`${fileName}:${line + 1} ${load.reason}`);
    } else if (
      load.kind === "package" &&
      !load.specifier.startsWith(".") &&
      !packages.includes(load.specifier)
    ) {
      packages.push(load.specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);

  return { packages, unreadable };
}

/** The source of a suite in this directory, named by its file name. */
export function contractSource(fileName: string): string {
  return fs.readFileSync(`${__dirname}/${fileName}`, "utf8");
}

/**
 * The sentence the check below returns when every load reads as a package the
 * list names.
 */
export const EVERY_PACKAGE_LISTED =
  "every package the suite loads is on its list";

/**
 * Holds a list of packages to the loads written in a source.
 *
 * A load this reader cannot name is reported before anything else, because it
 * decides nothing else: the list is held to the packages the source writes
 * out, so a load whose package the source never writes cannot be missing from
 * the list, and a complete list says nothing about it. Reported, it is the
 * failure it is; passed over, it would be a package inspected by every shape
 * assertion and skipped by the mock check.
 *
 * Suites read their own file through unlistedPackageReport below.
 * __tests__/ModuleContractMockGuard.test.ts hands this a source of its own,
 * which is the only way to show what a suite that loads a package from a
 * value answers: no suite in this directory writes one, and the point of the
 * check is that none may.
 *
 * @param fileName The name the source is reported under.
 * @param source The text of that source.
 * @param specifiers The packages a suite names as the ones it inspects.
 */
export function sourcePackageReport(
  fileName: string,
  source: string,
  specifiers: readonly string[],
): string {
  const { packages, unreadable } = loadedPackages(fileName, source);

  if (unreadable.length > 0) {
    return unreadable.join("; ");
  }

  const unlisted = packages.filter(
    (specifier) => !specifiers.includes(specifier),
  );

  if (unlisted.length === 0) {
    return EVERY_PACKAGE_LISTED;
  }
  if (unlisted.length === 1) {
    return `${unlisted[0]} is loaded but not on the list`;
  }
  return `${unlisted.join(", ")} are loaded but not on the list`;
}

/**
 * Names the packages a suite loads that its own list never mentions, and the
 * loads it cannot read a package out of at all.
 *
 * mockedPackageReport only covers the packages it is handed, so the list a
 * suite keeps decides what "unmocked" was checked over. A package added to a
 * suite's imports and not to its list is read by every shape assertion and
 * skipped by that check — the same silent pass the check was written to close,
 * moved from every package to the newest one. This reads the suite's own loads
 * back out of its source and holds the list to them, so the two cannot drift.
 *
 * The one package the screen contract reaches past a mock for needs no
 * exemption written here: it is loaded through jest.requireActual, which
 * loadedPackages does not count, so the list is right to leave it out.
 *
 * @param fileName The calling suite's file name; every suite sits beside this
 * module.
 * @param specifiers The packages that suite names as the ones it inspects.
 */
export function unlistedPackageReport(
  fileName: string,
  specifiers: readonly string[],
): string {
  return sourcePackageReport(fileName, contractSource(fileName), specifiers);
}

/**
 * The sentence unloadedPackageReport returns when the list names nothing the
 * suite does not load.
 */
export const EVERY_LISTED_PACKAGE_LOADED =
  "every package on the list is one the suite loads";

/**
 * Names the packages a suite's list claims that the suite never loads.
 *
 * unlistedPackageReport above catches the list falling behind the suite's
 * loads; this catches the same drift the other way. An entry left behind
 * after the import it stood for was removed reads as coverage the suite no
 * longer has, and nothing else notices it: mockedPackageReport loads that
 * package itself, finds the real module behind it and reports it clean, so
 * the list goes on naming an export no assertion in the suite inspects.
 *
 * Nothing needs excusing here either. The one package the screen contract
 * reaches past a mock for is on no list at all — mockedPackageReport is why —
 * and this check reads the list, so there is nothing for it to report.
 *
 * A load whose package this reader cannot name is left to the check above,
 * which fails the same suite over it. This one would only add that a listed
 * package it cannot see loaded is unloaded, which is a guess about the load
 * already being reported.
 *
 * @param fileName The calling suite's file name; every suite sits beside this
 * module.
 * @param specifiers The packages that suite names as the ones it inspects.
 */
export function unloadedPackageReport(
  fileName: string,
  specifiers: readonly string[],
): string {
  const { packages } = loadedPackages(fileName, contractSource(fileName));
  const unloaded = specifiers.filter(
    (specifier) => !packages.includes(specifier),
  );

  if (unloaded.length === 0) {
    return EVERY_LISTED_PACKAGE_LOADED;
  }
  if (unloaded.length === 1) {
    return `${unloaded[0]} is on the list but not loaded`;
  }
  return `${unloaded.join(", ")} are on the list but not loaded`;
}

/**
 * The own properties of a value as descriptors, which is how the scan below
 * looks at a module without reading it: a property behind a getter stays
 * unread, and a value that has no properties to describe — a number, a string,
 * null — reports none.
 */
function ownProperties(value: unknown): Record<string, PropertyDescriptor> {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return {};
  }
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return {};
  }
}

/**
 * Names the places one real module carries a jest mock where an export of its
 * own belongs: `expo-secure-store getItemAsync` for the export itself, and
 * `react-native-webview default.isFileUploadSupported` one level in, which is
 * where a spy on a method of an exported object lands.
 *
 * One level is as far as it goes. A module's exports are the surface the
 * suites read, and everything below them is the package's own business.
 */
function patchedExports(specifier: string, module: unknown): string[] {
  const patched: string[] = [];

  for (const [name, descriptor] of Object.entries(ownProperties(module))) {
    if (isPatchedProperty(descriptor)) {
      patched.push(`${specifier} ${name}`);
      continue;
    }

    // An export behind a getter has no `value` to look into, which is how the
    // call below leaves a lazy export unread; see mockedPackageReport for why
    // reading one is the wrong move.
    for (const [memberName, member] of Object.entries(
      ownProperties(descriptor.value),
    )) {
      if (isPatchedProperty(member)) {
        patched.push(`${specifier} ${name}.${memberName}`);
      }
    }
  }

  return patched;
}

/** Whether a property is one a run replaced with a jest mock. */
function isPatchedProperty(descriptor: PropertyDescriptor): boolean {
  return (
    isJestMock(descriptor.value) ||
    isJestMock(descriptor.get) ||
    isJestMock(descriptor.set)
  );
}
