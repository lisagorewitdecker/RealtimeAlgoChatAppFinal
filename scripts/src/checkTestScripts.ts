/**
 * Workspace consistency check: every test suite in the workspace runs from one
 * root command.
 *
 * That command is `pnpm run test`. It runs the `node:test` suites discovered by
 * pattern (see runUnitTests.ts) and then `pnpm -r --if-present run test`, which
 * hands every other suite to the runner its own package owns — vitest in
 * `artifacts/api-server`, jest in `artifacts/chat-app`. Each package keeps its
 * own `test` script; the root drives them instead of restating what they run.
 *
 * `--if-present` is what lets one command drive three runners, and it is also
 * the hole this check closes: a package that holds suites but declares no
 * `test` script is skipped without a word and the run still reports success —
 * the same silent green a forgotten path in the old hardcoded unit-test list
 * produced.
 *
 * Two things therefore fail here:
 *   - a package holding test files that neither the root `node:test` discovery
 *     nor its own `test` script reaches;
 *   - a root `test` script that has dropped one of its two halves, or joins
 *     them with an operator that lets one runner's failure go unreported.
 *
 * The same silence reaches the checks in front of those suites. `pnpm run test`
 * runs the workspace checks before handing over to the runners, and
 * `pnpm run typecheck` runs one more, and every one of them exists to stop a
 * quiet pass of its own — a suite nothing runs, a browser config nothing
 * starts, a setting no run declares. Drop one from the chain, in a merge or in
 * an edit of that one long line, and it simply stops running while both
 * commands go on reporting success: the failure mode each of those checks was
 * written to catch, turned on the checks themselves. So a third thing fails
 * here:
 *   - a `check:*` script the root declares that neither chain runs, or that a
 *     chain reaches through `;` or `||`, where its failure would be reported
 *     over by a later command.
 *
 * Running it means a runner that finds it where it looks. A filter is not a
 * promise: `pnpm --filter @workspace/typo run check:browser-output` prints
 * that it matched nothing and exits 0, and so does a filter naming a package
 * that declares no such script, so a chain can name every check and run none
 * of them. Each command is therefore resolved against the package it selects.
 *
 * A check lives in the package that holds it and reaches the chains through a
 * root script of its own — every root `check:*` script here delegates to the
 * package's script of the same name. Holding only the root's scripts to the
 * rule above would leave the level below it unguarded: a `check:*` script a
 * package declares that no root script wraps is run by nothing and reported by
 * nothing, and the rule never sees it, because a check that was never wired up
 * is missing from the manifest it reads. That is the same silent green, one
 * level down, so a fourth thing fails here:
 *   - a `check:*` script any package declares that no full-run command reaches
 *     and no root check script runs.
 *
 * Reaching a wrapper is not reaching the check it wraps, either: what runs the
 * check is the command inside that wrapper, so that command is what is read —
 * a wrapper whose own `;` reports the check's failure over, or whose filter
 * selects a package that no longer declares it, runs the check no more than a
 * chain that dropped it does.
 *
 * Which checks those are is read from the manifests rather than listed here,
 * so a check added later is covered without editing this file. One kept out of
 * both chains on purpose is stated in the root manifest's
 * `checksOutsideFullRun` with the reason it stays out — `check:debugger` and
 * `check:fonts` are run by workflows instead, one needing the workspace's
 * desktop libraries and one a full production build — so leaving a check out
 * is a sentence someone wrote rather than an absence nobody noticed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectWorkspacePackages,
  splitSegments,
  tokenize,
  type WorkspacePackage,
} from "./checkTypecheckScripts.ts";
import { findUnitTestFiles, UNIT_TEST_DIR } from "./runUnitTests.ts";

/** Root script that runs every suite in the workspace. */
export const ROOT_TEST_SCRIPT = "test";

/** Script each package exposes its own runner through. */
export const PACKAGE_TEST_SCRIPT = "test";

/** Root script that runs the `node:test` suites. */
export const UNIT_TEST_SCRIPT = "test:unit";

/** Root script that typechecks the workspace, and runs a check of its own. */
export const ROOT_TYPECHECK_SCRIPT = "typecheck";

/** The commands a green run of this workspace is claimed on. */
export const FULL_RUN_SCRIPTS = [
  ROOT_TEST_SCRIPT,
  ROOT_TYPECHECK_SCRIPT,
] as const;

/** How a workspace check's script is named. */
export const CHECK_SCRIPT_PREFIX = "check:";

/** Root manifest field stating a check that stays out of the full run. */
export const EXEMPTION_FIELD = "checksOutsideFullRun";

/** The half of the root command that drives each package's own runner. */
export const RECURSIVE_TEST_COMMAND = `pnpm -r --if-present run ${PACKAGE_TEST_SCRIPT}`;

/** A test suite, whichever runner owns it. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Directories that hold no authored suites: dependencies and build output. */
export const IGNORED_DIRECTORIES = new Set([
  ".expo",
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "static-build",
  "test-results",
]);

