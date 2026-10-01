/**
 * Workspace consistency check: every Playwright config in this workspace
 * names a requirement module as its `globalSetup`, and the module it names
 * announces the suite that this config's own specs need.
 *
 * A browser suite that cannot reach its settings used to skip itself, and a
 * skipped browser check reports the same green as a passing one. The fix was
 * to decide once per run, before any spec file loads, whether the run may go
 * without them: each config points `globalSetup` at a one-line module that
 * calls `announceBrowserTests` from `@workspace/browser-test-requirements`,
 * which fails the run naming what is missing, or says out loud what a
 * deliberately waived run is leaving out. That module is a shared library
 * rather than one package's file, because the convention is the workspace's:
 * a suite anywhere in the tree declares itself there and imports it by
 * package name, the way every other shared library is reached.
 *
 * Nothing stopped that wiring from being dropped again. A config added for a
 * new suite, or an existing one edited, can simply omit `globalSetup` and the
 * quiet pass comes straight back with no signal at all — and the signal would
 * be missed exactly where it matters, in the run made before publishing. So
 * the wiring is checked here instead of remembered, and the check runs with
 * the rest of the repository's checks rather than by hand.
 *
 * Where it looks is the whole workspace, not the one directory these suites
 * live in today: a browser config added in another package, or above them
 * all, brings the quiet pass back for its own suite, and a check that never
 * looked at it would report the same success as one that had. Which files are
 * Playwright's is decided in playwrightConfigs.ts, together with the sibling
 * check that reads the same tree — a `*.config.ts` out there belongs to
 * vitest, jest, metro, or vite as often as to Playwright.
 *
 * Deciding at config module scope does not count, which is why this looks for
 * `globalSetup` and nothing else: Playwright evaluates the config module in
 * the run's own process and again in every worker process, so a throw there
 * surfaces as a worker crash rather than as the run's reason for stopping,
 * and anything printed there prints once per worker.
 *
 * Naming *a* requirement module is not enough either. These configs are
 * copied from one another, so a new one left pointing at the original's
 * `<suite>.requirement.ts` is the natural mistake and the least visible: the
 * launch smoke config wired to `auth-layout.requirement.ts` would demand only
 * `E2E_CHAT_URL`, then fail deep inside a case for a missing Clerk key or
 * database URL, reading as a broken product rather than a missing setting.
 * Which config runs which spec, and which suite that spec's settings belong
 * to, cannot be read off matching file names — `playwright.config.ts` runs
 * `banned-room.spec.ts` — so each `BrowserSuite` in the shared module names
 * its `config` and its `spec`, and this check holds both sides to it.
 *
 * What therefore fails here:
 *   - a config that names no `globalSetup` at all;
 *   - one whose `globalSetup` is built at runtime, so no module can be read;
 *   - one naming a module that is not on disk;
 *   - one whose module never announces the decision, so the run still cannot
 *     tell a configured environment from a partly configured one;
 *   - one no `BrowserSuite` claims, so nothing says which settings its specs
 *     need;
 *   - one whose module announces a suite other than the one declared for the
 *     spec it runs;
 *   - one that also collects another suite's spec, which would run those
 *     cases under settings nobody demanded for them;
 *   - a declaration that has drifted: a suite naming a config or a spec that
 *     is not there, one naming a spec its config does not run, or two suites
 *     claiming the same config;
 *   - one whose files import a package this workspace builds by a specifier
 *     that reaches no file, so that package's reads never reach the lists
 *     below.
 *
 * Wiring a config to its own suite settles which list of settings the run is
 * held to; it does not settle whether that list is the right one. A case
 * reading `E2E_API_URL` under a suite asking only for `E2E_CHAT_URL` passes
 * every check above and still starts a run that fails inside the case, for a
 * setting nothing said was missing — the same failure, reached from the
 * settings side. So the spec each config runs, the fixtures that spec
 * imports, and the workspace packages those import in turn are read for what
 * they take out of `process.env`, and every name found has to be declared on
 * the suite: in `required`, or in `optional` for one a run really may go
 * without. Stating it is the point — the difference between "this suite does
 * not need it" and "someone forgot to ask for it" is not recoverable from the
 * code, so an unstated read fails.
 *
 * The config file is read for the same thing, and what it reads counts as its
 * suite's. Every one of these takes its `baseURL` out of the environment, and
 * a reporter's output file or a directory can come from there too, so a
 * config is as able to need a setting nobody declared as a spec is.
 * Undeclared there it is the worse of the two: Playwright evaluates the
 * config module in the run's own process and again in every worker, so a run
 * missing that setting is not stopped once by `globalSetup` — it carries on
 * into whatever the config makes of an absent value, once per worker.
 *
 * So is the module that config names as `globalSetup`. Nothing arrives at it
 * by following imports — the config names it as a string path, which is how
 * Playwright loads it — and a setting read there is as missing at run time as
 * one read in a case, in the one module written to stop the run and name what
 * this environment does not provide. So each module a config names is read
 * for its own reads, and they count as its suite's.
 *
 * The comparison runs both ways, because a declaration nothing reads wastes
 * the same trip. A `required` entry no longer read stops the run before any
 * case loads and names a setting nobody has to configure; an `optional` entry
 * no longer read quietly widens what the suite is allowed to skip. Both fail,
 * so each list stays what the cases actually do.
 *
 * `optional` is still the wrong home for a setting a run never wants, and
 * this check is what makes it the tempting one: it follows every module a
 * spec imports whatever the scope of the read, so one import of a helper
 * built for another suite arrives here as an undeclared read, and one
 * `optional` entry makes that failure go away — at the price of a "going
 * without" line on every run of a suite that reads nothing of the sort. The
 * answer is to move the code rather than the read, which is why the
 * moderation suite's signed-in pages sit in a module apart from the
 * disposable accounts the timeout regression uses alone. A suite records
 * that decision in `unused`, naming the settings its cases are meant never
 * to reach and why, and this check holds it: a module in what the config
 * runs reading one of those fails, naming the module that brought it back,
 * and so does a suite asking for the same setting in `required` or
 * `optional` — the half-measure that would otherwise retire the entry
 * without removing it. Deleting the entry still ends the rule, deliberately
 * and beside the reason it was written.
 *
 * An entry also has to be about a setting this workspace still has. One
 * naming a setting no module here reads and no suite asks for refuses a read
 * that nothing could make, which is what a mistyped name looks like and what
 * an entry outliving its setting turns into — a line that reads as a rule
 * and holds nobody to anything. So the tree is read for that name, which is
 * the one question the declaring suite's own imports cannot answer: they no
 * longer arrive at that read, which is the whole of what the entry says.
 *
 * A file that never names a setting can still reach one. Handing the whole
 * environment to a helper — `assertDevelopment(process.env)`, or the
 * `env: process.env` a call is given inside its options — reaches whatever
 * that helper reads, and a setting missing there stops a case exactly as one
 * read here does. So a handoff is followed into the function it names, and on
 * through that function's own handoffs of the same environment, and what is
 * read that way counts as a read of the suite. A helper one of this
 * workspace's own packages exports is followed into that package, and on
 * through an entry point that only re-exports it from the file declaring it,
 * because that is the ordinary shape of a shared library here and the
 * library's own structure is not what a suite's settings list should turn
 * on. A handoff this check cannot follow to a declaration it can read is
 * reported rather than passed over: a helper whose reads nobody can see puts
 * those settings back out of reach of the list, which is this same gap one
 * call further out.
 *
 * A spread carries it the same distance. `announce(SUITE, { ...process.env,
 * BROWSER_TESTS: "1" })` puts everything the environment holds into the
 * object that call is handed, so it is followed as that argument is, and
 * what the function reads off it counts here too. A fixture collecting that
 * object into a local name first — `const settings = { ...process.env,
 * BROWSER_TESTS: "1" };` and then `announce(SUITE, settings)` — is followed
 * the same way, because everything the environment holds is in what that
 * name holds. Passing over a spread would be the quietest gap of the lot —
 * no name, no handoff, nothing reported — and the settings behind it would
 * reach the run with no list held to them. Spread somewhere this check
 * cannot follow, across a call's own arguments or into an object that is
 * neither one nor a name's whole value, it is reported like every other
 * place the environment goes out of sight.
 *
 * One handoff is passed over, and it is the announcement itself. Every
 * requirement module hands `announceBrowserTests` a copy of the environment
 * with the run's own answer set in it, and what that call reads off it is
 * this suite's declaration: the names in `required` and `optional`, read
 * back by the lists being compared here. Followed, it arrives at the shared
 * module's `env[name]` reader and is reported as a setting named while the
 * run is in progress — true of that one reader, and true of nothing any of
 * these suites takes. Only that argument of that call: the environment
 * reaching anywhere else is read like any other handoff.
 *
 * A name the environment is kept under is read as the environment itself.
 * `const env = process.env;` and then `env.CLERK_SECRET_KEY`, or
 * `assertDevelopment(env)`, reaches exactly what the same file reaches
 * writing `process.env` at each of those places, so an ordinary refactor of
 * a fixture is not a reason to fail it over this check's own limits. Nothing
 * further is followed to read it that way: the name is assigned in the file
 * being read, and every later use of it there is a use of the environment. A
 * name given another value as well, exported for other modules to use, or
 * built from a second thing spread in beside the environment, is reported
 * rather than assumed — what it holds after that, what another file reads
 * off it, or which of its keys came from the environment, cannot be seen
 * from here.
 *
 * A name keeping the environment under a key of its own object is followed
 * as what it is. `const options = { env: process.env, now: Date.now() };`
 * and then `recover(options)` hands the environment to `recover` under
 * `env`, exactly as writing that object in the call's own arguments would,
 * and `options.env.CLERK_SECRET_KEY` reads that setting as plainly as
 * `process.env.CLERK_SECRET_KEY` does. The key travels with the name, so
 * what is followed is that one property rather than everything the name
 * holds: another key of the same object reaches nothing of the
 * environment. Where the key cannot be read through, it is reported rather
 * than guessed at — the key given another value, the environment written
 * under two keys of one name, a second object spread in beside it, the
 * name exported, or the name handed on under a further key, which would
 * put the environment a level deeper than a parameter can be read at.
 *
 * A default is not a handoff: `env: Environment = process.env` on a
 * function's own parameter is handed nothing by anybody, and whether that
 * default is ever taken is a question about who calls that function rather
 * than about the file declaring it.
 *
 * Two more gaps are reported for the same reason, because both make a suite
 * look like it reads less than it does — and the comparison running the
 * other way turns that into advice to drop a `required` entry the run
 * genuinely needs, which breaks the run this was protecting. One is an
 * import of a package this workspace builds that reaches no file: a manifest
 * pointing at built output a checkout does not carry, or a subpath no
 * `exports` entry covers, leaves everything inside that package unread. The
 * other is `process.env[name]`, which reads a setting whose name exists only
 * while the case runs. Neither is passed over in silence.
 *
 * A `required`, `optional`, or `unused` list this check cannot read the names
 * out of is also a failure: held to a list it cannot see, it would pass the
 * suite on nothing. `required` states its names directly; the other two
 * state each name under `name`, beside prose — the line the run prints with
 * it, or the reason these cases never reach it — and what that prose says is
 * never read here.
 *
 * That an `optional` entry has its line at all is held to, though, because
 * the announcement is only as useful as the least-stated entry: one written
 * with no line, or a blank one, prints the bare name that line was added to
 * replace, naming a gap without saying what fell into it. So a suite stating
 * one fails here, named beside the setting it left unexplained.
 */
import { globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceGlobs } from "./checkTypecheckScripts.ts";
import {
  findPlaywrightConfigs,
  findWorkspaceModules,
  MODULE_EXTENSIONS,
  stripComments,
  WORKSPACE_TREE,
} from "./playwrightConfigs.ts";

/**
 * The directory a suite declaration's bare `config` name is read in: where
 * this workspace's browser suites live today. A suite whose config is
 * anywhere else names it by its workspace-relative path, which is any name
 * holding a `/` — and a bare name that is not in this directory is reported
 * as exactly that, naming the config elsewhere in the tree that was meant,
 * rather than as a file missing from a package its author never touched.
 *
 * Only the `config` name is anchored here. A bare `spec` name is read beside
 * the config that runs it, which is this directory for the suites declared
 * here and the declaring package's own directory for a suite anywhere else.
 * That is where Playwright looks for it as well — `testDir` defaults to the
 * config's own directory — so a suite in another package names its config
 * once and keeps its spec short.
 */
export const DECLARATION_DIR = "artifacts/api-server/e2e";

/**
 * What a requirement module imports to announce the decision: a shared
 * library, so a suite in any package reaches it the way it reaches every
 * other one. A relative path to the same file counts as well, which is how
 * the library's own modules would name it.
 */
export const REQUIREMENT_PACKAGE = "@workspace/browser-test-requirements";

/** The module that package name resolves to, and where the suites are declared. */
export const REQUIREMENT_MODULE = "lib/browser-test-requirements/src/index.ts";

/** The call that makes a `globalSetup` module a requirement module. */
export const ANNOUNCE_FUNCTION = "announceBrowserTests";

/**
 * Which of that call's arguments is the environment it decides against.
 *
 * The announcement is the one place the whole environment legitimately goes,
 * and a `globalSetup` module handing it one — `announceBrowserTests(SUITE,
 * { ...process.env, BROWSER_TESTS: "required" })` — is not a setting
 * disappearing out of sight. What that call reads off it is the suite's own
 * declaration: the names in `required` and `optional`, read back by the very
 * lists this check is comparing against. Followed, it comes back as
 * `env[name]` inside the shared module's own reader, reported as a name
 * built while the run is in progress — true of that reader and true of no
 * setting this suite takes.
 *
 * So a handoff to the announcement, in this argument, is passed over. Only
 * this one: the environment arriving anywhere else in that call is not the
 * one it decides against, and is read like any other handoff.
 */
export const ANNOUNCE_ENVIRONMENT_ARGUMENT = 1;

/** The config key Playwright runs once, in the run's own process. */
export const GLOBAL_SETUP_KEY = "globalSetup";

/** The config key naming which spec files a run collects. */
export const TEST_MATCH_KEY = "testMatch";

/** The config key naming the directory those spec files are collected from. */
export const TEST_DIR_KEY = "testDir";

/** The `BrowserSuite` key naming what a suite cannot run without. */
export const REQUIRED_KEY = "required";

/** The key naming a setting its cases read that a run may go without. */
export const OPTIONAL_KEY = "optional";

/** The key naming a setting a suite states its cases must never reach. */
export const UNUSED_KEY = "unused";

/**
 * The key an `optional` or `unused` entry states that setting's name under.
 * The rest of either entry is prose — what the cases do without the setting,
 * or why they are meant not to read it at all — written for whoever reads
 * the run or the failure, so this check reads the name and never weighs the
 * wording of the prose beside it.
 */
export const OPTIONAL_NAME_KEY = "name";

/**
 * The key an `optional` entry states its line under: what this suite's cases
 * do without that setting, which the run prints beside the name whenever it
 * goes without one.
 *
 * That an entry has one is the one thing held here. A name announced on its
 * own says a run differs from a fully configured one without saying how, and
 * leaves the reader to open the spec to find out whether it cost a case or
 * nothing at all — which is what the line was added to answer, and what an
 * entry leaving it empty quietly takes back. What the line says is still the
 * author's, and is not read here.
 *
 * Only `optional` is held to it. An `unused` entry's prose is a reason
 * written for whoever hits that failure, printed by no run.
 */
export const OPTIONAL_LINE_KEY = "without";
/** What Playwright collects when a config names no `testMatch` of its own. */
const DEFAULT_TEST_MATCH = /\.(spec|test)\.[cm]?[jt]sx?$/;
const toPosix = (value: string): string => value.split(path.sep).join("/");

/** Drops the extension, so `./x.js` and `./x.ts` name the same module. */
const withoutExtension = (value: string): string =>
  MODULE_EXTENSIONS.some((extension) => value.endsWith(extension))
    ? value.slice(0, value.lastIndexOf("."))
    : value;

/** A declared name with what a person may write around it taken off. */
const declaredName = (value: string): string =>
  value.trim().replace(/^\.\//, "");

/**
 * The bare form of a declared name — one holding no `/`, which is read
 * relative to something rather than being a path — or null for a path.
 */
export function bareName(value: string): string | null {
  const name = declaredName(value);
  return name.includes("/") ? null : name;
}

/**
 * Where a declaration's `config` or `spec` names a file, as a
 * workspace-relative path. A name holding a `/` is the path itself, which is
 * how a suite whose files are in another package names them. A bare name is
 * read in `from`: the directory these suites live in for a `config`, and the
 * directory of the config that runs it for a `spec`.
 */
export function declaredPath(
  value: string,
  from: string = DECLARATION_DIR,
): string {
  const bare = bareName(value);
  return bare === null ? declaredName(value) : `${from}/${bare}`;
}
/**
 * Every expression assigned to `key`, in source order. Each value is read up
 * to the end of its own entry, so an array is returned whole, and the search
 * carries on afterwards: a key written once at the top level and again inside
 * a project is read both times.
 */
function readValueFrom(
  code: string,
  start: number,
): { value: string; end: number } {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let value = "";
  let index = start;
  for (; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      value += char;
      if (char === "\\") {
        value += code[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      value += char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) {
      if (depth === 0) break; // the object this entry belongs to ended
      depth -= 1;
    }
    if (depth === 0 && (char === "," || char === "\n")) break;
    value += char;
  }
  return { value: value.trim(), end: index };
}
/**
 * The expression a config assigns to `globalSetup`, or null where the key is
 * absent. Reads the value up to the end of its own entry, so an array of
 * modules is returned whole.
 */
export function readGlobalSetupValue(source: string): string | null {
  return readConfigValues(source, GLOBAL_SETUP_KEY)[0] ?? null;
}

/** Every string literal in an expression, in source order. */
export function stringLiterals(expression: string): string[] {
  const literals: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  for (const match of expression.matchAll(pattern)) {
    literals.push(match[1] ?? match[2] ?? "");
  }
  return literals;
}

/**
 * Every regular expression literal in an expression, as a usable `RegExp`.
 * `g` and `y` are dropped: those carry a position between calls, and this
 * tests one name after another with the same object.
 */
export function regexLiterals(expression: string): RegExp[] {
  const literals: RegExp[] = [];
  let quote: '"' | "'" | "`" | null = null;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char !== "/") continue;

    let body = "";
    let inClass = false;
    let closed = false;
    let scan = index + 1;
    for (; scan < expression.length; scan += 1) {
      const inner = expression[scan]!;
      if (inner === "\\") {
        body += inner + (expression[scan + 1] ?? "");
        scan += 1;
        continue;
      }
      if (inner === "\n") break; // a literal does not span lines
      if (inner === "[") inClass = true;
      else if (inner === "]") inClass = false;
      else if (inner === "/" && !inClass) {
        closed = true;
        break;
      }
      body += inner;
    }
    if (!closed || body === "") continue; // a stray slash, not a literal

    let flags = "";
    let after = scan + 1;
    for (
      ;
      after < expression.length && /[dgimsuvy]/.test(expression[after]!);
      after += 1
    ) {
      flags += expression[after]!;
    }
    try {
      literals.push(new RegExp(body, flags.replace(/[gy]/g, "")));
    } catch {
      // a pattern Node cannot build is not one this check can read
    }
    index = after - 1;
  }
  return literals;
}
/**
 * The file an import in `fromDir` names, as a workspace-relative path, or
 * null where nothing is there. The shared requirement module is named by its
 * package rather than by a path, so that one specifier is resolved to the
 * file the package exports — a suite in another package imports it the way
 * it imports every other shared library, and a relative path reaching the
 * same file is read as the same module.
 */
function resolveImport(
  root: string,
  fromDir: string,
  specifier: string,
): string | null {
  return specifier === REQUIREMENT_PACKAGE
    ? resolveModule(root, ".", REQUIREMENT_MODULE)
    : resolveModule(root, fromDir, specifier);
}

/**
 * The file a path names, as a workspace-relative path, or null. A path
 * naming a directory is the `index` module inside it, which is how a
 * directory of modules — `@workspace/db`'s schema — is imported as one.
 */
function resolveModule(
  root: string,
  fromDir: string,
  specifier: string,
): string | null {
  const base = path.resolve(root, fromDir, specifier);
  const candidates = [
    base,
    ...MODULE_EXTENSIONS.map((extension) => withoutExtension(base) + extension),
    ...MODULE_EXTENSIONS.map((extension) => base + extension),
    ...MODULE_EXTENSIONS.map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile())
        return toPosix(path.relative(root, candidate));
    } catch {
      // keep trying the remaining extensions
    }
  }
  return null;
}

/** Where this workspace states which directories hold its own packages. */
const WORKSPACE_PACKAGES_FILE = "pnpm-workspace.yaml";
/**
 * What a module imports from the shared requirement module, as the local name
 * it uses for each against the name that module exports. Renaming an import
 * therefore still names the suite the shared module declares.
 */
export function importedFromRequirementModule(
  root: string,
  modulePath: string,
  code: string,
): Map<string, string> {
  const imported = new Map<string, string>();
  const canonical = withoutExtension(
    toPosix(path.resolve(root, REQUIREMENT_MODULE)),
  );
  const moduleDir = path.dirname(modulePath);
  const imports = code.matchAll(
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  );
  for (const match of imports) {
    const resolved = resolveImport(root, moduleDir, match[2]!);
    if (resolved === null) continue;
    if (withoutExtension(toPosix(path.resolve(root, resolved))) !== canonical)
      continue;
    for (const name of match[1]!.split(",")) {
      const parts = name
        .trim()
        .split(/\s+as\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) continue;
      imported.set(parts[parts.length - 1]!, parts[0]!);
    }
  }
  return imported;
}
/** Whether a module announces the run's decision through the shared module. */
export function announcesDecision(
  root: string,
  modulePath: string,
  source: string,
): boolean {
  return readAnnouncement(root, modulePath, source).announces;
}

/** One `BrowserSuite` declaration, as the shared module states it. */
export interface SuiteDeclaration {
  /** Export name, which is what a requirement module announces. */
  readonly suite: string;
  /** Workspace-relative path of the config that runs this suite. */
  readonly config: string;
  /**
   * That `config` as the declaration writes it. The path above is where a
   * bare name was read, not what anybody typed, and the difference is what
   * lets a bare name naming no config there be reported as one.
   */
  readonly configAsWritten: string;
  /** Workspace-relative path of the spec that config runs. */
  readonly spec: string;
  /** Settings the suite stops the run for, resolved to plain names. */
  readonly required: readonly string[];
  /**
   * Settings it states its cases may read without the run needing them, as
   * the names those entries state. What each entry says the run does without
   * one is written for the person reading that run; only that it says
   * something is held to anything here.
   */
  readonly optional: readonly string[];
  /**
   * Those of them stating no such line, as the names they state. A run
   * going without one of these prints a bare name, which is the gap the
   * line was added to close.
   */
  readonly unsaid: readonly string[];
  /**
   * Settings it states its cases are meant never to reach, as the names
   * those entries state. Why each is stated is written for the person who
   * hits the failure, not held to anything here.
   */
  readonly unused: readonly string[];
  /**
   * Parts of those three lists that are not plain names: an expression built
   * at runtime, or a list declared somewhere this check cannot follow. A
   * suite with any of these is held to nothing, so they are reported.
   */
  readonly unreadable: readonly string[];
}
export type ConfigProblemKind =
  /** The config names no `globalSetup`, so nothing decides for the run. */
  | "missing"
  /** It names one, but not as a path this check can follow to a module. */
  | "not-a-path"
  /** The module it names is not on disk. */
  | "unresolved"
  /** The module is there but never announces the decision. */
  | "silent"
  /** No suite declares this config, so nothing says what its specs need. */
  | "undeclared"
  /** Two suites declare it, so what its specs need is ambiguous. */
  | "claimed-twice"
  /** A suite declares a config that is not a Playwright config here. */
  | "declared-config-missing"
  /** A suite declares a spec file that is not on disk. */
  | "declared-spec-missing"
  /** The config does not collect the spec its suite declares. */
  | "spec-not-run"
  /** It announces a suite other than the one its own spec belongs to. */
  | "wrong-suite"
  /** It also collects a spec declared as another suite's. */
  | "runs-other-suite"
  /** Its suite's settings are not plain names, so they hold it to nothing. */
  | "unreadable-settings"
  /** What it runs imports a file beside it that is not there. */
  | "unresolved-local-import"
  /** What it runs imports a package of this workspace that names no file. */
  | "unresolved-workspace-import"
  /** Its cases reach the environment somewhere nothing can follow. */
  | "unreadable-environment"
  /** Its cases read a setting the suite declares neither way. */
  | "undeclared-setting"
  /** The config module itself reads one, and every worker reads it again. */
  | "undeclared-config-setting"
  /** The module deciding whether the run may start reads one. */
  | "undeclared-setup-setting"
  /** Its suite requires a setting that nothing it runs reads. */
  | "unread-required"
  /** Its suite states a setting as optional that nothing it runs reads. */
  | "unread-optional"
  /** It states one as optional without saying what a run loses with it. */
  | "unsaid-optional"
  /** Something it runs reads a setting its suite states it never reads. */
  | "unused-setting-read"
  /** Its suite states a setting as unused and asks for it as well. */
  | "unused-setting-declared"
  /** It states one as unused that nothing here reads, so it refuses nothing. */
  | "unused-setting-unread";

export interface ConfigProblem {
  /** Workspace-relative path of the Playwright config. */
  config: string;
  kind: ConfigProblemKind;
  /** What the config assigns to `globalSetup`, where it assigns anything. */
  value?: string;
  /** The module named, for a problem that is about one module. */
  module?: string;
  /** The suite declared for this config, where one is. */
  declaredSuite?: string;
  /** The suites its `globalSetup` modules announce instead. */
  announcedSuites?: string[];
  /** The spec declared as the one this config runs. */
  spec?: string;
  /** Every suite declaring this config, where more than one does. */
  claimedBy?: string[];
  /**
   * The `config` name as written, where a declaration wrote the bare form
   * and the path it was read as holds no config. What the author typed is
   * what the report answers, rather than the directory it landed in.
   */
  bareName?: string;
  /** Playwright configs elsewhere in the tree named that, where any are. */
  namedElsewhere?: string[];
  /** Other suites' specs this config also collects, where it collects any. */
  alsoRuns?: { suite: string; spec: string }[];
  /** The settings at issue, for a problem about what a suite declares. */
  settings?: string[];
  /** Where each of those settings is read, for one read but not declared. */
  readIn?: { name: string; modules: string[] }[];
  /** The parts of a suite's settings lists this check could not read. */
  unreadable?: string[];
  /** Where its cases reach the environment, for a use nothing can follow. */
  handedOn?: EnvironmentUseProblem[];
  /** The workspace imports that reached no file, so nothing read them. */
  unresolvedImports?: WorkspaceImportProblem[];
  /** The imports of a file beside one of them that reached no file. */
  unresolvedLocalImports?: LocalImportProblem[];
}

/** Whether a workspace-relative path is a file, named exactly as given. */
function fileExists(root: string, relative: string): boolean {
  try {
    return statSync(path.join(root, relative)).isFile();
  } catch {
    return false;
  }
}
/**
 * What a setting the config module itself reads, declared neither way, is
 * reported as. Kept apart from a case's read because it is the worse of the
 * two: this is the module Playwright evaluates again in every worker.
 */
const CONFIG_READ_PROBLEM = "undeclared-config-setting" as const;

/**
 * The same, for a setting the module named as `globalSetup` reads. Kept
 * apart again because of what that module is: the one thing Playwright runs
 * before any spec loads, and the one that exists to stop the run naming
 * what it is missing. A setting it takes that nobody declared is that module
 * failing on a gap it was written to report.
 */
const SETUP_READ_PROBLEM = "undeclared-setup-setting" as const;

/**
 * What a read of a setting the suite states its cases never reach is
 * reported as, and what stating one and asking for it as well is. Kept apart
 * from an undeclared read because the answer to them is the opposite one: a
 * setting refused by name is not one to add to a list.
 */
const UNUSED_READ_PROBLEM = "unused-setting-read" as const;
const UNUSED_DECLARED_PROBLEM = "unused-setting-declared" as const;

/** What is wrong with one config's requirement wiring, or null when nothing. */
export function inspectConfig(
  root: string,
  config: string,
  declarations: readonly SuiteDeclaration[] = readWorkspaceDeclarations(root),
  packages: ReadonlyMap<string, WorkspacePackageEntry> = readWorkspacePackages(
    root,
  ),
  readHere: () => ReadonlySet<string> = settingsReadHere(root),
): ConfigProblem | null {
  const source = readFileSync(path.join(root, config), "utf8");
  const value = readGlobalSetupValue(source);
  if (value === null) return { config, kind: "missing" };

  const specifiers = stringLiterals(value);
  if (specifiers.length === 0) return { config, kind: "not-a-path", value };

  const configDir = path.dirname(config);
  const announced: string[] = [];
  const setupModules: string[] = [];
  let announces = false;
  for (const specifier of specifiers) {
    const resolved = resolveModule(root, configDir, specifier);
    if (resolved === null)
      return { config, kind: "unresolved", value, module: specifier };
    setupModules.push(resolved);
    const moduleSource = readFileSync(path.join(root, resolved), "utf8");
    const announcement = readAnnouncement(root, resolved, moduleSource);
    if (announcement.announces) announces = true;
    announced.push(...announcement.suites);
  }
  if (!announces) {
    // Every module it names loads without deciding anything.
    return {
      config,
      kind: "silent",
      value,
      module: specifiers[specifiers.length - 1]!,
    };
  }

  const claims = declarations.filter(
    (declaration) => declaration.config === config,
  );
  if (claims.length === 0) return { config, kind: "undeclared", value };
  if (claims.length > 1)
    return {
      config,
      kind: "claimed-twice",
      value,
      claimedBy: claims.map((claim) => claim.suite),
    };

  const claim = claims[0]!;
  const shared = {
    config,
    value,
    declaredSuite: claim.suite,
    spec: claim.spec,
  } as const;
  // Named exactly, not resolved: `moderation.spec.ts` renamed to
  // `moderation.spec.js` leaves the declaration, and the `testMatch` reading
  // it, pointing at a file that is not there.
  if (!fileExists(root, claim.spec))
    return { ...shared, kind: "declared-spec-missing" };
  if (!configRunsSpec(source, config, claim.spec))
    return { ...shared, kind: "spec-not-run" };
  if (!announced.includes(claim.suite))
    return { ...shared, kind: "wrong-suite", announcedSuites: announced };

  // Collecting its own spec is not the same as collecting only its own. A
  // `testMatch` broad enough to sweep up another suite's cases — or left out,
  // taking Playwright's default of every spec file in `testDir` — runs those
  // cases under this suite's settings, which are not the ones anything
  // demanded for them.
  const alsoRuns = declarations
    .filter(
      (declaration) =>
        declaration.config !== config &&
        fileExists(root, declaration.spec) &&
        configRunsSpec(source, config, declaration.spec),
    )
    .map((declaration) => ({
      suite: declaration.suite,
      spec: declaration.spec,
    }));
  if (alsoRuns.length > 0)
    return { ...shared, kind: "runs-other-suite", alsoRuns };

  // An `optional` entry saying nothing about what its setting costs this run
  // is answered before the comparisons below, which read the spec and
  // everything it imports: this one is the declaration by itself, and needs
  // nothing read. A list whose names cannot be read comes first even so —
  // that one is reported from the comparison, and a suite held to a list
  // nobody can see is the worse of the two to leave standing.
  if (claim.unreadable.length === 0 && claim.unsaid.length > 0)
    return {
      ...shared,
      kind: "unsaid-optional",
      settings: [...claim.unsaid],
    };

  // The same, for an `unused` entry about nothing. That entry is a refusal
  // of a read something here could otherwise make; a name no module of this
  // workspace reads and no suite asks for is one nothing could bring into
  // this spec's imports, so it refuses a read that cannot happen and reads
  // as protection this suite does not have. `E2E_CHAT_UR` would sit in the
  // list forever, and so would an entry outliving the setting it was written
  // about. Asked for by another suite is enough on its own: that suite's own
  // comparison holds it to being read, and the file it is read in can be one
  // this search does not reach — a package resolving into built output, say
  // — which is a stale `required` entry over there rather than a refusal of
  // nothing here.
  if (claim.unreadable.length === 0 && claim.unused.length > 0) {
    const askedForHere = new Set(
      declarations.flatMap((declaration) => [
        ...declaration.required,
        ...declaration.optional,
      ]),
    );
    const protectsNothing = claim.unused.filter(
      (name) => !askedForHere.has(name) && !readHere().has(name),
    );
    if (protectsNothing.length > 0)
      return {
        ...shared,
        kind: "unused-setting-unread",
        settings: protectsNothing,
      };
  }

  // The wiring above settles which list of settings this run is held to. It
  // says nothing about whether that list covers what the cases read, and an
  // undeclared read fails inside a case exactly the way a misrouted config
  // does. The config file is read for the same thing and its reads count as
  // this suite’s too: a `baseURL`, a reporter’s output file, a directory are
  // all settings this run takes, and undeclared there they are worse than a
  // case’s — the config module is evaluated again in every worker, so nothing
  // stops the run once and names them.
  //
  // So is the module the config names as `globalSetup`, which nothing above
  // reads for settings: it is reached by a string path rather than by an
  // import, so following the config's imports never arrives at it. A setting
  // it takes is as missing at run time as one a case takes, and worse placed
  // — it is read inside the very module written to stop the run naming what
  // this environment does not provide.
  const settings = compareDeclaredSettings(
    root,
    claim.spec,
    claim,
    packages,
    [
      { entry: config, kind: CONFIG_READ_PROBLEM },
      ...setupModules.map((module) => ({
        entry: module,
        kind: SETUP_READ_PROBLEM,
      })),
    ],
    // And the settings this suite states nothing it runs reaches. The
    // comparison above would report a read of one as undeclared, which is
    // answered by declaring it — `optional` in one line, and then every run
    // of this suite announcing a gap that is not one. That is what the entry
    // refuses, so the read is reported as itself instead.
    {
      settings: claim.unused,
      readKind: UNUSED_READ_PROBLEM,
      declaredKind: UNUSED_DECLARED_PROBLEM,
    },
  );
  return settings === null ? null : { ...shared, ...settings };
}

/** What a declaration states about the settings its own files may read. */
export interface DeclaredSettings {
  /** Settings it stops the run for, resolved to plain names. */
  readonly required: readonly string[];
  /** Settings it states those files read without the run needing them. */
  readonly optional: readonly string[];
  /** Parts of those two lists that are not plain names this check can read. */
  readonly unreadable: readonly string[];
}

/**
 * Two lists of imports that reached no file as one, keeping the order they
 * were found in and reporting an import reached from both the spec and the
 * config once.
 */
function mergeUnresolved<T extends LocalImportProblem>(
  ...lists: readonly T[][]
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const entry of lists.flat()) {
    const key = `${entry.module}|${entry.specifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}
const WHY = [
  "Why: a browser suite that cannot reach its settings used to skip itself, and a",
  "skipped check reports the same green as a passing one — which is how the run",
  "made before publishing could verify none of what it claims to. Each config",
  `therefore points ${GLOBAL_SETUP_KEY} at a module calling ${ANNOUNCE_FUNCTION}(),`,
  "which fails the run naming the settings it is missing, or says out loud what a",
  `deliberately waived run (${"BROWSER_TESTS"}=skip) is leaving out. Playwright runs`,
  `${GLOBAL_SETUP_KEY} once, in the run's own process, before any spec file loads;`,
  "the config module itself is evaluated again in every worker, so a decision made",
  "there prints once per worker and fails as a worker crash instead of as the",
  "run's reason for stopping.",
  "",
  "It has to be that config's own suite, too. These configs are copied from one",
  "another, and one left pointing at the original's requirement module asks for",
  "the wrong suite's settings: it would start a run that then fails somewhere",
  "inside a case, reading as a broken product rather than a missing setting. File",
  `names do not settle it — ${DECLARATION_DIR}/playwright.config.ts runs`,
  "banned-room.spec.ts — so every suite names its own `config` and `spec` in",
  `${REQUIREMENT_MODULE},`,
  "which is where a person reads which config runs which spec for which suite.",
  "",
  "Being wired to its own suite is not the same as that suite asking for the",
  "right settings. A case reading E2E_API_URL under a suite requiring only",
  "E2E_CHAT_URL passes every wiring rule above and still fails inside the case,",
  "for a setting nothing said was missing — the same failure, reached from the",
  `settings side. So each suite's spec, the fixtures it imports, and the workspace`,
  `packages those import in turn are read for what they take out of process.env,`,
  `and every name found has to appear in that suite's \`${REQUIRED_KEY}\` or, where a`,
  `run really may go without it, in its \`${OPTIONAL_KEY}\`. Which of the two it is`,
  "cannot be read off the code, so it is stated, and an unstated read fails.",
  "",
  "The config file is read for the same thing, and what it reads is that suite's",
  "too: a baseURL, a reporter's output file, a directory. Undeclared there it is",
  "the worse of the two, because this is the one module Playwright evaluates in",
  `the run's own process and again in every worker — nothing stops the run once`,
  "naming it, and what an absent value does to the config happens per worker.",
  "",
  `So is the module it names as ${GLOBAL_SETUP_KEY}, which no import leads to: the`,
  "config names it as a string path, the way Playwright loads it. A setting read",
  "there is as missing at run time as one read in a case, and read in the module",
  "written to stop the run naming exactly that.",
  "",
  "A file reaches a setting without naming it, too. `assertDevelopment(process.env)`",
  "hands the whole environment to a helper, and a setting that helper reads is as",
  "missing at run time as one read here — so a handoff is followed into the",
  "function it names, and on through what that function hands the same",
  "environment to, with everything read that way counted as this suite's. A",
  "handoff this check cannot follow is reported rather than passed over: a helper",
  "whose reads nobody can see is the same gap, one call further out. So is a read",
  "written as process.env[name], whose setting only has a name while the case",
  "runs, and so is an import of a package this workspace builds that reaches no",
  "file — everything inside that package goes unread with it. A path to a file",
  "beside the importing one that reaches nothing is reported the same way: a",
  "fixture renamed out from under the spec importing it takes its settings with",
  "it, and the run cannot be collected at all.",
  "",
  "A file may keep the environment in a local name first — `const env =",
  "process.env` — and read settings off that name or hand it on from there. The",
  "name is read as the environment itself, so writing a fixture that way asks",
  "nothing more of anybody. A name given another value as well, or exported for",
  "other files to use, is reported instead: what it holds then is not what this",
  "check followed to it.",
  "",
  "The comparison runs both ways, because a declaration nothing reads costs the",
  `same wasted trip. A \`${REQUIRED_KEY}\` entry no longer read stops the run before any`,
  `case loads and names a setting nobody here has to configure; an \`${OPTIONAL_KEY}\``,
  "entry no longer read widens what the suite may silently skip. Both fail.",
  "",
  `Each \`${OPTIONAL_KEY}\` entry states, as \`${OPTIONAL_LINE_KEY}\`, what this suite's cases do`,
  "without that setting, and the run prints that line beside the name of every one",
  "it went without. An entry stating no line, or a blank one, fails here: the name",
  "on its own reports that this run differs from a fully configured one without",
  "saying how, which leaves the reader to open the spec to find out whether it",
  "cost a case or nothing at all. What the line says is nobody's business here;",
  "that there is one is.",
  "",
  `A suite may also state, as \`${UNUSED_KEY}\`, a setting its cases are meant never to`,
  "reach: what a split leaves behind, where the code needing that setting was moved",
  "so this suite's spec no longer imports it. That one is held the other way round.",
  "A module in what the config runs reading it fails, naming the module that",
  `brought it back, and so does asking for the same setting as \`${REQUIRED_KEY}\` or`,
  `\`${OPTIONAL_KEY}\` — the one-line answer that would leave this run announcing a gap`,
  "it does not have. Removing the entry is how the rule ends, beside the reason it",
  "was written.",
  "",
  "That entry has to be about something, too, which is the same comparison in its",
  "third direction. A name no module of this workspace reads and no suite asks for",
  "refuses a read that nothing could make: the setting was renamed or retired, or",
  "the name was mistyped when the entry was written, and either way the line",
  "reads as protection the suite does not have. So it fails here as well, and the",
  "answer is to correct the name or to drop the entry.",
].join("\n");