const toPosix = (value: string): string => value.split(path.sep).join("/");

const basename = (value: string): string => value.split("/").pop() ?? value;

const FILTER_FLAGS = new Set(["--filter", "-F", "--workspace", "-C", "--dir"]);

/**
 * Test files inside one package directory, as workspace-relative paths sorted
 * for a stable report. Symlinks are not followed: pnpm's `node_modules` is
 * built from them, and a suite reached that way belongs to another package.
 */
export function findTestFiles(root: string, dir: string): string[] {
  const files: string[] = [];
  const walk = (relative: string): void => {
    let entries;
    try {
      entries = readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch {
      return; // a directory that cannot be read holds nothing to run
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(child);
        continue;
      }
      if (TEST_FILE.test(entry.name)) files.push(toPosix(child));
    }
  };
  walk(dir);
  return files.sort();
}

export interface PackageViolation {
  dir: string;
  name: string;
  /** Suites in that package no root command reaches, workspace-relative. */
  files: string[];
}

/**
 * Packages holding suites the root command cannot run. A package is covered
 * either by declaring a `test` script or by keeping every suite in its
 * `tests/` directory, where the root `node:test` discovery finds them.
 */
export function findPackageViolations(
  root: string,
  packages: WorkspacePackage[],
): PackageViolation[] {
  const violations: PackageViolation[] = [];
  for (const pkg of packages) {
    // The workspace root drives the packages; its own directory is every
    // package's parent, so scanning it would re-report their suites.
    if (toPosix(pkg.dir) === ".") continue;
    if (PACKAGE_TEST_SCRIPT in pkg.scripts) continue;
    const unitSuites = new Set(findUnitTestFiles(root, [pkg.dir]));
    const files = findTestFiles(root, pkg.dir).filter(
      (file) => !unitSuites.has(file),
    );
    if (files.length > 0)
      violations.push({ dir: pkg.dir, name: pkg.name, files });
  }
  return violations;
}

export type RootScriptProblem =
  /** The workspace root declares no `test` script at all. */
  | "missing"
  /** Nothing in it runs the `node:test` suites. */
  | "no-unit-suites"
  /** Nothing in it runs each package's own `test` script. */
  | "no-package-runners"
  /** Its parts are joined so a failing runner can be masked by a later one. */
  | "maskable";

const tokenValues = (segment: string): string[] =>
  tokenize(segment).map((token) => token.value);

/** `pnpm run test:unit`, or anything else naming that script. */
function runsUnitSuites(segment: string): boolean {
  return tokenValues(segment).includes(UNIT_TEST_SCRIPT);
}

/** `pnpm -r --if-present run test`: every package, none filtered out. */
function runsPackageRunners(segment: string): boolean {
  const values = tokenValues(segment);
  const head = values[0];
  if (!head || basename(head) !== "pnpm") return false;
  if (!values.includes("-r") && !values.includes("--recursive")) return false;
  const filtered = values.some(
    (value) =>
      FILTER_FLAGS.has(value) ||
      value.startsWith("--filter=") ||
      value.startsWith("--workspace="),
  );
  if (filtered) return false;
  const runIndex = values.indexOf("run");
  return runIndex !== -1 && values[runIndex + 1] === PACKAGE_TEST_SCRIPT;
}

/** Everything wrong with the root `test` script, in reporting order. */
export function findRootScriptProblems(
  command: string | undefined,
): RootScriptProblem[] {
  if (command === undefined) return ["missing"];

  const segments = splitSegments(command);
  const problems: RootScriptProblem[] = [];
  if (!segments.some((segment) => runsUnitSuites(segment.text))) {
    problems.push("no-unit-suites");
  }
  if (!segments.some((segment) => runsPackageRunners(segment.text))) {
    problems.push("no-package-runners");
  }
  // `a; b` and `a || b` both report only b's exit status, so a runner that
  // failed earlier in the chain would never fail the command.
  const chained = segments.every(
    (segment) =>
      segment.operatorBefore === "start" || segment.operatorBefore === "&&",
  );
  if (!chained) problems.push("maskable");
  return problems;
}

/** Programs that run a package script. */
const PACKAGE_RUNNERS = new Set(["pnpm", "npm", "yarn", "bun"]);

/** Shells that take the command to run as a quoted argument. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

/** `CI=true pnpm run test` starts pnpm, not a program named `CI=true`. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** One command of a script, with the operator that reached it. */
type Segment = ReturnType<typeof splitSegments>[number];

/** The program a command starts, past whatever it sets in the environment. */
function program(values: string[]): string | null {
  const head = values.find((value) => !ENV_ASSIGNMENT.test(value));
  return head === undefined ? null : basename(head);
}