/** The line naming what is wrong, in the reader's terms. */
function explain(problem: ConfigProblem): string {
  const suite = problem.declaredSuite ?? "its suite";
  switch (problem.kind) {
    case "missing":
      return `it names no ${GLOBAL_SETUP_KEY}, so nothing decides whether this run may go without those settings`;
    case "not-a-path":
      return `its ${GLOBAL_SETUP_KEY} is not a module path this check can follow`;
    case "unresolved":
      return `the ${GLOBAL_SETUP_KEY} module it names is not there`;
    case "silent":
      return `that module never calls ${ANNOUNCE_FUNCTION}() from ${REQUIREMENT_PACKAGE} (${REQUIREMENT_MODULE})`;
    case "undeclared":
      return `no ${SUITE_TYPE} in ${REQUIREMENT_MODULE} names this config, so nothing states which suite's settings the specs it runs need`;
    case "claimed-twice":
      return `${(problem.claimedBy ?? []).join(" and ")} both name this config, so which suite's settings its specs need is ambiguous`;
    case "declared-config-missing": {
      const bare = problem.bareName;
      if (bare === undefined)
        return `${suite} names this config in ${REQUIREMENT_MODULE}, and there is no such Playwright config here`;
      const elsewhere = problem.namedElsewhere ?? [];
      const named =
        elsewhere.length === 0
          ? "nothing anywhere else here is named that either"
          : `${elsewhere.join(" and ")} ${elsewhere.length === 1 ? "is" : "are"} named that`;
      return `${suite} names it \`${bare}\` in ${REQUIREMENT_MODULE}, and a name written that short is read in ${DECLARATION_DIR}/, where there is no such Playwright config — ${named}, and a suite whose config is outside ${DECLARATION_DIR} names it by its workspace-relative path`;
    }
    case "declared-spec-missing":
      return `${suite} names ${problem.spec} as the spec this config runs, and that file is not there`;
    case "spec-not-run":
      return `${suite} names ${problem.spec} as the spec this config runs, and this config's ${TEST_MATCH_KEY} does not collect it`;
    case "wrong-suite": {
      const announced = problem.announcedSuites ?? [];
      const said =
        announced.length === 0
          ? `it announces a suite that ${REQUIREMENT_MODULE} does not export`
          : `it announces ${[...new Set(announced)].join(" and ")}`;
      return `${said}, but the spec this config runs (${problem.spec}) is declared as ${suite}'s`;
    }
    case "runs-other-suite": {
      const swept = (problem.alsoRuns ?? [])
        .map((other) => `${other.spec} (${other.suite}'s)`)
        .join(", ");
      return `its ${TEST_MATCH_KEY} also collects ${swept}, so this run would carry those cases through on ${suite}'s settings rather than the ones declared for them`;
    }
    case "unreadable-settings":
      return `${suite}'s settings are not written as plain names this check can read (${(problem.unreadable ?? []).join("; ")}), so nothing holds the cases it runs to them`;
    case "unresolved-local-import": {
      const unresolved = problem.unresolvedLocalImports ?? [];
      const one = unresolved.length === 1;
      const named = [
        ...new Set(unresolved.map((entry) => entry.specifier)),
      ].join(", ");
      return `the files this config runs import ${named}, ${one ? "a path" : "paths"} naming no file here — so this run stops as Playwright collects the spec, and whatever ${one ? "that file read" : "those files read"} out of the environment is missing from what ${suite} is held to, where a \`${REQUIRED_KEY}\` entry only ${one ? "it read" : "they read"} reads as one to drop`;
    }
    case "unresolved-workspace-import": {
      const unresolved = problem.unresolvedImports ?? [];
      const one = unresolved.length === 1;
      const named = [
        ...new Set(unresolved.map((entry) => entry.package)),
      ].join(", ");
      return `the files this config runs import ${named}, ${one ? "a package" : "packages"} this workspace builds, by ${one ? "a specifier" : "specifiers"} reaching no file here — so whatever ${one ? "it reads" : "they read"} out of the environment is missing from what ${suite} is held to, and a \`${REQUIRED_KEY}\` entry only ${one ? "that package reads" : "those packages read"} would be reported here as one to drop`;
    }
    case "unreadable-environment": {
      const handed = problem.handedOn ?? [];
      const one = handed.length === 1;
      return `the files this config runs reach the environment in ${one ? "a place" : "places"} this check cannot follow to setting names, so whatever ${one ? "that reaches" : "those reach"} is read by this run without ${suite} having to declare it`;
    }
    case "undeclared-setting": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `the cases this config runs read ${names.join(", ")}, which ${suite} declares neither as \`${REQUIRED_KEY}\` nor as \`${OPTIONAL_KEY}\`, so this run starts and then fails inside a case for ${one ? "a setting nobody said was" : "settings nobody said were"} missing`;
    }
    case "undeclared-config-setting": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `this config reads ${names.join(", ")} as Playwright loads it, which ${suite} declares neither as \`${REQUIRED_KEY}\` nor as \`${OPTIONAL_KEY}\`, so a run without ${one ? "it" : "them"} is never stopped by ${GLOBAL_SETUP_KEY} and carries on into whatever this config makes of ${one ? "an absent value" : "absent values"} — in the run's own process and again in every worker`;
    }
    case "undeclared-setup-setting": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `its ${GLOBAL_SETUP_KEY} module reads ${names.join(", ")}, which ${suite} declares neither as \`${REQUIRED_KEY}\` nor as \`${OPTIONAL_KEY}\`, so the module written to stop this run naming what it is missing takes ${one ? "a setting" : "settings"} of its own that nothing checks — and a run without ${one ? "it" : "them"} goes as far as whatever that module makes of ${one ? "an absent value" : "absent values"}`;
    }
    case "unread-required": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${suite} requires ${names.join(", ")}, and nothing this config runs reads ${one ? "it" : "them"} any more, so a run without ${one ? "it" : "them"} stops before any case loads over ${one ? "a setting" : "settings"} nobody here needs`;
    }
    case "unread-optional": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${suite} states ${names.join(", ")} as \`${OPTIONAL_KEY}\`, and nothing this config runs reads ${one ? "it" : "them"} any more`;
    }
    case "unsaid-optional": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${suite} states ${names.join(", ")} as \`${OPTIONAL_KEY}\` with no \`${OPTIONAL_LINE_KEY}\` line, so a run going without ${one ? "it" : "them"} announces ${one ? "a bare name" : "bare names"} — that this run differs from a fully configured one, and nothing about what fell into the gap`;
    }
    case "unused-setting-read": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${suite} states ${names.join(", ")} as \`${UNUSED_KEY}\` — ${one ? "a setting" : "settings"} its cases are meant never to reach, for the reason written beside ${one ? "it" : "them"} in ${REQUIREMENT_MODULE} — and something this config now runs reads ${one ? "it" : "them"}, named below`;
    }
    case "unused-setting-declared": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${suite} states ${names.join(", ")} as \`${UNUSED_KEY}\` and asks for ${one ? "it" : "them"} in \`${REQUIRED_KEY}\` or \`${OPTIONAL_KEY}\` as well, so the suite says both that its cases never reach ${one ? "that setting" : "those settings"} and that they read ${one ? "it" : "them"}`;
    }
    case "unused-setting-unread": {
      const names = problem.settings ?? [];
      const one = names.length === 1;
      return `${suite} states ${names.join(", ")} as \`${UNUSED_KEY}\`, and no module in this workspace reads ${one ? "it" : "them"} and no suite asks for ${one ? "it" : "them"} — so no import could bring ${one ? "that read" : "those reads"} into this suite, and the entry protects nothing`;
    }
  }
}
export function formatProblems(problems: ConfigProblem[]): string {
  const lines = [
    `${problems.length} Playwright config${problems.length === 1 ? "" : "s"} in this workspace ${problems.length === 1 ? "is" : "are"} not wired to the settings ${problems.length === 1 ? "its own run needs" : "their own runs need"}:`,
    "",
  ];
  for (const problem of problems) {
    lines.push(`  ${problem.config}`);
    if (problem.value !== undefined) {
      lines.push(`      now: ${GLOBAL_SETUP_KEY}: ${problem.value}`);
    }
    if (problem.module !== undefined && problem.kind === "unresolved") {
      lines.push(`      looked for: ${problem.module}`);
    }
    lines.push(`      problem: ${explain(problem)}`);
    for (const read of problem.readIn ?? []) {
      lines.push(`      ${read.name} is read in: ${read.modules.join(", ")}`);
    }
    for (const handed of problem.handedOn ?? []) {
      lines.push(`      ${handed.module}: ${handed.use}`);
      lines.push(`          ${handed.reason}`);
    }
    for (const unresolved of [
      ...(problem.unresolvedLocalImports ?? []),
      ...(problem.unresolvedImports ?? []),
    ]) {
      lines.push(`      ${unresolved.module}: imports ${unresolved.specifier}`);
      lines.push(`          ${unresolved.reason}`);
    }
    lines.push(...fix(problem));
  }
  return lines.join("\n");
}

export function checkWorkspace(root: string): string | null {
  if (resolveModule(root, ".", REQUIREMENT_MODULE) === null) {
    return [
      `${REQUIREMENT_MODULE} is no longer there.`,
      "",
      `Every browser config's ${GLOBAL_SETUP_KEY} module announces this run's`,
      `decision through ${ANNOUNCE_FUNCTION}() in that file, importing it as`,
      `${REQUIREMENT_PACKAGE}. Restore it, or name its new`,
      "path in scripts/src/checkBrowserTestRequirements.ts and in the modules",
      "that import it.",
      "",
      WHY,
    ].join("\n");
  }

  const configs = findPlaywrightConfigs(root);
  if (configs.length === 0) {
    return [
      "No Playwright config was found in this workspace.",
      "",
      "That is reported as a failure on purpose: a check with nothing to check",
      "passes exactly the way a compliant workspace does. Either the browser",
      "suites moved somewhere this search does not reach, in which case widen",
      "it in scripts/src/playwrightConfigs.ts, or they are gone and this check",
      "should go with them.",
      "",
      WHY,
    ].join("\n");
  }

  const declarations = readWorkspaceDeclarations(root);
  if (declarations.length === 0) {
    return [
      `No ${SUITE_TYPE} in ${REQUIREMENT_MODULE} names the config that runs it.`,
      "",
      "That is reported as a failure on purpose: with nothing declared, every",
      "config would be held to nothing and pass. Each suite names the config",
      `that runs it and the spec that config runs, as \`config\` and \`spec\``,
      `— the config by its bare name in ${DECLARATION_DIR}/, or by its`,
      "workspace-relative path anywhere else, and the spec as it sits beside",
      "whichever config that is. That is how a config pointed at another",
      "suite's requirement module is caught.",
      "",
      WHY,
    ].join("\n");
  }

  const found = new Set(configs);
  const problems: ConfigProblem[] = [];
  for (const declaration of declarations) {
    if (found.has(declaration.config)) continue;
    // A bare name is read in one directory, so a suite in another package
    // that writes one lands on a path nobody there ever created. The report
    // answers the name that was written, and names the config in the tree
    // that is called that, rather than a file missing from `DECLARATION_DIR`.
    const bare = bareName(declaration.configAsWritten);
    problems.push({
      config: declaration.config,
      kind: "declared-config-missing",
      declaredSuite: declaration.suite,
      spec: declaration.spec,
      ...(bare === null
        ? {}
        : {
            bareName: bare,
            namedElsewhere: configs.filter(
              (candidate) => path.posix.basename(candidate) === bare,
            ),
          }),
    });
  }
  const packages = readWorkspacePackages(root);
  // Read once for the whole run rather than once per config, and only if a
  // config asks: an `unused` entry naming a setting some suite declares is
  // answered without reading anything.
  const readHere = settingsReadHere(root);
  for (const config of configs) {
    const problem = inspectConfig(
      root,
      config,
      declarations,
      packages,
      readHere,
    );
    if (problem !== null) problems.push(problem);
  }
  if (problems.length === 0) return null;

  problems.sort((left, right) => left.config.localeCompare(right.config));
  return [formatProblems(problems), WHY].join("\n");
}

export interface Announcement {
  /**
   * Whether this module announces the run's decision at all: it has to import
   * `announceBrowserTests` from the shared requirement module — not from a
   * local file that happens to export the same name — and call it.
   */
  readonly announces: boolean;
  /**
   * The suites it announces, named as the shared module exports them. A suite
   * built inside the module, rather than imported from there, is not one of
   * them: only the shared module's declaration says what a suite needs.
   */
  readonly suites: readonly string[];
}

/**
 * The directory a config collects spec files from: the `testDir` it names,
 * which Playwright resolves against the config's own directory and which
 * defaults to that directory. Only a plain string is read — a `testDir` built
 * at run time is taken as the config's own directory, the wider of the two.
 */
export function configTestDir(config: string, source: string): string {
  const base = path.posix.dirname(toPosix(config));
  const named = stringLiterals(
    readConfigValues(source, TEST_DIR_KEY)[0] ?? "",
  )[0];
  return named === undefined
    ? base
    : path.posix.normalize(path.posix.join(base, named));
}
/**
 * Whether a config collects the named spec file. A config reaches only what
 * is under its `testDir`, so a spec in another package is not collected by
 * this one however broad its `testMatch` is. Playwright matches `testMatch`
 * against a file's path, so the bare name, the path within `testDir`, and the
 * workspace-relative path are all offered; a config naming no `testMatch`
 * collects Playwright's default, which is every `.spec.` and `.test.` file in
 * its `testDir`.
 */
export function configRunsSpec(
  source: string,
  config: string,
  spec: string,
): boolean {
  const dir = configTestDir(config, source);
  if (dir !== "." && !spec.startsWith(`${dir}/`)) return false;
  const candidates = [
    spec,
    dir === "." ? spec : spec.slice(dir.length + 1),
    spec.slice(spec.lastIndexOf("/") + 1),
  ];
  const values = readConfigValues(source, TEST_MATCH_KEY);
  if (values.length === 0)
    return candidates.some((candidate) => DEFAULT_TEST_MATCH.test(candidate));

  return values.some((value) => {
    const patterns = [
      ...regexLiterals(value),
      ...stringLiterals(value).map(globToRegExp),
    ];
    return patterns.some((pattern) =>
      candidates.some((candidate) => pattern.test(candidate)),
    );
  });
}

/**
 * The suite declarations in the shared requirement module: which config runs
 * each suite and which spec that config runs. A declaration that does not
 * name both as plain strings is not read, and the config it meant is reported
 * as one nothing claims.
 */
export function readSuiteDeclarations(source: string): SuiteDeclaration[] {
  const code = stripComments(source);
  const lists = readListExpressions(code);
  const declarations: SuiteDeclaration[] = [];
  const headers = code.matchAll(
    new RegExp(
      `\\bexport\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*${SUITE_TYPE}\\s*=\\s*\\{`,
      "g",
    ),
  );
  for (const header of headers) {
    // Read from just inside the opening brace: `readObjectEntry` stops at the
    // brace closing it, so one declaration never borrows the next one's.
    const body = code.slice(header.index + header[0].length);
    const config = stringLiterals(readObjectEntry(body, "config") ?? "")[0];
    const spec = stringLiterals(readObjectEntry(body, "spec") ?? "")[0];
    if (!config || !spec) continue;
    const requiredEntry = readObjectEntry(body, REQUIRED_KEY);
    const required =
      requiredEntry === null
        ? { names: [], unreadable: [`no \`${REQUIRED_KEY}\` entry`] }
        : resolveSettingList(requiredEntry, lists);
    const optionalEntry = readObjectEntry(body, OPTIONAL_KEY);
    // A suite that states nothing optional is declaring nothing optional,
    // which is the ordinary case rather than something unreadable. Each
    // entry it does state is read for its line as well as its name, that
    // being the one of the two lists a run prints.
    const optional =
      optionalEntry === null
        ? { names: [], unreadable: [], unsaid: [] }
        : resolveNamedSettings(optionalEntry, lists, OPTIONAL_LINE_KEY);
    // The same for the settings a suite states its cases never reach: most
    // suites state none, and the entries are written the same way, so they
    // are read by the same reader. Its prose is the reason they are refused,
    // written for whoever hits that failure rather than printed by a run, so
    // no line is asked of it here.
    const unusedEntry = readObjectEntry(body, UNUSED_KEY);
    const unused =
      unusedEntry === null
        ? { names: [], unreadable: [], unsaid: [] }
        : resolveNamedSettings(unusedEntry, lists);
    const configPath = declaredPath(config);
    declarations.push({
      suite: header[1]!,
      config: configPath,
      configAsWritten: declaredName(config),
      // Beside the config that runs it, which is this workspace's suite
      // directory for a config named there and the declaring package's own
      // directory for one anywhere else. Playwright collects a spec from the
      // config's `testDir`, which defaults to that same directory, so a bare
      // name read anywhere else names a file that config could not run.
      spec: declaredPath(spec, path.posix.dirname(configPath)),
      required: required.names,
      optional: optional.names,
      unsaid: optional.unsaid,
      unused: unused.names,
      unreadable: [
        ...required.unreadable.map((part) => `${REQUIRED_KEY}: ${part}`),
        ...optional.unreadable.map((part) => `${OPTIONAL_KEY}: ${part}`),
        ...unused.unreadable.map((part) => `${UNUSED_KEY}: ${part}`),
      ],
    });
  }
  return declarations;
}

/** The index of the bracket closing the one at `open`, or -1. */
function matchingBracket(code: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  for (let index = open; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** An expression split at its own commas, ignoring nested ones and strings. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      current += char;
      if (char === "\\") {
        current += text[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** A whole expression that is one string literal and nothing else. */
const WHOLE_STRING = /^(["'])(?:[^"'\\\n]|\\.)*\1$/;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Every `const NAME = [ ... ]` in a module, as the array expression it is
 * given. Kept unresolved so a list spreading another one can be read through
 * whichever order the two are written in.
 */
export function readListExpressions(code: string): Map<string, string> {
  const lists = new Map<string, string>();
  const pattern =
    /(?:^|[\s;])(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]*?)?=\s*\[/g;
  for (
    let match = pattern.exec(code);
    match !== null;
    match = pattern.exec(code)
  ) {
    const open = match.index + match[0].length - 1;
    const close = matchingBracket(code, open);
    if (close === -1) continue;
    lists.set(match[1]!, code.slice(open, close + 1));
    pattern.lastIndex = close;
  }
  return lists;
}

/**
 * A settings list as the plain names it holds, plus whatever in it is not a
 * plain name. String literals are read as themselves and a spread of a list
 * declared in the same module is read through; anything else — a call, a
 * template literal, a name from another module — comes back unreadable,
 * because a list this check cannot see holds the suite to nothing.
 */
export function resolveSettingList(
  expression: string,
  lists: ReadonlyMap<string, string>,
  seen: ReadonlySet<string> = new Set(),
): { names: string[]; unreadable: string[] } {
  const names: string[] = [];
  const unreadable: string[] = [];
  const text = expression.trim().replace(/\s+as\s+const$/, "");
  const elements =
    text.startsWith("[") && text.endsWith("]")
      ? splitTopLevel(text.slice(1, -1))
      : [text];

  for (const element of elements) {
    const item = (
      element.startsWith("...") ? element.slice(3) : element
    ).trim();
    if (WHOLE_STRING.test(item)) {
      names.push(stringLiterals(item)[0] ?? "");
      continue;
    }
    if (IDENTIFIER.test(item) && lists.has(item)) {
      if (seen.has(item)) continue; // a list spreading itself adds nothing
      const nested = resolveSettingList(
        lists.get(item)!,
        lists,
        new Set([...seen, item]),
      );
      names.push(...nested.names);
      unreadable.push(...nested.unreadable);
      continue;
    }
    unreadable.push(item);
  }
  return { names: [...new Set(names)], unreadable };
}

/**
 * A list of stated settings as the plain names it holds, plus whatever in it
 * is not one. `optional` and `unused` are both written this way: their
 * entries are not bare names, each stating a setting's `name` beside prose —
 * the line the run prints with it, or the reason these cases never reach it
 * — so each entry is read for that name and the prose is left to the reader
 * it is written for. Both lists are read here, rather than by a reader
 * apiece that could come to disagree about what an entry is. A spread of a
 * list of entries declared in the same module is read through, as `required`
 * reads a spread of names, and anything else — an entry built at run time,
 * or one whose `name` is not a plain string — comes back unreadable, because
 * a list this check cannot see holds the suite to nothing.
 *
 * `line` names a key an entry has to state something under, for the one list
 * whose prose a run prints: the names of the entries leaving it out come
 * back as `unsaid`, since a run going without one of those announces a bare
 * name. Nothing is asked of the wording, and a caller naming no key — an
 * `unused` list, whose reason is printed by no run — is held to none of it.
 */
export function resolveNamedSettings(
  expression: string,
  lists: ReadonlyMap<string, string>,
  line: string | null = null,
  seen: ReadonlySet<string> = new Set(),
): { names: string[]; unreadable: string[]; unsaid: string[] } {
  const names: string[] = [];
  const unreadable: string[] = [];
  const unsaid: string[] = [];
  const text = expression.trim().replace(/\s+as\s+const$/, "");
  const elements =
    text.startsWith("[") && text.endsWith("]")
      ? splitTopLevel(text.slice(1, -1))
      : [text];

  for (const element of elements) {
    const item = (
      element.startsWith("...") ? element.slice(3) : element
    ).trim();
    if (item.startsWith("{") && item.endsWith("}")) {
      // From just inside the brace, which is where `readObjectEntry` reads.
      const body = item.slice(1);
      const named = readObjectEntry(body, OPTIONAL_NAME_KEY) ?? "";
      if (!WHOLE_STRING.test(named.trim())) {
        unreadable.push(item);
        continue;
      }
      const name = stringLiterals(named)[0] ?? "";
      names.push(name);
      // Only where a caller asked for one, and only of an entry whose name
      // could be read: a report about a line has to be able to say which
      // setting it is about.
      if (line !== null && !statesSomething(readObjectEntry(body, line)))
        unsaid.push(name);
      continue;
    }
    if (IDENTIFIER.test(item) && lists.has(item)) {
      if (seen.has(item)) continue; // a list spreading itself adds nothing
      const nested = resolveNamedSettings(
        lists.get(item)!,
        lists,
        line,
        new Set([...seen, item]),
      );
      names.push(...nested.names);
      unreadable.push(...nested.unreadable);
      unsaid.push(...nested.unsaid);
      continue;
    }
    unreadable.push(item);
  }
  return {
    names: [...new Set(names)],
    unreadable,
    unsaid: [...new Set(unsaid)],
  };
}

/**
 * Whether an entry's prose says anything: the text of a literal, with
 * whitespace taken off. An absent key says nothing, and so does `""` or a
 * line of spaces — both print the way no entry at all prints, a name with
 * nothing beside it.
 *
 * An expression this cannot read comes back as saying something. What a
 * line holds is prose for the run's reader, and a value built anywhere else
 * is not something this check can weigh: the entries it is written for
 * state their line where it can be read, and refusing the rest would be
 * refusing a shape rather than the gap this is about.
 */
function statesSomething(value: string | null): boolean {
  if (value === null) return false;
  const text = value.trim();
  if (WHOLE_STRING.test(text))
    return (stringLiterals(text)[0] ?? "").trim() !== "";
  // A template holding nothing but its own text is read the same way; one
  // with a substitution in it is a value this cannot see.
  if (/^`[^`$\\]*`$/.test(text)) return text.slice(1, -1).trim() !== "";
  return text !== "";
}
/**
 * The value of `key` in an object body, reading from just after its opening
 * brace and stopping at the brace that closes it. Only entries of that object
 * count: a key of the same name nested inside one of its values, or written
 * inside a string, is not this object's.
 */
export function readObjectEntry(body: string, key: string): string | null {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) {
      depth += 1;
      continue;
    }
    if (")]}".includes(char)) {
      if (depth === 0) break; // this object ended
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (!body.startsWith(key, index)) continue;
    if (index > 0 && !/[\s{,;(]/.test(body[index - 1]!)) continue;
    const colon = /^\s*:/.exec(body.slice(index + key.length));
    if (!colon) continue;
    return readValueFrom(body, index + key.length + colon[0].length).value;
  }
  return null;
}

/**
 * One place a file hands the whole environment to a function instead of
 * reading a name out of it: `assertDevelopment(process.env)`, or the
 * `env: process.env` a call is given inside an options object.
 */
export interface EnvironmentHandoff {
  /** The function it is handed to, as written. */
  readonly callee: string;
  /** Which of that call's arguments carries it, counting from zero. */
  readonly argument: number;
  /** The key it arrives under, or null where it is the argument itself. */
  readonly property: string | null;
  /** The line it is written on, so a report can point at it. */
  readonly use: string;
}

/** A use of the whole environment whose settings cannot be determined. */
export interface UnreadableUse {
  /** The line it is written on, with comments already removed. */
  readonly use: string;
  /** Why what it reaches cannot be read. */
  readonly reason: string;
  /**
   * Whether the environment is handed on here by a spread of the whole of
   * it, rather than read by a name or given to a function this check can
   * name. A spread carries everything the environment holds, so the only
   * question left about it is where it goes — which is why a caller that
   * knows the answer without reading it can account for one: a command
   * declaring the browser run it starts hands that run everything here, and
   * what the run reads is declared as a suite of its own and held to the
   * files that run loads.
   */
  readonly spread: boolean;
}

/** What one file does with the environment, read from its source. */
export interface EnvironmentUses {
  /** The settings it reads by name, sorted. */
  readonly names: string[];
  /** Where it hands the whole environment to a function. */
  readonly handoffs: EnvironmentHandoff[];
  /** Where it uses the whole environment in a way nothing can follow. */
  readonly unreadable: UnreadableUse[];
}

/** `process.env`, however it is spaced. */
const ENVIRONMENT = /process\s*\.\s*env\b/y;

/** One name or key as itself, with what a pattern reads specially escaped. */
function literally(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** One name as a pattern, matching uses of it and not names beginning with it. */
function usesOfName(name: string): RegExp {
  return new RegExp(`${literally(name)}(?![\\w$])`);
}

/**
 * One key read off a name, however the read is written — `options.env`,
 * `options?.env`, `options["env"]` — as a pattern. Where the name holds the
 * environment under that key, what those reach is the environment itself,
 * so their uses are scanned exactly as `process.env`'s are.
 */
function usesOfKey(name: string, key: string): RegExp {
  const held = literally(name);
  const under = literally(key);
  return new RegExp(
    `${held}\\s*(?:(?:\\?\\.|\\.)\\s*${under}(?![\\w$])|(?:\\?\\.)?\\s*\\[\\s*(?:"${under}"|'${under}')\\s*\\])`,
  );
}
/** A name read off it: `.NAME`, `?.NAME`, matched against what follows. */
const READ_PROPERTY = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/;

/** The same read as a subscript: `["NAME"]`, `?.["NAME"]`. */
const READ_SUBSCRIPT = /^\s*(?:\?\.)?\s*\[\s*(["'])([^"'\\]+)\1\s*\]/;

/**
 * A subscript that is not one of those: `process.env[someVariable]`, which
 * reads a setting whose name only exists while the case is running.
 */
const COMPUTED_SUBSCRIPT = /^\s*(?:\?\.)?\s*\[/;
/**
 * `const { A, B } = ` before a use, which reads A and B off it. Braces of
 * the pattern's own are read through once — the `{}` of a default written
 * beside a name, a name taken into a pattern of its own — so a pattern
 * holding one is read as the pattern it is rather than passed over as text
 * with no pattern in it at all.
 */
const DESTRUCTURED = /\{((?:[^{}]|\{[^{}]*\})*)\}\s*=\s*$/;

/** `(env = ` before a use: a parameter's default, handed on by nobody. */
const PARAMETER_DEFAULT = /[,(]\s*[A-Za-z_$][\w$]*\s*(?::[^=;]*)?=\s*$/;

/** `const env = ` before a use: the local name it is being kept under. */
const ALIAS_DECLARATION =
  /(?:^|[\s;{}()])(?:const|let|var)\s+([A-Za-z_$][\w$]*)(\s*(?::[^=;]*)?=\s*)$/;

/** `export` in front of that declaration, putting the name beyond this file. */
const EXPORTED_DECLARATION = /\bexport\s+(?:const|let|var)\s+$/;

/**
 * What may follow the use and still leave that name holding the environment
 * and nothing else: the declaration ends there, give or take the assertions
 * TypeScript allows on its value.
 */
const ALIAS_TAIL = /^\s*(?:!\s*)?(?:as\s+[^;,\n]+)?(?:[;,\n]|$)/;

/** `env = ` at a use of that name: it is being given something else. */
const REASSIGNED = /^\s*=(?![=>])/;

/** How much of the text before a use is read for the shapes above. */
const CONTEXT = 500;

/** Words that take a parenthesis without being a function called here. */
const NOT_A_CALLEE = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "typeof",
  "await",
  "yield",
  "delete",
  "void",
  "in",
  "of",
  "do",
  "else",
  "case",
  "new",
  "throw",
  "function",
  "import",
  "export",
  "const",
  "let",
  "var",
]);

/** One bracket a use is written inside, or a template literal's `${}` hole. */
interface Bracket {
  kind: "(" | "{" | "[" | "hole";
  /** Where the bracket opens, so what is written in front of it can be read. */
  readonly index: number;
  /** For a `(`, the name in front of it; null where there is none. */
  readonly callee: string | null;
  /** Commas at this bracket's own level, counted up to the use. */
  commas: number;
}

type Frame = Bracket | { kind: "string"; quote: '"' | "'" | "`" };

/** One place an expression is used, with the brackets around it. */
interface Use {
  /** Where it starts in the code scanned. */
  readonly index: number;
  /** The text matched, so a binding's own name is known to the reader. */
  readonly text: string;
  /** The brackets enclosing it, outermost first. */
  readonly frames: Bracket[];
}

/** Whether what is written just before here is a spread's `...`. */
function spreadBefore(code: string, index: number): boolean {
  let at = index;
  while (at > 0 && /\s/.test(code[at - 1]!)) at -= 1;
  return at >= 3 && code.startsWith("...", at - 3);
}
/** Whether a `/` here opens a regular expression rather than dividing. */
function opensRegex(previous: string): boolean {
  return previous === "" || "(,=:[!&|?{};+-*%~^<>".includes(previous);
}

/** The length of the regular expression literal starting here, or 0. */
function regexLength(code: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < code.length) {
    const char = code[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "\n") return 0; // not a literal after all
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return index + 1 - start;
    index += 1;
  }
  return 0;
}

/**
 * Every use of one expression in a file, with the brackets around it — which
 * is what tells `assertDevelopment(process.env)` from `{ env: process.env }`,
 * and both from a `process.env` written inside a string, which is not a use
 * at all. Strings, template holes and regular expressions are tracked rather
 * than matched, so a name mentioned in a message is never read as a setting.
 */
function scanUses(code: string, pattern: RegExp): Use[] {
  const sticky = new RegExp(pattern.source, "y");
  const uses: Use[] = [];
  const stack: Frame[] = [];
  let previous = "";
  let index = 0;
  while (index < code.length) {
    const top = stack[stack.length - 1];
    const char = code[index]!;
    if (top?.kind === "string") {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === top.quote) {
        stack.pop();
        previous = char;
        index += 1;
        continue;
      }
      if (top.quote === "`" && char === "$" && code[index + 1] === "{") {
        stack.push({ kind: "hole", index: index + 1, callee: null, commas: 0 });
        previous = "{";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      stack.push({ kind: "string", quote: char });
      index += 1;
      continue;
    }
    if (char === "/" && opensRegex(previous)) {
      const length = regexLength(code, index);
      if (length > 0) {
        previous = "/";
        index += length;
        continue;
      }
    }
    sticky.lastIndex = index;
    const match = sticky.exec(code);
    if (match !== null && startsAUse(code, index, previous)) {
      uses.push({
        index,
        text: match[0],
        frames: stack
          .filter((frame): frame is Bracket => frame.kind !== "string")
          .map((frame) => ({ ...frame })),
      });
      previous = match[0].slice(-1);
      index += match[0].length;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      stack.push({
        kind: char,
        index,
        callee: char === "(" ? calleeBefore(code, index) : null,
        commas: 0,
      });
    } else if (char === ")" || char === "}" || char === "]") {
      stack.pop();
    } else if (char === ",") {
      if (top) top.commas += 1;
    }
    if (!/\s/.test(char)) previous = char;
    index += 1;
  }
  return uses;
}

/**
 * The function name in front of a `(`, or null where the parenthesis opens
 * something else: a grouping, a parameter list, or a keyword's condition.
 */
function calleeBefore(code: string, open: number): string | null {
  let end = open;
  while (end > 0 && /\s/.test(code[end - 1]!)) end -= 1;
  let start = end;
  while (start > 0 && /[\w$.]/.test(code[start - 1]!)) start -= 1;
  const name = code.slice(start, end);
  if (name === "" || /^[\d.]/.test(name)) return null;
  if (NOT_A_CALLEE.has(name)) return null;
  const before = code.slice(Math.max(0, start - 40), start).trimEnd();
  // `function name(` and `new Name(` are declarations and constructions, not
  // calls to a function whose parameter this check can find.
  if (/\b(?:function|new|class)\s*\*?$/.test(before)) return null;
  return name;
}

/** The line an index falls on, collapsed to one line for a report. */
function sourceLine(code: string, index: number): string {
  const start = code.lastIndexOf("\n", index) + 1;
  const end = code.indexOf("\n", index);
  const line = code
    .slice(start, end === -1 ? code.length : end)
    .trim()
    .replace(/\s+/g, " ");
  return line.length > 88 ? `${line.slice(0, 87)}…` : line;
}

/**
 * The key a use arrives under inside an object literal — `env: process.env`,
 * the shorthand `{ env }`, or a spread, which hands the whole object on and
 * so arrives as the argument itself. Null where the key cannot be read.
 */
function keyBefore(code: string, use: Use): { property: string | null } | null {
  if (spreadBefore(code, use.index)) return { property: null };
  const before = code.slice(Math.max(0, use.index - CONTEXT), use.index);
  const trimmed = before.replace(/\s+$/, "");
  if (trimmed.endsWith(":")) {
    const key =
      /(?:^|[{,])\s*(?:([A-Za-z_$][\w$]*)|"([^"]*)"|'([^']*)')\s*:$/.exec(
        trimmed,
      );
    if (key === null) return null; // a computed key, or not a key at all
    return { property: key[1] ?? key[2] ?? key[3]! };
  }
  // A shorthand property is the binding's own name, standing alone.
  if (!IDENTIFIER.test(use.text)) return null;
  const opener = trimmed.slice(-1);
  if (opener !== "{" && opener !== ",") return null;
  const after = code.slice(use.index + use.text.length).replace(/^\s+/, "");
  if (!after.startsWith(",") && !after.startsWith("}")) return null;
  return { property: use.text };
}

/** One local name a file keeps the whole environment under. */
interface EnvironmentAlias {
  /** The name it is kept under. */
  readonly name: string;
  /** Whether other modules read it too, which this file does not show. */
  readonly exported: boolean;
  /**
   * The key of that name's own object it sits under, where the name holds
   * an object keeping it rather than the environment itself. Null where a
   * use of the name is a use of the environment.
   */
  readonly property: string | null;
}

/**
 * The local name a use is being stored under — `const env = process.env` —
 * or null where it is not being stored at all. Only a declaration whose
 * value ends there counts: a name given the environment mixed with anything
 * else holds something this check has not read.
 */
function readAlias(code: string, use: Use): EnvironmentAlias | null {
  const start = Math.max(0, use.index - CONTEXT);
  const declaration = ALIAS_DECLARATION.exec(code.slice(start, use.index));
  if (declaration === null) return null;
  if (!ALIAS_TAIL.test(code.slice(use.index + use.text.length))) return null;
  const name = declaration[1]!;
  const at = use.index - declaration[2]!.length - name.length;
  return {
    name,
    exported: EXPORTED_DECLARATION.test(code.slice(start, at)),
    property: null,
  };
}

/**
 * The local name a use is being collected into — `const settings = { ...
 * process.env, BROWSER_TESTS: "1" }` — or null where the use is not being
 * collected into one at all. Everything the environment holds goes into that
 * object, so every later use of the name reaches the same settings a use of
 * the environment does, and a fixture may build its settings a step before
 * the call it hands them to.
 *
 * Only a declaration the object is the whole value of counts, and only one
 * spread into it: a second spread puts values this check has not read under
 * names it cannot tell from the environment's own, which is a reason the
 * caller reports rather than an object to follow.
 */
function readCollected(
  code: string,
  use: Use,
): EnvironmentAlias | string | null {
  if (!spreadBefore(code, use.index)) return null;
  const object = use.frames[use.frames.length - 1];
  if (object === undefined || object.kind !== "{") return null;
  const start = Math.max(0, object.index - CONTEXT);
  const declaration = ALIAS_DECLARATION.exec(code.slice(start, object.index));
  if (declaration === null) return null;
  const close = matchingBracket(code, object.index);
  if (close === -1) return null;
  if (!ALIAS_TAIL.test(code.slice(close + 1))) return null;
  const name = declaration[1]!;
  const spreads = splitTopLevel(code.slice(object.index + 1, close)).filter(
    (entry) => entry.startsWith("..."),
  );
  if (spreads.length > 1)
    return `${name} is built from more than the environment, so which of what it holds came from there cannot be read from here`;
  const at = object.index - declaration[2]!.length - name.length;
  return {
    name,
    exported: EXPORTED_DECLARATION.test(code.slice(start, at)),
    property: null,
  };
}

/**
 * The key one entry of an object literal is written under: `env: value`,
 * the shorthand `env`, or either of those quoted. Null where what it is
 * written under is not a plain name this check can read — a computed key, a
 * method, a getter — which is a key it cannot tell from any other.
 */
function entryKey(entry: string): string | null {
  const key = /^(?:([A-Za-z_$][\w$]*)|"([^"]*)"|'([^']*)')\s*(?::|$)/.exec(
    entry,
  );
  return key === null ? null : (key[1] ?? key[2] ?? key[3]!);
}
/**
 * The local name a use is being kept under a key of — `const options = {
 * env: process.env, now: Date.now() };` — with the key it is kept under, or
 * null where the use is not being kept in one at all. What that name holds
 * is not the environment but an object carrying it, so the key travels with
 * the name: handing the name on hands the environment on under that key,
 * exactly as writing the same object in the call's own arguments would, and
 * reading that key reaches the environment itself.
 *
 * Only a declaration the object is the whole value of counts, as for a name
 * collected from a spread, and only an object whose own keys this check can
 * read: a spread into it, a key built while the case runs, or a second entry
 * under the same key may put something else where the environment was
 * written, which is a reason the caller reports rather than an object to
 * follow.
 */
function readKeyed(code: string, use: Use): EnvironmentAlias | string | null {
  const object = use.frames[use.frames.length - 1];
  if (object === undefined || object.kind !== "{") return null;
  const key = keyBefore(code, use);
  if (key === null || key.property === null) return null;
  const start = Math.max(0, object.index - CONTEXT);
  const declaration = ALIAS_DECLARATION.exec(code.slice(start, object.index));
  if (declaration === null) return null;
  const close = matchingBracket(code, object.index);
  if (close === -1) return null;
  if (!ALIAS_TAIL.test(code.slice(close + 1))) return null;
  const name = declaration[1]!;
  const under = key.property;
  const entries = splitTopLevel(code.slice(object.index + 1, close));
  if (entries.some((entry) => entry.startsWith("...")))
    return `${name} is built from more than the keys written in it, so whether ${under} still holds the environment where it is used cannot be read from here`;
  const keys = entries.map(entryKey);
  if (keys.some((written) => written === null))
    return `${name} holds a key this check cannot read as a plain name, so whether it is a second ${under} cannot be read from here`;
  if (keys.filter((written) => written === under).length > 1)
    return `${name} is given ${under} more than once, so what it holds there cannot be read from here`;
  const at = object.index - declaration[2]!.length - name.length;
  return {
    name,
    exported: EXPORTED_DECLARATION.test(code.slice(start, at)),
    property: under,
  };
}

/**
 * The local name a use is being kept under, every way a file may keep it:
 * given the environment itself, given an object spread from it, or given an
 * object holding it under one of that object's keys. Null where it is being
 * kept under no name, and a reason where the name holds something this
 * check cannot read as the environment.
 */
function readStored(code: string, use: Use): EnvironmentAlias | string | null {
  return (
    readAlias(code, use) ?? readCollected(code, use) ?? readKeyed(code, use)
  );
}

/** Where a whole-environment use is handed to, or why that cannot be read. */
function readHandoff(code: string, use: Use): EnvironmentHandoff | string {
  const line = sourceLine(code, use.index);
  const inner = use.frames[use.frames.length - 1];
  if (inner === undefined || inner.kind === "hole" || inner.kind === "[")
    return "it is not handed to a function this check can name";
  if (inner.kind === "(") {
    if (inner.callee === null)
      return "it is not handed to a function this check can name";
    // Spread into the argument list itself, the arguments it becomes are
    // whatever it holds while the case runs, so no parameter of that
    // function is the one it arrives at.
    if (spreadBefore(code, use.index))
      return `it is spread across ${inner.callee}'s arguments, so which parameter it arrives at cannot be read from here`;
    return {
      callee: inner.callee,
      argument: inner.commas,
      property: null,
      use: line,
    };
  }
  const call = use.frames[use.frames.length - 2];
  if (call === undefined || call.kind !== "(" || call.callee === null)
    return "it is put into an object this check cannot follow to a call";
  const key = keyBefore(code, use);
  if (key === null) return "the key it arrives under is not a plain name";
  return {
    callee: call.callee,
    argument: call.commas,
    property: key.property,
    use: line,
  };
}

/** What a pattern given a name does with one key of what that name holds. */
type PatternTake =
  /** It takes the key into this binding, which holds what sat there. */
  | { kind: "bound"; local: string }
  /** It takes other keys only, so nothing of that one is reached here. */
  | { kind: "elsewhere" }
  /** It cannot be read through to that key, for this reason. */
  | { kind: "unreadable"; reason: string };

/**
 * What a destructuring pattern does with the key a name holds the
 * environment under. Taking the key out leaves the binding it is taken into
 * holding the whole environment, exactly as an alias declaration would —
 * under whichever name the pattern renames it to, and past a default beside
 * it, which a key holding the environment never falls back to.
 *
 * A pattern this reading cannot see the key through is reported rather than
 * guessed at: an entry written under a key it cannot read as a plain name
 * may be this one, a rest binding sweeps the key up with everything the
 * pattern does not name, and a key taken twice leaves more bindings holding
 * the environment than this reading follows.
 */
function readPatternTake(
  pattern: string,
  name: string,
  key: string,
): PatternTake {
  const taken: string[] = [];
  let rest = false;
  for (const part of splitTopLevel(pattern)) {
    if (part.startsWith("...")) {
      rest = true;
      continue;
    }
    const entry = patternEntry(part);
    if (entry === null)
      return {
        kind: "unreadable",
        reason: `${part} takes a key this check cannot read as a plain name, so whether it is the ${key} ${name} holds the environment under cannot be read from here`,
      };
    if (entry.key === key) taken.push(entry.local);
  }
  if (taken.length > 1)
    return {
      kind: "unreadable",
      reason: `${key} is taken out of ${name} into ${taken.length} bindings at once here, and this check follows it out of a pattern into one`,
    };
  const local = taken[0];
  if (local !== undefined) return { kind: "bound", local };
  if (rest)
    return {
      kind: "unreadable",
      reason: `${key} is taken into the rest of ${name} bound here, along with everything else that pattern does not name, which this check does not follow`,
    };
  return { kind: "elsewhere" };
}

/** What one use of a name holding the environment under a key reaches. */
type KeyedUse =
  /** The key itself, whose own uses are scanned as the environment's are. */
  | { kind: "read" }
  /** Something else that object holds, which is not the environment at all. */
  | { kind: "elsewhere" }
  /** A call the environment arrives at under the key it is kept under. */
  | { kind: "handoff"; handoff: EnvironmentHandoff }
  /** A binding a pattern takes the key into, which holds the environment. */
  | { kind: "stored"; alias: EnvironmentAlias }
  /** Somewhere the key cannot be read through, for this reason. */
  | { kind: "unreadable"; reason: string };
/**
 * What one use of such a name reaches. Reading the key reaches the
 * environment, and is left to the scan of that read; reading any other key
 * of the same object reaches something this check was never looking for.
 * Handing the name to a function hands the environment to it under the key,
 * which is the handoff an options object written in the call's own
 * arguments already is. A pattern taking the key out of the name binds the
 * whole environment to a name of its own, which is read on as the alias it
 * is.
 *
 * Everywhere else the key cannot be read through, and is reported rather
 * than guessed at: a key built while the case runs may be this one, a
 * pattern this reading cannot see the key through may put it anywhere, and
 * a name arriving under a further key of some other object puts the
 * environment a level deeper than a parameter can be read at.
 */
function readKeyedUse(
  code: string,
  use: Use,
  name: string,
  key: string,
): KeyedUse {
  const after = code.slice(use.index + use.text.length);
  const property = READ_PROPERTY.exec(after);
  if (property !== null)
    return property[1] === key ? { kind: "read" } : { kind: "elsewhere" };
  const subscript = READ_SUBSCRIPT.exec(after);
  if (subscript !== null)
    return subscript[2] === key ? { kind: "read" } : { kind: "elsewhere" };
  if (COMPUTED_SUBSCRIPT.test(after))
    return {
      kind: "unreadable",
      reason: `the key it reads off ${name} is built while the case runs, so whether that is the ${key} it holds the environment under cannot be read from this file`,
    };
  const before = code.slice(Math.max(0, use.index - CONTEXT), use.index);
  const destructured = DESTRUCTURED.exec(before);
  if (destructured !== null) {
    const taken = readPatternTake(destructured[1]!, name, key);
    if (taken.kind !== "bound") return taken;
    const at = use.index - before.length + destructured.index;
    return {
      kind: "stored",
      alias: {
        name: taken.local,
        exported: EXPORTED_DECLARATION.test(
          code.slice(Math.max(0, use.index - CONTEXT), at),
        ),
        property: null,
      },
    };
  }
  // A parameter's own default is handed to it by nobody.
  if (PARAMETER_DEFAULT.test(before)) return { kind: "elsewhere" };
  const handoff = readHandoff(code, use);
  if (typeof handoff === "string")
    return { kind: "unreadable", reason: handoff };
  if (handoff.property !== null)
    return {
      kind: "unreadable",
      reason: `${name} arrives at ${handoff.callee} under ${handoff.property}, so the environment it holds reaches ${handoff.property}.${key}, which this check does not follow`,
    };
  return { kind: "handoff", handoff: { ...handoff, property: key } };
}

/**
 * Whether a use is a name a pattern binds rather than a use of what that
 * name already holds: the `env` of `const { env } = options`, which is the
 * declaration the scan of that binding began at. What it reads is written
 * after it, and the `=` the pattern is given its value by would otherwise
 * read as the name being handed something else.
 */
function bindsAName(code: string, use: Use): boolean {
  const pattern = use.frames[use.frames.length - 1];
  if (pattern === undefined || pattern.kind !== "{") return false;
  const close = matchingBracket(code, pattern.index);
  // A `=` after the braces is what makes them a pattern being given a value
  // rather than an object being written.
  return close !== -1 && REASSIGNED.test(code.slice(close + 1));
}

/**
 * Whether a use is the key an object entry is written under rather than a
 * value: the `env` of `{ env: process.env }`, which says where the value
 * goes and reaches nothing itself. A name written in front of a `:`
 * somewhere else — a branch of a ternary, a label — is a use like any
 * other, so the brace around it and the `{` or `,` in front of it are what
 * tell the two apart.
 */
function namesAKey(code: string, use: Use): boolean {
  const object = use.frames[use.frames.length - 1];
  if (object === undefined || object.kind !== "{") return false;
  const before = code
    .slice(Math.max(0, use.index - CONTEXT), use.index)
    .replace(/\s+$/, "");
  const opener = before.slice(-1);
  if (opener !== "{" && opener !== ",") return false;
  return code
    .slice(use.index + use.text.length)
    .trimStart()
    .startsWith(":");
}

/** One expression whose uses are being collected, and what it holds. */
type Scan =
  /** The environment itself, however this file spells it. */
  | { kind: "environment"; pattern: RegExp; name: string | null }
  /** A name holding an object that keeps the environment under `property`. */
  | { kind: "keyed"; pattern: RegExp; name: string; property: string };

/** How a name holds the environment, for a report naming two ways at once. */
function heldAs(property: string | null): string {
  return property === null ? "as itself" : `under ${property}`;
}

/**
 * Every use of one expression in already comment-stripped code, sorted out.
 * A local name the expression is stored under, or collected into with a
 * spread, is scanned the same way, and on through a name stored from that
 * one, because every use of such a name is a use of the expression itself.
 * A name keeping it under a key is scanned twice over: once as the name,
 * whose uses hand the environment on under that key, and once as the key
 * read off it, whose uses are the environment's own.
 */
function collectUses(code: string, pattern: RegExp): EnvironmentUses {
  const names = new Set<string>();
  const handoffs: EnvironmentHandoff[] = [];
  const unreadable: UnreadableUse[] = [];
  const stored = new Map<string, string | null>();
  const scans: Scan[] = [{ kind: "environment", pattern, name: null }];
  /**
   * Take a name the environment has been given — declared, collected into
   * with a spread, kept under a key, or taken out of a pattern into a
   * binding of its own — and scan that name's uses too, since every use of
   * it is a use of what it holds.
   */
  const store = (alias: EnvironmentAlias, use: Use, spread: boolean): void => {
    if (alias.exported) {
      unreadable.push({
        use: sourceLine(code, use.index),
        reason: `${alias.name} leaves this module, and what other files read off it cannot be seen from here`,
        spread,
      });
      return;
    }
    const already = stored.get(alias.name);
    if (already === undefined) {
      stored.set(alias.name, alias.property);
      if (alias.property === null) {
        scans.push({
          kind: "environment",
          pattern: usesOfName(alias.name),
          name: alias.name,
        });
        return;
      }
      scans.push({
        kind: "keyed",
        pattern: usesOfName(alias.name),
        name: alias.name,
        property: alias.property,
      });
      scans.push({
        kind: "environment",
        pattern: usesOfKey(alias.name, alias.property),
        name: `${alias.name}.${alias.property}`,
      });
      return;
    }
    if (already !== alias.property)
      // One name, two ways of holding the environment: what a use of it
      // hands on is whichever of them reached that use, which is a question
      // about the order the file runs in rather than one this reading
      // answers.
      unreadable.push({
        use: sourceLine(code, use.index),
        reason: `${alias.name} is given the environment ${heldAs(already)} and ${heldAs(alias.property)}, so which of them a use of it hands on cannot be read from here`,
        spread,
      });
  };
  for (let scan = 0; scan < scans.length; scan += 1) {
    const scanning = scans[scan]!;
    for (const use of scanUses(code, scanning.pattern)) {
      const after = code.slice(use.index + use.text.length);
      // A name written inside a pattern is the name that pattern binds, and
      // one written in front of a `:` inside an object is the key an entry
      // sits under. Neither reaches what the name holds elsewhere, and the
      // first is the declaration a scan of that binding started from.
      if (
        IDENTIFIER.test(use.text) &&
        (bindsAName(code, use) || namesAKey(code, use))
      )
        continue;
      // Carried onto every gap reported below: what a spread hands on is the
      // whole environment, which is the one shape a caller can account for
      // without this check following it.
      const spread = spreadBefore(code, use.index);
      // A name only holds the environment for as long as it holds nothing
      // else, so a name given another value is where following it stops —
      // read before anything below, so that a key given another value is
      // reported as that rather than as the read it is written like.
      if (
        (IDENTIFIER.test(use.text) || scanning.name !== null) &&
        REASSIGNED.test(after)
      ) {
        unreadable.push({
          use: sourceLine(code, use.index),
          reason: `${scanning.name ?? use.text} is given another value here, so what it holds from here on is not the environment`,
          spread,
        });
        continue;
      }
      // What a name holding the environment under a key reaches is that
      // object's, and the whole of it is handed on under the key rather
      // than as the argument itself. Nothing spread there is a spread of
      // the environment — it is the object keeping it — so a gap reported
      // from one is not a spread a declaration can answer for.
      if (scanning.kind === "keyed") {
        const keyed = readKeyedUse(
          code,
          use,
          scanning.name,
          scanning.property,
        );
        if (keyed.kind === "unreadable")
          unreadable.push({
            use: sourceLine(code, use.index),
            reason: keyed.reason,
            spread: false,
          });
        else if (keyed.kind === "handoff") handoffs.push(keyed.handoff);
        else if (keyed.kind === "stored") store(keyed.alias, use, false);
        continue;
      }
      const property = READ_PROPERTY.exec(after);
      if (property !== null) {
        names.add(property[1]!);
        continue;
      }
      const subscript = READ_SUBSCRIPT.exec(after);
      if (subscript !== null) {
        names.add(subscript[2]!);
        continue;
      }
      // A subscript that is not a literal reads a setting this check cannot
      // name. Passing it over would leave that setting out of what the suite
      // is seen to read, which is what the reverse comparison reports as a
      // `required` entry to drop.
      if (COMPUTED_SUBSCRIPT.test(after)) {
        unreadable.push({
          use: sourceLine(code, use.index),
          reason:
            "the name it reads is built while the case runs, so which setting that is cannot be read from this file",
          spread,
        });
        continue;
      }
      const before = code.slice(Math.max(0, use.index - CONTEXT), use.index);
      const destructured = DESTRUCTURED.exec(before);
      if (destructured !== null) {
        for (const part of splitTopLevel(destructured[1]!)) {
          if (part.startsWith("...")) continue; // a rest binding names nothing
          const entry = patternEntry(part);
          if (entry === null) {
            unreadable.push({
              use: sourceLine(code, use.index),
              reason: `${part.trim()} takes a key this check cannot read as a plain name`,
              spread,
            });
            continue;
          }
          names.add(entry.key);
        }
        continue;
      }
      // A parameter's own default is handed to it by nobody.
      if (PARAMETER_DEFAULT.test(before)) continue;
      const alias = readStored(code, use);
      if (alias !== null) {
        if (typeof alias === "string")
          unreadable.push({
            use: sourceLine(code, use.index),
            reason: alias,
            spread,
          });
        else store(alias, use, spread);
        continue;
      }
      const handoff = readHandoff(code, use);
      if (typeof handoff === "string")
        unreadable.push({
          use: sourceLine(code, use.index),
          reason: handoff,
          spread,
        });
      else handoffs.push(handoff);
    }
  }
  return { names: [...names].sort(), handoffs, unreadable };
}

/**
 * What a module does with `process.env`: the settings it reads by name,
 * however the read is spelled, and the places it hands the environment on
 * whole instead. Comments are removed first, so a read left behind in a
 * commented-out line is not one.
 */
export function readEnvironmentUses(source: string): EnvironmentUses {
  return collectUses(stripComments(source), ENVIRONMENT);
}

/** Every module specifier a file imports, however the import is written. */
function importedSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

/** An import written as a path to a file beside it, naming no file. */
export interface LocalImportProblem {
  /** Workspace-relative path of the module writing the import. */
  readonly module: string;
  /** The specifier as written. */
  readonly specifier: string;
  /** Why nothing could be read for it. */
  readonly reason: string;
}

/** An import of one of this workspace's packages that names no file. */
export interface WorkspaceImportProblem extends LocalImportProblem {
  /** The workspace package that specifier names. */
  readonly package: string;
}
/**
 * A spec file and every module inside this repository it imports, directly or
 * through another of them — the fixtures whose module scope runs as soon as
 * the spec is collected, and which read settings on its behalf.
 *
 * This workspace's own packages are followed as well: `@workspace/db` reads
 * `DATABASE_URL` at its module scope, and a suite importing it needs that
 * setting as surely as one naming it in a spec. Anything else a module
 * imports is left alone — a dependency's settings are its own business, and
 * nothing leads out of the workspace or into `node_modules`.
 *
 * One of this workspace's own packages that cannot be reached is returned as
 * a problem instead of being passed over, because everything it reads goes
 * missing from the suite's reads with it, and a missing read is what the
 * reverse comparison reports as a `required` entry to drop.
 *
 * A path to a file beside this one that reaches nothing is returned the same
 * way, and for the same reason: a fixture renamed out from under the spec
 * importing it takes every setting it read with it. That one the run cannot
 * load at all — Playwright fails collecting the spec — so silence here left
 * this check advising someone to drop settings a broken run still needs. An
 * import reaching out of this repository is another matter, and is passed
 * over: nothing out there is this workspace's to read.
 */
export function collectSuiteModules(
  root: string,
  entry: string,
  packages: ReadonlyMap<string, WorkspacePackageEntry> = readWorkspacePackages(
    root,
  ),
): SuiteModules {
  const found = new Set<string>();
  const unresolved: WorkspaceImportProblem[] = [];
  const unresolvedLocal: LocalImportProblem[] = [];
  const reported = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (found.has(current)) continue;
    let source;
    try {
      source = readFileSync(path.join(root, current), "utf8");
    } catch {
      continue; // a module that cannot be read reads no settings
    }
    found.add(current);
    const code = stripComments(source);
    for (const specifier of importedSpecifiers(code)) {
      let resolved: string | null;
      if (specifier.startsWith(".")) {
        resolved = resolveModule(root, path.dirname(current), specifier);
        if (resolved === null) {
          const named = toPosix(
            path.relative(
              root,
              path.resolve(root, path.dirname(current), specifier),
            ),
          );
          // A path leading out of this repository is nobody here's to read,
          // the way a dependency is not, so it is passed over rather than
          // reported as a file this workspace is missing.
          if (named.startsWith("..")) continue;
          const key = `${current}|${specifier}`;
          if (reported.has(key)) continue; // one import, written twice
          reported.add(key);
          unresolvedLocal.push({
            module: current,
            specifier,
            reason: `nothing here is at ${named}, under that name or any extension this check reads`,
          });
          continue;
        }
      } else {
        const resolution = resolveWorkspaceModule(root, specifier, packages);
        if (resolution.kind === "foreign") continue;
        if (resolution.kind === "unresolved") {
          const key = `${current}|${specifier}`;
          if (reported.has(key)) continue; // one import, written twice
          reported.add(key);
          unresolved.push({
            module: current,
            specifier,
            package: resolution.package,
            reason: resolution.reason,
          });
          continue;
        }
        resolved = resolution.module;
      }
      if (resolved === null || resolved.startsWith("..")) continue;
      if (resolved.split("/").includes("node_modules")) continue;
      if (!found.has(resolved)) queue.push(resolved);
    }
  }
  return { modules: [...found].sort(), unresolved, unresolvedLocal };
}

/** A function a handoff leads to, as the text this check reads it from. */
interface Callable {
  /** Workspace-relative path of the module declaring it. */
  readonly module: string;
  /** That module's source, comments already removed. */
  readonly code: string;
  /** Its parameter list, as written. */
  readonly params: string;
  /** Its body: the block, or the expression an arrow returns. */
  readonly body: string;
}

/**
 * A function declared in this code, by the name it is declared under. Only
 * the forms a helper is normally written in are read — `function name(...)`,
 * and a `const` holding a function or an arrow — because a name this check
 * cannot find a body for is reported rather than assumed to read nothing.
 */
function readCallable(
  code: string,
  name: string,
): { params: string; body: string } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headers = [
    new RegExp(`\\bfunction\\s*\\*?\\s*${escaped}\\s*\\(`),
    new RegExp(
      `\\b(?:const|let|var)\\s+${escaped}\\s*(?::[^=;{]*)?=\\s*(?:async\\s+)?(?:function\\s*\\*?\\s*[A-Za-z_$][\\w$]*\\s*|function\\s*\\*?\\s*)?\\(`,
    ),
  ];
  for (const header of headers) {
    const match = header.exec(code);
    if (match === null) continue;
    const open = match.index + match[0].length - 1;
    const close = matchingBracket(code, open);
    if (close === -1) continue;
    const body = readBody(code, close + 1);
    if (body === null) continue;
    return { params: code.slice(open + 1, close), body };
  }
  // A single-parameter arrow, written without the parentheses.
  const bare = new RegExp(
    `\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s+)?([A-Za-z_$][\\w$]*)\\s*=>`,
  ).exec(code);
  if (bare === null) return null;
  const body = readBody(code, bare.index + bare[0].length - 2);
  return body === null ? null : { params: bare[1]!, body };
}

/**
 * A function's body, starting from just after its parameter list. A return
 * type annotation is stepped over rather than mistaken for the body: the
 * `{` that opens a block follows a complete type, where a type's own `{`
 * follows the `:`, `<`, `|`, `&` or `,` that introduces it.
 */
function readBody(code: string, from: number): string | null {
  let index = from;
  let previous = "";
  while (index < code.length) {
    const char = code[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "=" && code[index + 1] === ">") {
      let scan = index + 2;
      while (scan < code.length && /\s/.test(code[scan]!)) scan += 1;
      // An arrow either opens a block or is the expression it returns.
      if (code[scan] !== "{") return readValueFrom(code, scan).value;
      index = scan;
      previous = ">";
      continue;
    }
    if (char === "{") {
      const close = matchingBracket(code, index);
      if (close === -1) return null;
      const annotation = previous !== "" && ":|&<,(".includes(previous);
      if (!annotation) return code.slice(index, close + 1);
      index = close + 1;
      previous = "}";
      continue;
    }
    if (char === ";") return null; // an overload or a bare declaration
    previous = char;
    index += 1;
  }
  return null;
}

/** Where a name used in this code was imported from, where it was. */
function importedBinding(
  code: string,
  local: string,
): { specifier: string; exported: string } | null {
  for (const match of code.matchAll(
    /\bimport\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    for (const entry of match[1]!.split(",")) {
      const parts = entry
        .trim()
        .split(/\s+as\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) continue;
      if (parts[parts.length - 1] === local)
        return { specifier: match[2]!, exported: parts[0]! };
    }
  }
  return null;
}

/**
 * The module a helper is imported from, or why this check cannot read one:
 * a path beside the importing file, and otherwise whichever of this
 * workspace's own packages the specifier names, resolved through that
 * package's manifest exactly as the same import is resolved when the modules
 * a suite loads are collected. A package this repository builds is no
 * further away than a file beside the caller — everything it reads off the
 * environment is read by the run that imports it — so the only specifier
 * left unfollowed is one naming something this workspace does not build, or
 * one of its packages reaching no file, and each is said as what it is.
 */
function resolveHelperModule(
  root: string,
  from: string,
  specifier: string,
  packages: ReadonlyMap<string, WorkspacePackageEntry>,
): { module: string } | { reason: string } {
  let resolved: string | null;
  if (specifier.startsWith(".")) {
    resolved = resolveModule(root, path.dirname(from), specifier);
  } else {
    const resolution = resolveWorkspaceModule(root, specifier, packages);
    if (resolution.kind === "foreign")
      return { reason: "which this workspace does not build" };
    // Reported in its own right as the suite's modules are collected, which
    // is the report a reader gets; this is what the same import says here.
    if (resolution.kind === "unresolved")
      return { reason: `and ${resolution.reason}` };
    resolved = resolution.module;
  }
  if (
    resolved === null ||
    resolved.startsWith("..") ||
    resolved.split("/").includes("node_modules")
  )
    return { reason: "which is not a module here" };
  return { module: resolved };
}

/** Whether a module passes every name another exports on, with `export *`. */
const PASSES_EVERYTHING_ON = /\bexport\s*\*\s*from\s*["'][^"']+["']/;

/**
 * How many modules passing a helper's name along are followed before this
 * check stops and reports where it got to. An entry point re-exporting a
 * helper from the file declaring it is one; a library whose entry point
 * gathers a directory of them, each re-exported again, is a few more. A
 * chain longer than this is reported rather than followed, which is also
 * what ends a cycle of modules re-exporting one another.
 */
const PASSED_ON_LIMIT = 5;

/**
 * Where a module passes a name it exports on from, for one that exports the
 * name without declaring it: `export { assertDevelopment } from
 * "./development"`, and the same written as an import with an
 * `export { assertDevelopment }` beside it. A rename along the way is read,
 * so what comes back is the name the module further on exports rather than
 * the one this module offers it under.
 */
function passedOnBinding(
  code: string,
  exported: string,
): { specifier: string; exported: string } | null {
  for (const match of code.matchAll(
    /\bexport\s*(?:type\s+)?\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/g,
  )) {
    for (const entry of match[1]!.split(",")) {
      const parts = entry
        .trim()
        .split(/\s+as\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) continue;
      if (parts[parts.length - 1] !== exported) continue;
      const local = parts[0]!;
      if (match[2] !== undefined)
        return { specifier: match[2], exported: local };
      // An export clause on its own passes on whatever that name holds here,
      // which is another module's export where an import brought it in.
      const imported = importedBinding(code, local);
      if (imported !== null) return imported;
    }
  }
  return null;
}
/**
 * The function a handoff names, or why this check cannot read it.
 *
 * A name imported from another module is followed to the module actually
 * declaring it, through however many modules only pass it along: a shared
 * library's entry point re-exporting a helper out of the file holding it is
 * the ordinary shape here, and stopping at the entry point would report the
 * library's own structure as the thing to fix. A re-export this check still
 * cannot follow — `export *`, or a chain longer than it reads — is reported
 * naming the file it got to, because a helper whose reads nobody can see
 * takes the settings it reads out of the list its suite is held to.
 */
function findCallable(
  root: string,
  from: string,
  code: string,
  callee: string,
  packages: ReadonlyMap<string, WorkspacePackageEntry>,
): Callable | string {
  if (!IDENTIFIER.test(callee))
    return `${callee} is not a plain function name this check can follow to a declaration`;
  const here = readCallable(code, callee);
  if (here !== null) return { module: from, code, ...here };
  const imported = importedBinding(code, callee);
  if (imported === null)
    return `${callee} is neither declared in this file nor imported into it by name`;

  let where = { module: from, ...imported };
  for (let hop = 0; ; hop += 1) {
    const helper = resolveHelperModule(
      root,
      where.module,
      where.specifier,
      packages,
    );
    if ("reason" in helper)
      return hop === 0
        ? `${callee} comes from ${where.specifier}, ${helper.reason}`
        : `${callee} is passed on by ${where.module}, which takes it from ${where.specifier}, ${helper.reason}`;
    const resolved = helper.module;
    let source;
    try {
      source = readFileSync(path.join(root, resolved), "utf8");
    } catch {
      return `${resolved} cannot be read`;
    }
    const target = stripComments(source);
    const declared = readCallable(target, where.exported);
    if (declared !== null)
      return { module: resolved, code: target, ...declared };
    const onward = passedOnBinding(target, where.exported);
    if (onward === null)
      return PASSES_EVERYTHING_ON.test(target)
        ? `${resolved} passes names on with \`export *\`, which this check does not follow to find ${where.exported}`
        : `${resolved} does not declare ${where.exported} as a function this check can read`;
    if (hop >= PASSED_ON_LIMIT)
      return `${resolved} passes ${where.exported} on again, past the ${PASSED_ON_LIMIT} re-exports this check follows`;
    where = { module: resolved, ...onward };
  }
}

/** One entry of a destructuring pattern, as the key it takes and the name it binds. */
function patternEntry(entry: string): { key: string; local: string } | null {
  const text = entry.trim();
  const key =
    /^(?:([A-Za-z_$][\w$]*)|"([^"]*)"|'([^']*)')\s*(:|=|$)/.exec(text);
  if (key === null) return null;
  const name = key[1] ?? key[2] ?? key[3]!;
  if (key[4] !== ":") return { key: name, local: name };
  const local = /^([A-Za-z_$][\w$]*)/.exec(text.slice(key[0].length).trim());
  return local === null ? null : { key: name, local: local[1]! };
}

/** What the receiving function does with a handoff's argument. */
type Received =
  /** It has no such parameter, so nothing there reads the environment. */
  | { kind: "ignored" }
  /** It destructures it straight away, and these are the names it takes. */
  | { kind: "names"; names: string[] }
  /** It binds it under this name, whose uses say what it reads. */
  | { kind: "binding"; name: string }
  /** It cannot be read, for this reason. */
  | { kind: "unreadable"; reason: string };

/** Which of a function's parameters a handoff arrives at, and as what. */
function receivedBy(callable: Callable, handoff: EnvironmentHandoff): Received {
  const params = splitTopLevel(callable.params);
  const param = params[handoff.argument]?.trim();
  if (param === undefined || param === "") return { kind: "ignored" };
  if (param.startsWith("..."))
    return {
      kind: "unreadable",
      reason: `${handoff.callee} collects its arguments in a rest parameter`,
    };
  if (param.startsWith("{")) {
    const close = matchingBracket(param, 0);
    if (close === -1)
      return {
        kind: "unreadable",
        reason: `${handoff.callee}'s parameter cannot be read`,
      };
    const entries = splitTopLevel(param.slice(1, close));
    const rest = entries.some((entry) => entry.trim().startsWith("..."));
    if (handoff.property === null) {
      // It destructures the environment itself: those keys are its reads.
      if (rest)
        return {
          kind: "unreadable",
          reason: `${handoff.callee} takes the rest of the environment into another binding`,
        };
      const read = entries.map(patternEntry);
      if (read.some((entry) => entry === null))
        return {
          kind: "unreadable",
          reason: `${handoff.callee}'s parameter is a pattern this check cannot read`,
        };
      return { kind: "names", names: read.map((entry) => entry!.key) };
    }
    const match = entries
      .map(patternEntry)
      .find((entry) => entry?.key === handoff.property);
    if (match) return { kind: "binding", name: match.local };
    if (rest)
      return {
        kind: "unreadable",
        reason: `${handoff.callee} takes ${handoff.property} into a rest binding`,
      };
    return { kind: "ignored" }; // it never asks for that key
  }
  const name = /^([A-Za-z_$][\w$]*)/.exec(param);
  if (name === null)
    return {
      kind: "unreadable",
      reason: `${handoff.callee}'s parameter cannot be read`,
    };
  if (handoff.property !== null)
    return {
      kind: "unreadable",
      reason: `${handoff.callee} takes the whole options object as ${name[1]}, and this check does not follow ${name[1]}.${handoff.property}`,
    };
  return { kind: "binding", name: name[1]! };
}

/** A use of the whole environment nothing can attribute to setting names. */
export interface EnvironmentUseProblem {
  /** Workspace-relative path of the file it is written in. */
  readonly module: string;
  /** The line it is written on, with comments already removed. */
  readonly use: string;
  /** Why what it reaches cannot be read. */
  readonly reason: string;
  /**
   * Whether the whole environment is handed on here by a spread of it, which
   * is the one gap a declaration can account for instead: see
   * `UnreadableUse`. A handoff that could not be followed is not one, however
   * the environment reached it — that one names the function it arrives at,
   * so what to do about it is to make that function readable rather than to
   * say where everything went.
   */
  readonly spread: boolean;
}

/** What the modules a config runs take out of the environment. */
export interface EnvironmentReads {
  /** Each setting read, as the modules reading it. */
  readonly reads: Map<string, string[]>;
  /** The handoffs whose reads this check could not determine. */
  readonly unreadable: EnvironmentUseProblem[];
  /** Its imports of this workspace's packages that reached no file. */
  readonly unresolvedImports: WorkspaceImportProblem[];
  /** Its imports of a file beside one of them that reached no file. */
  readonly unresolvedLocalImports: LocalImportProblem[];
}

/** What is being built up while a suite's modules and helpers are read. */
interface ReadCollection {
  readonly reads: Map<string, string[]>;
  readonly unreadable: EnvironmentUseProblem[];
  /** Handoffs already followed, so a cycle of them ends. */
  readonly seen: Set<string>;
}

function record(into: ReadCollection, name: string, module: string): void {
  const modules = into.reads.get(name) ?? [];
  if (!modules.includes(module)) modules.push(module);
  into.reads.set(name, modules);
}

/**
 * Whether a handoff is the environment a requirement module gives the
 * announcement: `announceBrowserTests(SUITE, { ...process.env, ... })`, in
 * that call's environment argument, where the name called is the one the
 * shared requirement module exports — renamed on import or not.
 *
 * Followed, this one comes back as the shared module's own `env[name]`
 * reader and is reported as a setting named while the run is in progress,
 * which is what that reader is and what none of these suites' settings are.
 * What it really reads is the declaration this check is already comparing
 * against, so it reads nothing here that the lists do not already state.
 */
function isAnnouncementHandoff(
  root: string,
  from: string,
  code: string,
  handoff: EnvironmentHandoff,
): boolean {
  if (handoff.argument !== ANNOUNCE_ENVIRONMENT_ARGUMENT) return false;
  if (handoff.property !== null) return false;
  const imported = importedFromRequirementModule(root, from, code);
  return imported.get(handoff.callee) === ANNOUNCE_FUNCTION;
}

/**
 * Follows one handoff into the function it names, recording what that
 * function reads off the environment it was given and following any further
 * handoff of that same binding. A function this check cannot read is
 * recorded as a problem: silence there would hide exactly the settings this
 * is looking for.
 */
function followHandoff(
  root: string,
  from: string,
  code: string,
  handoff: EnvironmentHandoff,
  into: ReadCollection,
  packages: ReadonlyMap<string, WorkspacePackageEntry>,
): void {
  if (isAnnouncementHandoff(root, from, code, handoff)) return;
  const callable = findCallable(root, from, code, handoff.callee, packages);
  if (typeof callable === "string") {
    into.unreadable.push({
      module: from,
      use: handoff.use,
      reason: callable,
      spread: false,
    });
    return;
  }
  const key = `${callable.module}|${handoff.callee}|${handoff.argument}|${handoff.property ?? ""}`;
  if (into.seen.has(key)) return;
  into.seen.add(key);

  const received = receivedBy(callable, handoff);
  if (received.kind === "ignored") return;
  if (received.kind === "unreadable") {
    into.unreadable.push({
      module: from,
      use: handoff.use,
      reason: received.reason,
      spread: false,
    });
    return;
  }
  if (received.kind === "names") {
    for (const name of received.names) record(into, name, callable.module);
    return;
  }
  const uses = collectUses(callable.body, usesOfName(received.name));
  for (const name of uses.names) record(into, name, callable.module);
  for (const use of uses.unreadable)
    into.unreadable.push({ module: callable.module, ...use });
  for (const next of uses.handoffs)
    followHandoff(root, callable.module, callable.code, next, into, packages);
}

/**
 * Every setting the cases a config runs read, as the modules reading each —
 * the names those modules take out of `process.env` themselves, and the ones
 * read by the helpers they hand the whole environment to. Naming those
 * modules is most of the answer to whether a setting belongs in `required`
 * or in `optional`.
 */
export function collectEnvironmentReads(
  root: string,
  spec: string,
  packages: ReadonlyMap<string, WorkspacePackageEntry> = readWorkspacePackages(
    root,
  ),
): EnvironmentReads {
  const into: ReadCollection = {
    reads: new Map<string, string[]>(),
    unreadable: [],
    seen: new Set<string>(),
  };
  const collected = collectSuiteModules(root, spec, packages);
  for (const module of collected.modules) {
    let source;
    try {
      source = readFileSync(path.join(root, module), "utf8");
    } catch {
      continue;
    }
    const code = stripComments(source);
    const uses = collectUses(code, ENVIRONMENT);
    for (const name of uses.names) record(into, name, module);
    for (const use of uses.unreadable)
      into.unreadable.push({ module, ...use });
    for (const handoff of uses.handoffs)
      followHandoff(root, module, code, handoff, into, packages);
  }
  return {
    reads: into.reads,
    unreadable: into.unreadable,
    unresolvedImports: collected.unresolved,
    unresolvedLocalImports: collected.unresolvedLocal,
  };
}

/** The declarations this workspace's shared requirement module states. */
export function readWorkspaceDeclarations(root: string): SuiteDeclaration[] {
  const resolved = resolveModule(root, ".", REQUIREMENT_MODULE);
  if (resolved === null) return [];
  return readSuiteDeclarations(readFileSync(path.join(root, resolved), "utf8"));
}

/**
 * What a read may be written in: the modules a run loads, and the two
 * extensions a component is written in beside them.
 */
const SOURCE_EXTENSIONS = [...MODULE_EXTENSIONS, ".tsx", ".jsx"];

/**
 * Every setting anything in this workspace reads out of the environment.
 *
 * This is the one question an `unused` entry is answered with that no single
 * suite can answer: whether the setting it refuses is still a setting this
 * repository has. Following the declaring suite's own imports cannot say so
 * — the entry exists precisely because those imports no longer arrive at the
 * read — so the whole tree is read instead, and the module holding that read
 * is found wherever it sits. In the split the moderation suites record, it
 * is a fixture beside them that this suite does not import; it could as
 * easily be a helper in another package, waiting for the import that would
 * bring it back.
 *
 * What counts as a read is what counts everywhere else here, `process.env`
 * read by name, aliased, or destructured, with comments and string literals
 * passed over — a name quoted inside a fixture written as source text is a
 * mention rather than a read, and taking one for evidence would let a
 * misspelled entry vouch for itself out of the very suite testing it.
 *
 * Where it looks is the tree the config search reads, walked by the same
 * function so the two cannot come to disagree about which directories are
 * this workspace's own, with `.tsx` and `.jsx` asked for as well.
 */
export function settingsReadInWorkspace(
  root: string,
  dir: string = WORKSPACE_TREE,
): Set<string> {
  const names = new Set<string>();
  for (const module of findWorkspaceModules(root, dir, SOURCE_EXTENSIONS)) {
    let source;
    try {
      source = readFileSync(path.join(root, module), "utf8");
    } catch {
      continue; // a file that cannot be read reads no settings
    }
    for (const name of readEnvironmentUses(source).names) names.add(name);
  }
  return names;
}

/**
 * The same, read once however many configs ask and only where one does. No
 * `unused` entry naming a setting some suite already asks for reaches this
 * at all — which is every entry in the tree today — so the walk above stays
 * off the common path of a check that already reads a file per import.
 */
function settingsReadHere(root: string): () => ReadonlySet<string> {
  let found: ReadonlySet<string> | null = null;
  return () => (found ??= settingsReadInWorkspace(root));
}

/**
 * A Playwright glob as a regular expression, supporting the parts these
 * configs could reasonably use: `**` across directories, `*` and `?` within
 * one name.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        // `**/` crosses any number of directories, including none, so
        // `**/*.spec.ts` matches a bare file name as well as a path.
        if (glob[index + 1] === "/") {
          index += 1;
          pattern += "(?:.*/)?";
        } else {
          pattern += ".*";
        }
        continue;
      }
      pattern += "[^/]*";
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