/**
 * The script one command runs, where it runs one. The evidence is the
 * invocation itself — a package runner, its `run` subcommand, and the name
 * handed to it — because a script name written anywhere else runs nothing: a
 * path, a message, an `echo` of what a chain used to do.
 */
export function invokedScript(segment: string): string | null {
  const values = tokenValues(segment);
  const head = program(values);
  if (head === null || !PACKAGE_RUNNERS.has(head)) return null;
  const runIndex = values.indexOf("run");
  if (runIndex === -1) return null;
  // Whatever filter or flag the runner was given, the script it runs is the
  // first plain word after `run`.
  return (
    values.slice(runIndex + 1).find((value) => !value.startsWith("-")) ?? null
  );
}

/** Flags naming the packages a runner selects. */
const SELECTOR_FLAGS = new Set([
  "--filter",
  "--filter-prod",
  "-F",
  "--workspace", // npm's spelling of the same thing
]);

/** Flags naming the directory a runner works in. */
const DIRECTORY_FLAGS = new Set(["--dir", "-C"]);

/** Flags aiming a runner at the workspace root itself. */
const ROOT_FLAGS = new Set(["--workspace-root", "-w"]);

/** Flags selecting every package in the workspace. */
const RECURSIVE_FLAGS = new Set(["--recursive", "-r"]);

/** What a runner's flags select to run the script in. */
type Selection =
  | { kind: "root" }
  | { kind: "packages"; packages: WorkspacePackage[] }
  /** A selector this check cannot resolve, so it credits nothing to it. */
  | { kind: "unreadable" };

/** The value of a flag written either `--flag value` or `--flag=value`. */
function flagValues(values: string[], flags: Set<string>): string[] {
  const found: string[] = [];
  values.forEach((value, index) => {
    if (flags.has(value)) {
      const next = values[index + 1];
      if (next !== undefined && !next.startsWith("-")) found.push(next);
      return;
    }
    const split = value.indexOf("=");
    if (split !== -1 && flags.has(value.slice(0, split))) {
      found.push(value.slice(split + 1));
    }
  });
  return found;
}