/** The type annotation that marks a suite declaration in the shared module. */
export const SUITE_TYPE = "BrowserSuite";

/**
 * What a module announces through the shared requirement module, read from
 * its source: a `globalSetup` module's `announceBrowserTests(SUITE)` by
 * default, or another of that module's entry points where `announce` names
 * one — a command's preflight is read the same way, the declaration it names
 * being its own rather than a suite's.
 */
export function readAnnouncement(
  root: string,
  modulePath: string,
  source: string,
  announce: string = ANNOUNCE_FUNCTION,
): Announcement {
  const code = stripComments(source);
  const imported = importedFromRequirementModule(root, modulePath, code);
  const calls = code.matchAll(
    new RegExp(`\\b${announce}\\s*\\(\\s*([A-Za-z_$][\\w$]*)?`, "g"),
  );
  const suites: string[] = [];
  let announces = false;
  for (const call of calls) {
    announces = true;
    const exported = call[1] ? imported.get(call[1]) : undefined;
    if (exported && exported !== announce) suites.push(exported);
  }
  return {
    announces: announces && imported.get(announce) === announce,
    suites,
  };
}

/** What a declaration that has drifted from the run it describes needs. */
function correctTheDeclaration(): string[] {
  return [
    `      fix: correct the \`config\` and \`spec\` named on that ${SUITE_TYPE} in`,
    `           ${REQUIREMENT_MODULE}, or the config's`,
    `           ${TEST_MATCH_KEY}, so the declaration says what this config actually runs.`,
    "",
  ];
}