const GLOB_PATTERN = (glob: string, separator: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .split("**")
      .map((part) => part.split("*").join(`[^${separator}]*`))
      .join(".*")}$`,
  );

/** The packages a directory selector reaches: the one there and any below it. */
function packagesUnder(
  selector: string,
  packages: WorkspacePackage[],
): WorkspacePackage[] {
  const dir = toPosix(selector).replace(/^\.\//, "").replace(/\/+$/, "") || ".";
  const pattern = GLOB_PATTERN(dir, "/");
  return packages.filter((pkg) => {
    const own = toPosix(pkg.dir);
    if (pattern.test(own)) return true;
    return !dir.includes("*") && own.startsWith(`${dir}/`);
  });
}

/**
 * The packages one `--filter` selects, or null where the selector cannot be
 * read. pnpm matches a package by its name, by that name without its scope, or
 * by the directory it sits in, and a dependency selector (`...pkg`) widens the
 * selection around the package named rather than replacing it.
 */
function packagesSelected(
  selector: string,
  packages: WorkspacePackage[],
): WorkspacePackage[] | null {
  let value = selector.replace(/^\.{3}\^?/, "").replace(/\^?\.{3}$/, "");
  if (value.startsWith("{") && value.endsWith("}")) value = value.slice(1, -1);
  // `[origin/main]` selects whatever changed since a commit, which is not a
  // property of the workspace as it stands.
  if (value === "" || value.includes("[")) return null;
  if (value.startsWith(".") || (value.includes("/") && !value.startsWith("@"))) {
    return packagesUnder(value, packages);
  }
  const pattern = GLOB_PATTERN(value, "");
  return packages.filter(
    (pkg) => pattern.test(pkg.name) || pattern.test(pkg.name.split("/").pop()!),
  );
}

/** Where one command's runner looks for the script it was handed. */
function selectionOf(
  values: string[],
  packages: WorkspacePackage[],
): Selection {
  const selectors = [
    ...flagValues(values, SELECTOR_FLAGS),
    ...flagValues(values, DIRECTORY_FLAGS),
  ];
  if (selectors.length === 0) {
    if (values.some((value) => RECURSIVE_FLAGS.has(value))) {
      // The root's own script is not one of them: pnpm leaves it out unless
      // asked for it by name.
      return {
        kind: "packages",
        packages: packages.filter((pkg) => toPosix(pkg.dir) !== "."),
      };
    }
    return { kind: "root" }; // a runner given no filter runs the root's own
  }
  if (values.some((value) => ROOT_FLAGS.has(value))) return { kind: "root" };

  const selected = new Map<string, WorkspacePackage>();
  for (const selector of selectors) {
    const matched = packagesSelected(selector, packages);
    if (matched === null) return { kind: "unreadable" };
    for (const pkg of matched) selected.set(pkg.dir, pkg);
  }
  return { kind: "packages", packages: [...selected.values()] };
}

/** The command a `sh -c '…'` wrapper runs, or null where it wraps none. */
function nestedCommand(segment: string): string | null {
  const values = tokenValues(segment);
  const head = program(values);
  if (head === null || !SHELLS.has(head)) return null;
  const flag = values.indexOf("-c");
  return flag === -1 ? null : (values[flag + 1] ?? null);
}

/**
 * Whether one command's own result decides its script's. A command after `||`
 * runs only when something before it failed, and any later `;`, `||` or `|`
 * puts another command's exit status in front of this one's — either way, the
 * script can report success over this command having failed or never run.
 */
function decidesOutcome(segments: Segment[], index: number): boolean {
  const operator = segments[index]!.operatorBefore;
  if (operator === "||" || operator === "|") return false;
  return segments
    .slice(index + 1)
    .every((later) => later.operatorBefore === "&&");
}

/**
 * What a command's runner finds where it looks. A filter is not a promise: a
 * runner told to run a script in a package that is not there, or in one that
 * declares no such script, prints that it matched nothing and exits 0 — so a
 * command that names a check can still run no check at all.
 */
export type RunTarget =
  /** The root's own script of that name. */
  | "root"
  /** A workspace package that declares it. */
  | "package"
  /** The filter selects no package at all, so the runner runs nothing. */
  | "no-package"
  /** The packages it selects declare no such script, so nothing runs. */
  | "no-script"
  /** The selector cannot be resolved, so nothing can be credited to it. */
  | "unreadable";

/** One script run by another, with what a successful run of that one means. */
interface Invocation {
  /** The script name the command hands its runner. */
  script: string;
  /** The command that runs it, as written. */
  command: string;
  /** Whether the running script passing means this ran and passed too. */
  decisive: boolean;
  /** Where the runner looks for it, and whether anything is there. */
  target: RunTarget;
  /** Directories of the packages whose script of that name would run. */
  dirs: string[];
}

/** Where one command's runner would find the script it names. */
function invocationTarget(
  command: string,
  script: string,
  packages: WorkspacePackage[],
): Pick<Invocation, "target" | "dirs"> {
  const selection = selectionOf(tokenValues(command), packages);
  if (selection.kind === "root") return { target: "root", dirs: [] };
  if (selection.kind === "unreadable") return { target: "unreadable", dirs: [] };
  if (selection.packages.length === 0)
    return { target: "no-package", dirs: [] };
  const found = selection.packages.filter((pkg) => script in pkg.scripts);
  return found.length === 0
    ? { target: "no-script", dirs: [] }
    : { target: "package", dirs: found.map((pkg) => toPosix(pkg.dir)) };
}

/** Every script one command runs, through a `sh -c` wrapper as well. */
function commandInvocations(
  command: string,
  decisive: boolean,
  packages: WorkspacePackage[],
): Invocation[] {
  const segments = splitSegments(command);
  const invocations: Invocation[] = [];
  segments.forEach((segment, index) => {
    const decides = decisive && decidesOutcome(segments, index);
    const nested = nestedCommand(segment.text);
    if (nested !== null) {
      invocations.push(...commandInvocations(nested, decides, packages));
      return;
    }
    const script = invokedScript(segment.text);
    if (script !== null) {
      invocations.push({
        script,
        command: segment.text,
        decisive: decides,
        ...invocationTarget(segment.text, script, packages),
      });
    }
  });
  return invocations;
}

/** How one of the full-run commands reaches a script. */
export interface ScriptRun {
  /** The full-run command it was reached from. */
  chain: string;
  /** The root script that command is written in — a chain, or one it runs. */
  owner: string;
  /** The command that runs it, as written. */
  command: string;
  /** Whether that chain passing means this script ran and passed. */
  decisive: boolean;
  /** Where that command's runner finds it, if anywhere. */
  target: RunTarget;
}

/** One script a full-run command runs, and where its runner finds it. */
export interface FullRunInvocation extends ScriptRun {
  /** The script name the command hands its runner. */
  script: string;
  /** Directories of the packages whose script of that name would run. */
  dirs: string[];
  /** Whether it only reaches the root script that runs the check itself. */
  passThrough: boolean;
}

/** How much a way of reaching a script proves, worst to best. */
const proof = (run: Pick<ScriptRun, "decisive" | "target">): number => {
  if (run.target === "no-package" || run.target === "no-script") return 0;
  if (run.target === "unreadable") return 1;
  return run.decisive ? 3 : 2;
};

/**
 * Every command the full-run commands run a script through, directly or
 * through another root script they run, in the order they reach them.
 */
export function findFullRunInvocations(
  scripts: Record<string, string>,
  packages: WorkspacePackage[] = [],
): FullRunInvocation[] {
  const reached: FullRunInvocation[] = [];
  /**
   * Whether a root script hands the check of its own name somewhere else —
   * the shape every root `check:*` script has. Reaching such a script says
   * nothing about the check: what runs it is the command inside it.
   */
  const wraps = (name: string): boolean =>
    commandInvocations(scripts[name] ?? "", true, packages).some(
      (invocation) => invocation.script === name,
    );
  const visit = (
    name: string,
    chain: string,
    decisive: boolean,
    seen: Set<string>,
  ): void => {
    const command = scripts[name];
    if (command === undefined) return; // a script of some other package
    const step = `${name} ${decisive}`;
    if (seen.has(step)) return; // `pnpm -r run test` reaches the root's own
    seen.add(step);
    for (const invocation of commandInvocations(command, decisive, packages)) {
      const passThrough =
        invocation.target === "root" && wraps(invocation.script);
      reached.push({ chain, owner: name, passThrough, ...invocation });
      // Only a root script's own body is read on: a command filtered to
      // another package runs that package's script, whatever the root's
      // script of the same name happens to run.
      if (invocation.target === "root") {
        visit(invocation.script, chain, invocation.decisive, seen);
      }
    }
  };
  for (const entry of FULL_RUN_SCRIPTS) visit(entry, entry, true, new Set());
  return reached;
}

/**
 * Every script the full-run commands reach, directly or through another root
 * script they run, and what a green run of that command says about each. A
 * script reached more than one way keeps the reading that proves the most.
 */
export function findFullRunScripts(
  scripts: Record<string, string>,
  packages: WorkspacePackage[] = [],
): Map<string, ScriptRun> {
  return bestRuns(findFullRunInvocations(scripts, packages));
}

/** The reading of each script that proves the most, by script name. */
function bestRuns(invocations: FullRunInvocation[]): Map<string, ScriptRun> {
  const runs = new Map<string, ScriptRun>();
  for (const invocation of invocations) {
    // Reaching a wrapper proves only what the command inside it proves, so
    // the reading that counts is that one — a wrapper whose own command runs
    // nothing, or reports its failure over, is where the check stops. The
    // reading is kept where the chain reaches the wrapper past a `;` or a
    // `||`, because then that chain, not the wrapper, is where it stops.
    if (invocation.passThrough && invocation.decisive) continue;
    const known = runs.get(invocation.script);
    if (known === undefined || proof(known) < proof(invocation)) {
      runs.set(invocation.script, {
        chain: invocation.chain,
        owner: invocation.owner,
        command: invocation.command,
        decisive: invocation.decisive,
        target: invocation.target,
      });
    }
  }
  return runs;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The root manifest's own fields. `collectWorkspacePackages` reads the scripts
 * out of it; what is stated beside them is read here.
 */
export function readRootManifest(root: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return {}; // collectWorkspacePackages reports a root it cannot read
  }
  return isPlainObject(parsed) ? parsed : {};
}

/**
 * The checks the root manifest states are outside the full run, each with the
 * reason it states — null where it states none, since a bare name says only
 * that someone wanted the check to stop failing this.
 */
export function readExemptions(stated: unknown): Map<string, string | null> {
  const exemptions = new Map<string, string | null>();
  if (!isPlainObject(stated)) return exemptions;
  for (const [script, reason] of Object.entries(stated)) {
    const written = typeof reason === "string" ? reason.trim() : "";
    exemptions.set(script, written === "" ? null : written);
  }
  return exemptions;
}

export type CheckCoverageProblem =
  /** Neither full-run command runs it. */
  | { kind: "unrun"; script: string; command: string }
  /** A package declares it and no root script runs it, so no chain can. */
  | {
      kind: "unwrapped";
      script: string;
      /** Workspace-relative directory of the package declaring it. */
      dir: string;
      /** That package's name, for the root script that would wrap it. */
      name: string;
      command: string;
    }
  /**
   * A chain reaches it where its failure would be reported over. `chain` is
   * the root script that command is written in: a full-run command, or the
   * check script one of them runs to reach this check.
   */
  | { kind: "masked"; script: string; chain: string; command: string }
  /** The command a chain reaches it through runs no check at all. */
  | {
      kind: "runs-nothing";
      script: string;
      /** The root script that command is written in, as above. */
      chain: string;
      command: string;
      /** Whether the filter selects no package, or none declaring the check. */
      reason: "no-package" | "no-script";
    }
  /** A chain reaches it through a selector this check cannot resolve. */
  | { kind: "unreadable-filter"; script: string; chain: string; command: string }
  /** Stated as outside the full run, and yet a chain runs it. */
  | { kind: "stated-and-run"; script: string; chain: string }
  /** Stated as outside the full run without saying why. */
  | { kind: "stated-without-reason"; script: string }
  /** Stated for a check the root declares no script for. */
  | { kind: "stated-without-script"; script: string }
  /** The statement itself cannot be read as check name to reason. */
  | { kind: "unreadable-statement" };

/** A check, in the package whose manifest declares it. */
const declaration = (dir: string, script: string): string =>
  `${toPosix(dir)}\u0000${script}`;

/** Every check the full-run commands reach in the package that declares it. */
function findReachedDeclarations(
  invocations: FullRunInvocation[],
): Map<string, FullRunInvocation> {
  const reached = new Map<string, FullRunInvocation>();
  for (const invocation of invocations) {
    for (const dir of invocation.dirs) {
      const key = declaration(dir, invocation.script);
      const known = reached.get(key);
      if (known === undefined || (!known.decisive && invocation.decisive)) {
        reached.set(key, invocation);
      }
    }
  }
  return reached;
}

/**
 * Every check a root `check:*` script runs, in the package that declares it.
 * Such a check is accounted for wherever its root script lands: that script is
 * held to the rule above, so a wrapper no chain runs is reported once, against
 * the root, rather than twice.
 */
function findWrappedDeclarations(
  scripts: Record<string, string>,
  packages: WorkspacePackage[],
): Set<string> {
  const wrapped = new Set<string>();
  for (const [script, command] of Object.entries(scripts)) {
    if (!script.startsWith(CHECK_SCRIPT_PREFIX)) continue;
    for (const invocation of commandInvocations(command, true, packages)) {
      for (const dir of invocation.dirs) {
        wrapped.add(declaration(dir, invocation.script));
      }
    }
  }
  return wrapped;
}

/**
 * Every check the full run no longer accounts for. The checks are read off the
 * manifests by their `check:` prefix — the root's own, and every package's —
 * so one added later is held to this without anything here naming it.
 */
export function findCheckCoverageProblems(
  scripts: Record<string, string>,
  stated: unknown,
  packages: WorkspacePackage[] = [],
): CheckCoverageProblem[] {
  const problems: CheckCoverageProblem[] = [];
  if (stated !== undefined && !isPlainObject(stated)) {
    problems.push({ kind: "unreadable-statement" });
  }
  const exemptions = readExemptions(stated);
  const invocations = findFullRunInvocations(scripts, packages);
  const runs = bestRuns(invocations);
  const reached = findReachedDeclarations(invocations);
  const wrapped = findWrappedDeclarations(scripts, packages);

  for (const [script, command] of Object.entries(scripts)) {
    if (!script.startsWith(CHECK_SCRIPT_PREFIX)) continue;
    const run = runs.get(script);
    // A command whose runner finds nothing where it looks is not a run: it
    // exits 0 having run no check, which is the absence this check is for.
    const ran =
      run !== undefined && (run.target === "root" || run.target === "package");
    if (exemptions.has(script)) {
      if (ran) {
        problems.push({ kind: "stated-and-run", script, chain: run.chain });
      } else if (exemptions.get(script) === null) {
        problems.push({ kind: "stated-without-reason", script });
      }
      continue;
    }
    if (run === undefined) {
      problems.push({ kind: "unrun", script, command });
      continue;
    }
    if (run.target === "no-package" || run.target === "no-script") {
      problems.push({
        kind: "runs-nothing",
        script,
        chain: run.owner,
        command: run.command,
        reason: run.target,
      });
      continue;
    }
    if (run.target === "unreadable") {
      problems.push({
        kind: "unreadable-filter",
        script,
        chain: run.owner,
        command: run.command,
      });
      continue;
    }
    if (!run.decisive) {
      problems.push({
        kind: "masked",
        script,
        chain: run.owner,
        command: run.command,
      });
    }
  }

  for (const pkg of packages) {
    // The root's own checks are the loop above; this is the level below it.
    if (toPosix(pkg.dir) === ".") continue;
    for (const [script, command] of Object.entries(pkg.scripts)) {
      if (!script.startsWith(CHECK_SCRIPT_PREFIX)) continue;
      const run = reached.get(declaration(pkg.dir, script));
      if (exemptions.has(script)) {
        // Where the root declares a check of that name, the loop above has
        // already read the statement against it; this speaks for the ones it
        // could not see.
        if (run !== undefined && !(script in scripts)) {
          problems.push({ kind: "stated-and-run", script, chain: run.chain });
        }
        continue;
      }
      if (run !== undefined) {
        // Where the root declares a check of that name, the loop above reads
        // the same command; this speaks for a chain running a package's check
        // with no root script of its own between them.
        if (!run.decisive && !(script in scripts)) {
          problems.push({
            kind: "masked",
            script,
            chain: run.owner,
            command: run.command,
          });
        }
        continue;
      }
      if (wrapped.has(declaration(pkg.dir, script))) continue;
      problems.push({
        kind: "unwrapped",
        script,
        dir: toPosix(pkg.dir),
        name: pkg.name,
        command,
      });
    }
  }

  const declaredChecks = new Set<string>([
    ...Object.keys(scripts),
    ...packages.flatMap((pkg) => Object.keys(pkg.scripts)),
  ]);
  for (const script of exemptions.keys()) {
    const declared =
      script.startsWith(CHECK_SCRIPT_PREFIX) && declaredChecks.has(script);
    if (!declared) problems.push({ kind: "stated-without-script", script });
  }
  return problems;
}

const WHY = [
  `Why: \`pnpm run ${ROOT_TEST_SCRIPT}\` is the one command that runs every suite in the`,
  "workspace, across all three runners. It runs the node:test suites and then",
  `\`${RECURSIVE_TEST_COMMAND}\`, which hands the rest to the runner each package`,
  "owns. A package with suites and no `test` script is skipped by --if-present",
  "in silence, so a broken suite there stays green exactly the way a forgotten",
  "path in a hardcoded test list did.",
].join("\n");

const ROOT_PROBLEM_EXPLANATION: Record<RootScriptProblem, string> = {
  missing: `the workspace root declares no "${ROOT_TEST_SCRIPT}" script`,
  "no-unit-suites": `nothing runs the node:test suites (\`pnpm run ${UNIT_TEST_SCRIPT}\`)`,
  "no-package-runners": `nothing runs each package's own "${PACKAGE_TEST_SCRIPT}" script (\`${RECURSIVE_TEST_COMMAND}\`)`,
  maskable:
    "its parts are joined with `;` or `||`, so only the last one's failure is reported",
};

export function formatRootProblems(
  problems: RootScriptProblem[],
  command: string | undefined,
): string {
  const lines = [
    `The root "${ROOT_TEST_SCRIPT}" script no longer runs every suite:`,
    "",
  ];
  if (command !== undefined) lines.push(`      now: ${command}`);
  for (const problem of problems) {
    lines.push(`      problem: ${ROOT_PROBLEM_EXPLANATION[problem]}`);
  }
  lines.push(
    `      fix: "${ROOT_TEST_SCRIPT}": "pnpm run ${UNIT_TEST_SCRIPT} && ${RECURSIVE_TEST_COMMAND}"`,
    "",
  );
  return lines.join("\n");
}

export function formatPackageViolations(
  violations: PackageViolation[],
): string {
  const total = violations.reduce(
    (count, violation) => count + violation.files.length,
    0,
  );
  const lines = [
    `${total} test file${total === 1 ? "" : "s"} in ${violations.length} package${
      violations.length === 1 ? "" : "s"
    } cannot be run from the workspace root:`,
    "",
  ];
  for (const violation of violations) {
    lines.push(
      `  ${violation.dir}/package.json declares no "${PACKAGE_TEST_SCRIPT}" script`,
    );
    for (const file of violation.files.slice(0, 10))
      lines.push(`      ${file}`);
    if (violation.files.length > 10) {
      lines.push(`      … and ${violation.files.length - 10} more`);
    }
    lines.push(
      `      fix: add a "${PACKAGE_TEST_SCRIPT}" script running this package's runner,`,
      `           or move the suites under ${violation.dir}/${UNIT_TEST_DIR}/ to run them with node:test`,
      "",
    );
  }
  return lines.join("\n");
}