/** What to do about it. */
function fix(problem: ConfigProblem): string[] {
  switch (problem.kind) {
    case "undeclared":
      return [
        `      fix: name this config, and the spec it runs, as \`config\` and \`spec\` on the`,
        `           ${SUITE_TYPE} in ${REQUIREMENT_MODULE} whose`,
        "           settings those specs need — as plain strings: the config by its bare name in",
        `           ${DECLARATION_DIR}/ or by its workspace-relative path anywhere else, and the`,
        "           spec as it sits beside that config —",
        `           declaring a new ${SUITE_TYPE} if this is a new suite.`,
        "",
      ];
    case "runs-other-suite":
      return [
        `      fix: narrow this config's ${TEST_MATCH_KEY} to the spec its own suite declares —`,
        `           a ${TEST_MATCH_KEY} left out collects every spec file in its testDir — or,`,
        "           if this config really runs those cases, declare them on the suite whose",
        `           settings they need in ${REQUIREMENT_MODULE}.`,
        "",
      ];
    case "declared-config-missing": {
      if (problem.bareName === undefined) return correctTheDeclaration();
      const elsewhere = problem.namedElsewhere ?? [];
      const only = elsewhere.length === 1 ? elsewhere[0]! : null;
      return [
        only === null
          ? `      fix: name that config by its workspace-relative path as \`config\` on that`
          : `      fix: name that config as \`config: "${only}"\` on that`,
        `           ${SUITE_TYPE} in ${REQUIREMENT_MODULE}.`,
        `           A name written short is only ever looked for in ${DECLARATION_DIR}/, so that`,
        "           is the one name a suite in another package writes out in full. Its `spec` may",
        "           stay short: that one is read beside whichever config the suite names.",
        "",
      ];
    }
    case "claimed-twice":
    case "declared-spec-missing":
    case "spec-not-run":
      return correctTheDeclaration();
    case "undeclared-setting":
      return [
        `      fix: add ${(problem.settings ?? []).join(", ")} to \`${REQUIRED_KEY}\` on ${problem.declaredSuite} in`,
        `           ${REQUIREMENT_MODULE},`,
        `           so a run missing ${(problem.settings ?? []).length === 1 ? "it" : "them"} stops before any case does — or, where a run`,
        `           really may go without one, state it in \`${OPTIONAL_KEY}\` on that suite as`,
        `           \`{ ${OPTIONAL_NAME_KEY}: "...", ${OPTIONAL_LINE_KEY}: "..." }\`, whose line says what these cases do`,
        "           without it — that line is what the run prints beside the name.",
        "",
      ];
    case "undeclared-config-setting":
      return [
        `      fix: add ${(problem.settings ?? []).join(", ")} to \`${REQUIRED_KEY}\` on ${problem.declaredSuite} in`,
        `           ${REQUIREMENT_MODULE}, so ${GLOBAL_SETUP_KEY} stops a run`,
        `           missing ${(problem.settings ?? []).length === 1 ? "it" : "them"} once, before any worker evaluates this config — or, where a run`,
        `           really may go without one, name it in \`${OPTIONAL_KEY}\` on that suite and say`,
        "           in a comment what this config does when it is not set.",
        "",
      ];
    case "undeclared-setup-setting":
      return [
        `      fix: add ${(problem.settings ?? []).join(", ")} to \`${REQUIRED_KEY}\` on ${problem.declaredSuite} in`,
        `           ${REQUIREMENT_MODULE}, so the same ${GLOBAL_SETUP_KEY}`,
        `           run that reads ${(problem.settings ?? []).length === 1 ? "it" : "them"} is the one that stops a run without ${(problem.settings ?? []).length === 1 ? "it" : "them"}, naming ${(problem.settings ?? []).length === 1 ? "it" : "them"} — or,`,
        `           where a run really may go without one, state it in \`${OPTIONAL_KEY}\` on that suite`,
        `           as \`{ ${OPTIONAL_NAME_KEY}: "...", without: "..." }\`, whose line says what this run does`,
        "           without it. The module reading it is named above.",
        "",
      ];
    case "unread-required":
      return [
        `      fix: drop ${(problem.settings ?? []).join(", ")} from \`${REQUIRED_KEY}\` on ${problem.declaredSuite} in`,
        `           ${REQUIREMENT_MODULE},`,
        `           or move it to \`${OPTIONAL_KEY}\` if its cases still read it sometimes. A stale`,
        `           \`${REQUIRED_KEY}\` entry sends a person off to configure something this suite`,
        "           does not use, which is the wasted trip a missing setting causes, reversed.",
        "",
      ];
    case "unread-optional":
      return [
        `      fix: drop ${(problem.settings ?? []).join(", ")} from \`${OPTIONAL_KEY}\` on ${problem.declaredSuite} in`,
        `           ${REQUIREMENT_MODULE}.`,
        `           A \`${OPTIONAL_KEY}\` entry states that these cases read a setting the run may go`,
        "           without; one nothing reads only widens what the suite may silently skip.",
        "",
      ];
    case "unsaid-optional": {
      const names = (problem.settings ?? []).join(", ");
      const one = (problem.settings ?? []).length === 1;
      return [
        `      fix: write what these cases do without ${names} as the \`${OPTIONAL_LINE_KEY}\``,
        `           of ${one ? "that entry" : "those entries"}, stated in \`${OPTIONAL_KEY}\` on ${problem.declaredSuite} or in a list`,
        `           it spreads, in ${REQUIREMENT_MODULE} —`,
        `           \`{ ${OPTIONAL_NAME_KEY}: "...", ${OPTIONAL_LINE_KEY}: "..." }\` — in one short line and in the run's`,
        '           terms: what happens to the cases, not that the variable is unset. "nothing"',
        "           is an answer, and a useful one, since it says this run covered as much as a",
        "           fully configured one would. That line is what the run prints beside the",
        `           name, and \`${OPTIONAL_LINE_KEY}: ""\` prints the bare name it was added to replace.`,
        "",
      ];
    }
    case "unused-setting-read":
      return [
        `      fix: take that read back out of what ${problem.spec} runs, rather than`,
        `           declaring the setting. The module reading it is named above: keep it out of`,
        "           that spec's imports, splitting it where this suite needs one part of it and",
        `           not the other — that split is what the \`${UNUSED_KEY}\` entry is recording.`,
        `           Declaring it instead is what the entry refuses: in \`${OPTIONAL_KEY}\` it costs`,
        "           every run of this suite a line announcing a gap that is not one, and a notice",
        `           always there is one its readers learn to skip. If these cases really do need`,
        `           ${(problem.settings ?? []).join(", ")} now, delete that \`${UNUSED_KEY}\` entry in the same change, so the`,
        "           decision is made where the reason for it is written.",
        "",
      ];
    case "unused-setting-declared":
      return [
        `      fix: decide which of the two ${problem.declaredSuite} means in`,
        `           ${REQUIREMENT_MODULE}: drop`,
        `           ${(problem.settings ?? []).join(", ")} from \`${UNUSED_KEY}\` if these cases really read it now, or`,
        `           from \`${REQUIRED_KEY}\`/\`${OPTIONAL_KEY}\` if they do not. Left as it is, the entry`,
        "           refusing the setting is the one with no effect: a declared name is a name",
        "           this suite may read, so the read it was written to catch passes.",
        "",
      ];
    case "unused-setting-unread":
      return [
        `      fix: correct the name, or drop ${(problem.settings ?? []).join(", ")} from \`${UNUSED_KEY}\` on`,
        `           ${problem.declaredSuite} in ${REQUIREMENT_MODULE}.`,
        `           An entry there refuses a read something here could otherwise make; with`,
        "           the setting read in no module of this workspace and asked for by no suite,",
        "           there is nothing left to import that would make it, so the entry catches",
        "           nothing while reading like a rule this suite is held to. A mistyped name",
        "           looks exactly like this, and so does an entry outliving the setting it",
        "           was written about — if the code reading it moved somewhere this search",
        "           does not reach, say into a package's built output, say so in",
        `           \`${REQUIRED_KEY}\`/\`${OPTIONAL_KEY}\` on the suite that runs it instead.`,
        "",
      ];
    case "unresolved-local-import":
      return [
        "      fix: restore that file, or correct the import to the name it has now — the",
        "           module writing it is named above. A spec or fixture importing a path that",
        "           is not there fails the run as it is collected, and until it resolves what",
        `           that file read is missing from both comparisons, so neither ${problem.declaredSuite}'s`,
        `           \`${REQUIRED_KEY}\` nor its \`${OPTIONAL_KEY}\` is held to anything.`,
        "",
      ];
    case "unresolved-workspace-import":
      return [
        "      fix: point that package's `exports` (or `main`) at a file this repository has —",
        "           its source, not built output a fresh checkout does not carry — or add an",
        "           `exports` entry for the subpath this import names. Until it resolves, what",
        `           that package reads is missing from both comparisons, so neither ${problem.declaredSuite}'s`,
        `           \`${REQUIRED_KEY}\` nor its \`${OPTIONAL_KEY}\` can be trusted to be the list this run needs.`,
        "",
      ];
    case "unreadable-environment":
      return [
        "      fix: write each setting's name out where it is read, rather than building it at",
        "           run time, and hand a helper the settings it needs by name — or declare that",
        "           helper as a plain function in a module this workspace builds, beside the",
        "           caller or exported by one of its packages, taking the environment as a",
        "           parameter it reads names off. Either way what the run reads can be seen",
        `           from the files this config runs, and held to ${problem.declaredSuite}'s \`${REQUIRED_KEY}\` and \`${OPTIONAL_KEY}\`.`,
        "",
      ];
    case "unreadable-settings":
      return [
        `      fix: write that suite's \`${REQUIRED_KEY}\` in`,
        `           ${REQUIREMENT_MODULE}`,
        `           as string literals and its \`${OPTIONAL_KEY}\` and \`${UNUSED_KEY}\` as entries stating a`,
        `           literal \`${OPTIONAL_NAME_KEY}\` — any of the three may also spread a constant array`,
        "           declared in that same module — so what the suite is held to can be read from it.",
        "",
      ];
    case "wrong-suite":
      return [
        `      fix: point ${GLOBAL_SETUP_KEY} at the <suite>.requirement.ts whose default export`,
        `           announces ${problem.declaredSuite} — ${DECLARATION_DIR}/moderation.requirement.ts`,
        "           is the shape to copy — or, if this config really runs the other suite's",
        `           specs, correct the \`config\` and \`spec\` named on those suites in`,
        `           ${REQUIREMENT_MODULE}.`,
        "",
      ];
    default:
      return [
        `      fix: add \`${GLOBAL_SETUP_KEY}: "./<suite>.requirement.ts"\` to this config, and give that`,
        `           module a default export calling ${ANNOUNCE_FUNCTION}(<SUITE>), both imported`,
        `           from ${REQUIREMENT_PACKAGE} —`,
        `           ${DECLARATION_DIR}/moderation.requirement.ts is the shape to copy,`,
        `           with the suite's settings declared in ${REQUIREMENT_MODULE}`,
        "",
      ];
  }
}