const CHECKS_WHY = [
  `Why: \`pnpm run ${ROOT_TEST_SCRIPT}\` and \`pnpm run ${ROOT_TYPECHECK_SCRIPT}\` are the two commands`,
  "this workspace is called checked on, and the workspace checks they run are each",
  "there to stop a silent pass: a suite nothing runs, a browser config nothing",
  "starts, a setting no run declares. A check dropped from one of those chains",
  "stops running without a word while both commands still report success — which",
  "is the failure each of those checks was written to catch, turned on the checks",
  "themselves. A check a package declares reaches those chains through a root",
  "script of its own, so one no root script runs is a check nobody can run and",
  `nothing reports. A check that belongs outside the full run is stated in`,
  `"${EXEMPTION_FIELD}" with the reason, so it is left out on purpose rather than`,
  "by accident.",
].join("\n");

const MANIFEST_ENTRY = (script: string): string =>
  `  root package.json → "${script}"`;

const STATEMENT_ENTRY = (script: string): string =>
  `  root package.json → "${EXEMPTION_FIELD}" → "${script}"`;

export function formatCheckCoverageProblems(
  problems: CheckCoverageProblem[],
): string {
  const lines = ["The full run no longer accounts for every check:", ""];
  for (const problem of problems) {
    switch (problem.kind) {
      case "unrun":
        lines.push(
          MANIFEST_ENTRY(problem.script),
          `      now: ${problem.command}`,
          `      problem: neither \`pnpm run ${ROOT_TEST_SCRIPT}\` nor \`pnpm run ${ROOT_TYPECHECK_SCRIPT}\` runs it`,
          `      fix: run it from one of those chains — \`pnpm run ${problem.script} &&\` in front of`,
          `           the suites in the root "${ROOT_TEST_SCRIPT}" script — or state in "${EXEMPTION_FIELD}"`,
          "           why it stays out of both.",
        );
        break;
      case "unwrapped":
        lines.push(
          `  ${problem.dir}/package.json → "${problem.script}"`,
          `      now: ${problem.command}`,
          `      problem: no root "${CHECK_SCRIPT_PREFIX}*" script runs it, so neither \`pnpm run ${ROOT_TEST_SCRIPT}\` nor`,
          `               \`pnpm run ${ROOT_TYPECHECK_SCRIPT}\` reaches it and nothing says it is missing`,
          `      fix: give it the root wrapper the other checks have —`,
          `           "${problem.script}": "pnpm --filter ${problem.name} run ${problem.script}" — and run it from`,
          `           one of those chains, or state in "${EXEMPTION_FIELD}" why it stays out.`,
        );
        break;
      case "masked":
        lines.push(
          MANIFEST_ENTRY(problem.script),
          `      in "${problem.chain}": ${problem.command}`,
          `      problem: it is reached through \`;\` or \`||\`, so \`pnpm run ${problem.chain}\` reports success even when this check failed`,
          `      fix: join every command in the root "${problem.chain}" script with \`&&\`.`,
        );
        break;
      case "runs-nothing":
        lines.push(
          MANIFEST_ENTRY(problem.script),
          `      in "${problem.chain}": ${problem.command}`,
          problem.reason === "no-package"
            ? "      problem: its filter matches no package in this workspace, so that command"
            : `      problem: no package its filter selects declares a "${problem.script}" script, so that command`,
          "               prints what it matched and exits 0 without running the check",
          `      fix: name a package that has the check — or run the root's own script,`,
          `           \`pnpm run ${problem.script}\`, which delegates to the package that holds it.`,
        );
        break;
      case "unreadable-filter":
        lines.push(
          MANIFEST_ENTRY(problem.script),
          `      in "${problem.chain}": ${problem.command}`,
          "      problem: which packages that filter selects cannot be read here, so nothing",
          "               says the check runs at all",
          `      fix: select the package by name or directory, or run \`pnpm run ${problem.script}\`.`,
        );
        break;
      case "stated-and-run":
        lines.push(
          STATEMENT_ENTRY(problem.script),
          `      problem: it is stated as outside the full run, and the root "${problem.chain}" script runs it`,
          `      fix: drop the "${EXEMPTION_FIELD}" entry, or take the check out of that chain.`,
        );
        break;
      case "stated-without-reason":
        lines.push(
          STATEMENT_ENTRY(problem.script),
          "      problem: it states no reason, so nothing says what runs this check instead",
          "      fix: give it a one-line reason, the way `check:debugger` names the workflow that runs it.",
        );
        break;
      case "stated-without-script":
        lines.push(
          STATEMENT_ENTRY(problem.script),
          `      problem: the root declares no "${problem.script}" check script, so this statement speaks for nothing`,
          "      fix: remove the entry, or restore the check it was written for.",
        );
        break;
      case "unreadable-statement":
        lines.push(
          `  root package.json → "${EXEMPTION_FIELD}"`,
          "      problem: it is not an object naming each check that stays out of the full run",
          `      fix: write it as { "check:debugger": "run as the expo-debugger workflow" }.`,
        );
        break;
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function checkWorkspace(root: string): string | null {
  const packages = collectWorkspacePackages(root);
  const rootPackage = packages.find((pkg) => toPosix(pkg.dir) === ".");
  const rootCommand = rootPackage?.scripts[ROOT_TEST_SCRIPT];

  const sections: string[] = [];
  const rootProblems = findRootScriptProblems(rootCommand);
  if (rootProblems.length > 0) {
    sections.push(formatRootProblems(rootProblems, rootCommand));
  }
  const violations = findPackageViolations(root, packages);
  if (violations.length > 0) sections.push(formatPackageViolations(violations));
  if (sections.length > 0) sections.push(WHY);

  const checkProblems = findCheckCoverageProblems(
    rootPackage?.scripts ?? {},
    readRootManifest(root)[EXEMPTION_FIELD],
    packages,
  );
  if (checkProblems.length > 0) {
    sections.push(formatCheckCoverageProblems(checkProblems), CHECKS_WHY);
  }

  if (sections.length === 0) return null;
  return sections.join("\n");
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const failure = checkWorkspace(root);
  if (failure) {
    console.error(`\nWorkspace test convention violated\n\n${failure}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    [
      `Every package's suites run from \`pnpm run ${ROOT_TEST_SCRIPT}\` (node:test, then ${RECURSIVE_TEST_COMMAND}),`,
      `and every "${CHECK_SCRIPT_PREFIX}*" script any package declares runs in \`pnpm run ${ROOT_TEST_SCRIPT}\``,
      `or \`pnpm run ${ROOT_TYPECHECK_SCRIPT}\` — through the root script that wraps it — or is stated`,
      `in "${EXEMPTION_FIELD}".`,
    ].join("\n"),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