export function readConfigValues(source: string, key: string): string[] {
  const code = stripComments(source);
  const keys = new RegExp(`(?:^|[\\s{,;(])${key}\\s*:`, "g");
  const values: string[] = [];
  let found = keys.exec(code);
  while (found !== null) {
    const { value, end } = readValueFrom(code, found.index + found[0].length);
    values.push(value);
    keys.lastIndex = end;
    found = keys.exec(code);
  }
  return values;
}

/**
 * Conditions an `exports` entry may be written under, in the order this reads
 * them. `types` is deliberately not among them: a declaration file states the
 * shape of a module, not what it takes out of the environment.
 */
const EXPORT_CONDITIONS = ["import", "module", "node", "default", "require"];

/** The path an `exports` value names, reading through condition objects. */
function exportTarget(value: unknown, depth = 0): string | null {
  if (typeof value === "string") return value;
  if (depth > 8) return null; // a manifest nesting this far is not one to read
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = exportTarget(item, depth + 1);
      if (target !== null) return target;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const conditions = value as Record<string, unknown>;
  for (const condition of EXPORT_CONDITIONS) {
    if (!(condition in conditions)) continue;
    const target = exportTarget(conditions[condition], depth + 1);
    if (target !== null) return target;
  }
  return null;
}

/** What a bare specifier names, as far as this workspace's packages go. */
export type WorkspaceResolution =
  /** A module of one of this workspace's packages. */
  | { readonly kind: "module"; readonly module: string }
  /** Not this workspace's to read: a dependency, or a Node builtin. */
  | { readonly kind: "foreign" }
  /** One of its packages, named in a way that reaches no file here. */
  | {
      readonly kind: "unresolved";
      /** The package the specifier names. */
      readonly package: string;
      /** Why nothing inside it could be read for this specifier. */
      readonly reason: string;
    };
/**
 * The file a bare specifier names, where it names one of this workspace's own
 * packages. Anything else — a dependency, a Node builtin — comes back
 * `foreign`: those are not this workspace's modules to read.
 *
 * One of its own packages that reaches no file is a third answer rather than
 * the same silence. A manifest pointing at built output a checkout does not
 * have, or a subpath no `exports` entry covers, leaves everything that
 * package reads out of what the suite is seen to read — and the comparison
 * that runs the other way would then call the suite's own `required` entries
 * stale and tell someone to drop them.
 */
function resolveWorkspaceModule(
  root: string,
  specifier: string,
  packages: ReadonlyMap<string, WorkspacePackageEntry>,
): WorkspaceResolution {
  const segments = specifier.split("/");
  const name = specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0]!;
  const pkg = packages.get(name);
  if (pkg === undefined) return { kind: "foreign" };
  const rest = specifier.slice(name.length);
  const subpath = rest === "" ? "." : `.${rest}`;
  const target = packageSubpath(pkg, subpath);
  if ("reason" in target)
    return {
      kind: "unresolved",
      package: name,
      reason: `${name} ${target.reason}`,
    };
  const module = resolveModule(root, pkg.dir, target.target);
  if (module === null)
    return {
      kind: "unresolved",
      package: name,
      reason: `${name} names ${target.target} for ${subpathName(subpath)}, and there is no such file in ${pkg.dir}`,
    };
  return { kind: "module", module };
}

/** One of this workspace's own packages, as its manifest describes it. */
export interface WorkspacePackageEntry {
  /** Workspace-relative directory holding the package. */
  readonly dir: string;
  /** Its `exports` field as written, where it declares one. */
  readonly exports: unknown;
  /** Its `main` field, for a package declaring no `exports`. */
  readonly main: string | null;
}

/**
 * This workspace's own packages, by the name other packages import them as.
 * The directories come from `pnpm-workspace.yaml`, so a specifier is followed
 * because this workspace builds what it names, not because it looks internal:
 * a dependency from `node_modules` is nobody here's to read.
 */
export function readWorkspacePackages(
  root: string,
): Map<string, WorkspacePackageEntry> {
  let manifest;
  try {
    manifest = readFileSync(path.join(root, WORKSPACE_PACKAGES_FILE), "utf8");
  } catch {
    return new Map(); // no workspace manifest, so no packages of its own
  }

  const matched = (glob: string): string[] =>
    globSync(`${glob}/package.json`, { cwd: root }).map((found) =>
      toPosix(path.dirname(found)),
    );
  const dirs = new Set<string>();
  const excluded = new Set<string>();
  for (const glob of readWorkspaceGlobs(manifest)) {
    const negated = glob.startsWith("!");
    for (const dir of matched(negated ? glob.slice(1) : glob)) {
      (negated ? excluded : dirs).add(dir);
    }
  }

  const packages = new Map<string, WorkspacePackageEntry>();
  for (const dir of dirs) {
    if (excluded.has(dir)) continue;
    let parsed: { name?: unknown; exports?: unknown; main?: unknown };
    try {
      parsed = JSON.parse(
        readFileSync(path.join(root, dir, "package.json"), "utf8"),
      );
    } catch {
      continue; // a manifest that cannot be read names no package
    }
    if (typeof parsed.name !== "string" || parsed.name === "") continue;
    packages.set(parsed.name, {
      dir,
      exports: parsed.exports,
      main: typeof parsed.main === "string" ? parsed.main : null,
    });
  }
  return packages;
}

/**
 * What a package's manifest names for one of its subpaths: the path it maps
 * to, or why this check cannot read one out of the manifest. The reason is
 * written as a predicate, so the package's own name goes in front of it.
 */
type SubpathTarget =
  | { readonly target: string }
  | { readonly reason: string };
/**
 * The file inside a package that one of its subpaths names: its `exports`
 * entry for that subpath where the package declares one — a `*` pattern
 * included — and otherwise the path as written. A subpath the manifest does
 * not account for comes back as the reason it does not, because a package
 * left unread takes its settings out of the suite's list with it.
 */
function packageSubpath(
  pkg: WorkspacePackageEntry,
  subpath: string,
): SubpathTarget {
  const named = subpathName(subpath);
  const conditions = `the conditions this check reads (${EXPORT_CONDITIONS.join(", ")})`;
  const exported = pkg.exports;
  if (exported === undefined || exported === null) {
    return subpath === "."
      ? { target: pkg.main ?? "./index" }
      : { target: subpath };
  }
  if (typeof exported === "string" || Array.isArray(exported)) {
    if (subpath !== ".")
      return {
        reason: `declares its \`exports\` as one entry point, and this import asks for ${subpath}`,
      };
    const target = exportTarget(exported);
    return target === null
      ? { reason: `declares an \`exports\` naming no target under ${conditions}` }
      : { target };
  }
  if (typeof exported !== "object")
    return { reason: "declares an `exports` field this check cannot read" };

  const entries = exported as Record<string, unknown>;
  const subpaths = Object.keys(entries).filter((key) => key.startsWith("."));
  // Conditions written straight into `exports`, with no subpath keys at all,
  // describe the package's own entry point.
  if (subpaths.length === 0) {
    if (subpath !== ".")
      return {
        reason: `declares its \`exports\` as one entry point, and this import asks for ${subpath}`,
      };
    const target = exportTarget(entries);
    return target === null
      ? { reason: `declares an \`exports\` naming no target under ${conditions}` }
      : { target };
  }
  if (subpaths.includes(subpath)) {
    const target = exportTarget(entries[subpath]);
    return target === null
      ? {
          reason: `declares an \`exports\` entry for ${named} naming no target under ${conditions}`,
        }
      : { target };
  }

  for (const key of subpaths) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < prefix.length + suffix.length) continue;
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const target = exportTarget(entries[key]);
    if (target === null) continue;
    return {
      target: target.replace(
        /\*/g,
        () => subpath.slice(prefix.length, subpath.length - suffix.length),
      ),
    };
  }
  return { reason: `declares no \`exports\` entry covering ${named}` };
}

/**
 * How a subpath reads in a report, where `.` is the package itself. Declared
 * as a function rather than a const, because the readers below it run while
 * this module is still being evaluated.
 */
function subpathName(subpath: string): string {
  return subpath === "." ? "its own entry point" : subpath;
}

/** What reading a spec's imports reached, and what it could not reach. */
export interface SuiteModules {
  /** The spec and every module here it leads to, sorted. */
  readonly modules: string[];
  /** Its imports of this workspace's own packages that reach no file. */
  readonly unresolved: WorkspaceImportProblem[];
  /** Its imports of a file beside one of them that reach no file. */
  readonly unresolvedLocal: LocalImportProblem[];
}

/** A further file whose reads count toward the same declaration. */
export interface AlsoRead<K extends string> {
  /** Workspace-relative path of that file. */
  readonly entry: string;
  /** How a setting read there and declared neither way is reported. */
  readonly kind: K;
}

/**
 * Settings a declaration states the files it reaches are meant never to
 * read, and how the two ways of going back on that are reported. A caller
 * stating none is held to neither, since only a name refused on purpose can
 * be read against.
 *
 * The kinds are the caller's rather than this module's because the answer to
 * them belongs to whoever writes the report: what to do about a read that
 * came back is to keep the module reading it out of what this declaration
 * reaches, and where that module sits — a spec's imports, a command's — is
 * the caller's to say.
 */
export interface NeverRead<N extends string> {
  /** Those settings, as the names the declaration's entries state. */
  readonly settings: readonly string[];
  /** How something the declaration reaches reading one is reported. */
  readonly readKind: N;
  /** How stating one and asking for it in a settings list too is. */
  readonly declaredKind: N;
}

/**
 * A spread of the whole environment a declaration answers for itself, so
 * this check reports it rather than following it no further.
 *
 * Only a command declaring the browser run it starts states one. That run is
 * another process, reading settings in files the command never imports, so
 * no reading of this source reaches them — but the run's own settings are
 * declared as a `BrowserSuite` and held to the config and spec it loads, and
 * the command is held to require everything that suite cannot start without.
 * The spread is therefore accounted for by a list, which is what this check
 * asks of it.
 */
export interface AccountedSpreads {
  /**
   * The one file whose spreads are answered for: the module the command
   * runs, never a helper's. A helper handing the environment somewhere
   * unreadable is a gap nothing here declares, so it is still reported.
   */
  readonly module: string;
}
/**
 * Holds one declaration's settings to what the files reached from `entry`
 * really take out of the environment, in both directions, or null when the
 * two agree. A browser suite reaches its files through the spec its config
 * runs; a command through the module it runs. What is compared afterwards is
 * the same question either way — a setting read but declared neither way
 * fails at run time for want of a notice, and one declared but read nowhere
 * sends someone off to configure a setting nothing uses.
 *
 * `alsoRead` names further files read for the same declaration, each
 * reported on its own terms: a suite's config takes settings the run needs
 * as surely as its cases do, and leaves them undeclared in the one module
 * Playwright evaluates again in every worker, while the module that config
 * names as `globalSetup` is reached by a string path no import following
 * arrives at. Their reads count in both directions, so a setting only one of
 * them takes is not called a stale `required` entry.
 *
 * `neverRead` names the settings the declaration states these files are
 * meant not to reach at all. They are held the other way round from the
 * lists above: a read of one fails, and so does asking for the same setting
 * in either list — which would otherwise retire the refusal without
 * removing it, since a declared name is one these files may read. Both are
 * reported before the comparisons below reach the same read, because those
 * would call it undeclared and be answered by declaring it.
 *
 * `accountedSpreads` names the one file whose spreads of the whole
 * environment the declaration answers for rather than this check following
 * them; every other unreadable use, there and everywhere else these files
 * reach, is reported as before.
 */
export function compareDeclaredSettings<
  K extends string = never,
  N extends string = never,
>(
  root: string,
  entry: string,
  declaration: DeclaredSettings,
  packages: ReadonlyMap<string, WorkspacePackageEntry> = readWorkspacePackages(
    root,
  ),
  alsoRead: readonly AlsoRead<K>[] = [],
  neverRead?: NeverRead<N>,
  accountedSpreads?: AccountedSpreads,
): SettingsProblem<K | N> | null {
  if (declaration.unreadable.length > 0)
    return {
      kind: "unreadable-settings",
      unreadable: [...declaration.unreadable],
    };

  // Nothing has to be read for this one: the declaration contradicts itself
  // on its own. It is the shape a widened list takes when the entry refusing
  // the setting was left in place, so it is reported as that rather than
  // read as the refusal having been withdrawn.
  const askedFor = new Set([...declaration.required, ...declaration.optional]);
  const contradicted = (neverRead?.settings ?? []).filter((name) =>
    askedFor.has(name),
  );
  if (neverRead && contradicted.length > 0)
    return { kind: neverRead.declaredKind, settings: contradicted };

  const environment = collectEnvironmentReads(root, entry, packages);
  const also = alsoRead.map((file) => ({
    kind: file.kind,
    read: collectEnvironmentReads(root, file.entry, packages),
  }));

  // The same, one import shorter: a path to a file beside the importing one
  // that reaches nothing. That file is not there to be read, so its settings
  // are missing from everything below exactly as a package's are — and this
  // one stops the run outright, since the spec cannot even be collected. It
  // is reported first, being the plainer thing to have happened.
  const unresolvedLocalImports = mergeUnresolved(
    environment.unresolvedLocalImports,
    ...also.map((file) => file.read.unresolvedLocalImports),
  );
  if (unresolvedLocalImports.length > 0)
    return { kind: "unresolved-local-import", unresolvedLocalImports };

  // A package of this workspace that could not be reached read nothing as far
  // as the comparisons below can tell, and the second of them would call this
  // declaration's own `required` entries stale over it — advice that breaks
  // the run it is meant to protect. So the import that reached no file is
  // reported as itself, before anything is concluded from reads it took away.
  const unresolvedImports = mergeUnresolved(
    environment.unresolvedImports,
    ...also.map((file) => file.read.unresolvedImports),
  );
  if (unresolvedImports.length > 0)
    return { kind: "unresolved-workspace-import", unresolvedImports };

  // A helper handed the whole environment reads settings for this declaration,
  // and one whose reads cannot be determined leaves them out of every list
  // below without anything saying so.
  const handedOn = mergeUnreadable(
    environment.unreadable,
    ...also.map((file) => file.read.unreadable),
  ).filter(
    (use) =>
      !(use.spread && use.module === (accountedSpreads?.module ?? null)),
  );
  if (handedOn.length > 0) return { kind: "unreadable-environment", handedOn };

  const reads = environment.reads;
  const declared = new Set([
    ...declaration.required,
    ...declaration.optional,
  ]);
  const readIn = (
    names: readonly string[],
    where: Map<string, string[]>,
  ): { name: string; modules: string[] }[] =>
    names.map((name) => ({
      name,
      modules: [...new Set(where.get(name) ?? [])],
    }));

  // Before the undeclared reads below, because a refused setting read again
  // is one of those, and the advice for it is the opposite: the module that
  // reads it is what came back into what this declaration reaches, so that
  // module is named and the entry stating it is not read stands.
  const reachedAgain = (neverRead?.settings ?? [])
    .map((name) => ({
      name,
      modules: [
        ...new Set([
          ...(reads.get(name) ?? []),
          ...also.flatMap((file) => file.read.reads.get(name) ?? []),
        ]),
      ],
    }))
    .filter((entry) => entry.modules.length > 0);
  if (neverRead && reachedAgain.length > 0)
    return {
      kind: neverRead.readKind,
      settings: reachedAgain.map((entry) => entry.name),
      readIn: reachedAgain,
    };

  const undeclared = [...reads.keys()].filter((name) => !declared.has(name));
  if (undeclared.length > 0)
    return {
      kind: "undeclared-setting",
      settings: undeclared,
      readIn: readIn(undeclared, reads),
    };

  // The same gap, one file further out, and each of those files reported as
  // its own thing: what a config takes as Playwright loads it and what the
  // module deciding the run takes are the same omission in different places,
  // and the reader is sent to the one that has it.
  for (const file of also) {
    const undeclaredThere = [...file.read.reads.keys()].filter(
      (name) => !declared.has(name),
    );
    if (undeclaredThere.length > 0)
      return {
        kind: file.kind,
        settings: undeclaredThere,
        readIn: readIn(undeclaredThere, file.read.reads),
      };
  }

  // And the same comparison the other way. A `required` entry stops the run
  // before any case loads, so one nothing reads any more stops it over a
  // setting nobody has to configure — the same wasted trip as a missing one,
  // pointing at the wrong thing. One only another of these files reads is
  // still read.
  const read = (name: string): boolean =>
    reads.has(name) || also.some((file) => file.read.reads.has(name));
  const unrequired = declaration.required.filter((name) => !read(name));
  if (unrequired.length > 0)
    return { kind: "unread-required", settings: [...unrequired] };

  const unread = declaration.optional.filter((name) => !read(name));
  if (unread.length > 0)
    return { kind: "unread-optional", settings: [...unread] };
  return null;
}

/** The same, for the places a run reaches the environment unreadably. */
function mergeUnreadable(
  ...lists: readonly EnvironmentUseProblem[][]
): EnvironmentUseProblem[] {
  const seen = new Set<string>();
  const merged: EnvironmentUseProblem[] = [];
  for (const entry of lists.flat()) {
    const key = `${entry.module}|${entry.use}|${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

/** The ways a declaration and the reads it is held to can disagree. */
export type SettingsProblemKind =
  | "unreadable-settings"
  | "unresolved-local-import"
  | "unresolved-workspace-import"
  | "unreadable-environment"
  | "undeclared-setting"
  | "unread-required"
  | "unread-optional";

/**
 * One such disagreement, as the part of a report that describes it. `K` is
 * the kind a caller reporting a second file's reads separately gives them —
 * a config's, which are its suite's and worse to leave undeclared. A caller
 * comparing one file only names none, and is held to the kinds above.
 */
export interface SettingsProblem<K extends string = never> {
  kind: SettingsProblemKind | K;
  /** The settings at issue, for a problem about what is declared. */
  settings?: string[];
  /** Where each of those is read, for one read but not declared. */
  readIn?: { name: string; modules: string[] }[];
  /** The parts of the declared lists this check could not read. */
  unreadable?: string[];
  /** Where the files reach the environment, for a use nothing can follow. */
  handedOn?: EnvironmentUseProblem[];
  /** The workspace imports that reached no file, so nothing read them. */
  unresolvedImports?: WorkspaceImportProblem[];
  /** The imports of a file beside one of them that reached no file. */
  unresolvedLocalImports?: LocalImportProblem[];
}

/**
 * Words a value may be written straight after, so a use following one of
 * them is the expression itself and not part of some other name. Each is a
 * keyword no code can use as a name of its own, which is what makes the set
 * safe: a word ending in these letters — `staircase`, `myReturn` — is a name
 * and is not one of these.
 *
 * The words that introduce a name are deliberately absent. What follows
 * `const`, `let`, `var`, `function`, `class`, `import` or `export` is the
 * name being declared rather than a value, and the `env` of
 * `const env = process.env` is exactly the match the guard below exists to
 * pass over. So are the words taking a parenthesis — `if`, `for`, `while`,
 * `switch`, `catch` — which is the character in front of a use inside one of
 * them, never the word itself.
 */
const KEYWORD_BEFORE_A_VALUE = new Set([
  "await",
  "case",
  "default",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/**
 * The whole word written in front of a match, where whitespace separates the
 * two: `return` for `return process.env.X`. Empty where the text runs
 * straight into the match, which makes the two one name — the `process` of
 * `myprocess.env` — rather than a word standing in front of a value.
 */
function wordBefore(code: string, index: number): string {
  let end = index;
  while (end > 0 && /\s/.test(code[end - 1]!)) end -= 1;
  if (end === index) return "";
  let start = end;
  while (start > 0 && /[\w$]/.test(code[start - 1]!)) start -= 1;
  return code.slice(start, end);
}

/**
 * Whether a match beginning here is a use of the expression itself, rather
 * than a name that belongs to something else. A word character in front of
 * it usually makes it the name a declaration is introducing — the `env` of
 * `const env =` — and a `.` makes it a property of another object:
 * `globalThis.process.env`, or the `env` of `process.env` while the name
 * holding the environment is what is being scanned for.
 *
 * A keyword is the exception to the word character: `return process.env.X`,
 * `await process.env.X`, `case process.env.X` are reads like any other, and
 * refusing them would leave a setting undeclared, a `required` entry
 * reported as unread while it is read, and an `unused` entry defeated by
 * where the read happens to be written. So the whole word is read and
 * weighed against the keywords above, which no name can be.
 *
 * The one `.` that does not is the last of a spread's three. `{ ...env }`
 * hands on everything that name holds, which is a use of it and a read of
 * nothing else, so a spread is taken rather than passed over with the
 * property reads.
 */
function startsAUse(code: string, index: number, previous: string): boolean {
  if (previous === ".") return spreadBefore(code, index);
  if (!/[\w$]/.test(previous)) return true;
  return KEYWORD_BEFORE_A_VALUE.has(wordBefore(code, index));
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const failure = checkWorkspace(root);
  if (failure) {
    console.error(
      `\nBrowser test requirement convention violated\n\n${failure}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const configs = findPlaywrightConfigs(root);
  console.log(
    `All ${configs.length} Playwright config${configs.length === 1 ? "" : "s"} in this workspace decide their settings requirement in ${GLOBAL_SETUP_KEY}, each announcing the suite declared for the spec it runs, and each of those suites declares every setting its cases, its config, and that ${GLOBAL_SETUP_KEY} module read.`,
  );
}

/**
 * The run itself, and the last thing in this module, so that every
 * declaration it reaches has been evaluated by the time it starts.
 *
 * It used to sit in the middle of the file, with helpers and their constants
 * declared below it. Those helpers ran while the module was still being
 * evaluated, so a `const` below the call was still in its temporal dead zone:
 * reading one threw `Cannot access X before initialization` and the command
 * died instead of reporting the wiring problem it had just found. Which
 * constant, and whether it was reached at all, depended on the manifests in
 * the tree — a constant read on one branch only stays dormant until a package
 * writes its `exports` in the shape that takes it — so the breakage arrived
 * long after the arrangement that allowed it.
 *
 * Importing this module never reaches this line, which is why no unit suite
 * caught that: a whole suite passes green over a script that cannot start.
 * The ordering is held to by a case in
 * scripts/tests/checkBrowserTestRequirements.test.ts instead.
 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
