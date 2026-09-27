/**
 * Workspace consistency check: every Playwright config in this workspace is
 * started by a command someone can run.
 *
 * The two checks beside this one hold a browser config to announcing the
 * settings its specs need (checkBrowserTestRequirements.ts) and to keeping its
 * failure output out of the repository (checkBrowserOutput.ts). Neither asks
 * whether anything runs it. A suite that runs nowhere passes both of them
 * exactly the way a suite run before every release does — the same quiet pass
 * those checks exist to stop, one level up.
 *
 * `pnpm run test` deliberately leaves these suites out: they need a live
 * server, a browser, and credentials. What stands in for "the root command
 * runs it" is therefore that a manifest names it — each config discovered here
 * is named by a package script, which is the command that runs it
 * (`pnpm --filter <package> run <script>`). Reading that pairing off a
 * package.json instead of remembering it is the whole point: the configs in
 * `artifacts/api-server/e2e` each have a `test:e2e:*` script today, and
 * nothing said the next config added in another artifact had to get one.
 *
 * A script does not have to name the config itself. The moderation-timeout
 * suite is started by its own verifier, which sets up what that run records
 * and then hands the Playwright CLI a `--config`, so a module a script runs is
 * read too — but only the argument list the CLI's own path sits in, and only
 * with the module's comments stripped. A flag and a path lying elsewhere in a
 * module are a mention rather than a run: an argument list nothing passes any
 * more, a sentence about a suite, a commented-out call. Counting those would
 * have this check call a suite run on the strength of someone writing its
 * name down.
 *
 * A config name is read the way the command reads it, from the working
 * directory the script gives it: the package's own directory, for a module it
 * runs as much as for the CLI, since the module inherits it. A name that
 * lands nowhere from there is a name Playwright would not find either.
 *
 * Two things therefore fail here:
 *   - a config no package script starts, directly or through a module it runs;
 *   - a script, or such a module, naming a config that is not there, which
 *     promises a run that cannot happen.
 *
 * What it can follow has limits, and each one fails loudly rather than
 * quietly: a command assembled at run time, a module that hands Playwright a
 * command as one string rather than as arguments, and a config reached only
 * through a second module all read as unstarted. The report then names the
 * config and the fix is to name it somewhere that can be read.
 *
 * Reading what a package script runs is not only this check's business, so
 * that reading is stated here once and exported: `scriptCommands` for the
 * commands a script runs, `findModuleRuns` for the modules those commands
 * hand a runner, and `startsBrowserRun` for whether such a module starts a
 * suite itself. `scripts/src/checkCommandRequirements.ts` reads the same
 * scripts to find the commands someone runs by hand, and two checks reading
 * one manifest differently is how they come to disagree about what a script
 * does.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The sibling check already reads argument lists out of a module, and reading
// them differently here is how two checks come to disagree about what a
// command says.
import { stringLiterals } from "./checkBrowserTestRequirements.ts";
import { IGNORED_DIRECTORIES } from "./checkTestScripts.ts";
import {
  collectWorkspacePackages,
  commandTokens,
  splitSegments,
  tokenize,
  type WorkspacePackage,
} from "./checkTypecheckScripts.ts";
import {
  findPlaywrightConfigs,
  MODULE_EXTENSIONS,
  stripComments,
} from "./playwrightConfigs.ts";

/** A script that starts a run, named in the report as the shape to copy. */
export const EXEMPLAR_SCRIPT = "test:e2e:launch-smoke";

/** The package whose package.json declares it. */
export const EXEMPLAR_PACKAGE = "artifacts/api-server";

/** The program a browser run starts with. */
export const PLAYWRIGHT_PROGRAM = "playwright";

/** Its one subcommand that runs a suite: `install` and the rest start none. */
export const RUN_SUBCOMMAND = "test";

/** How a run is told which config to use. */
const CONFIG_FLAGS = new Set(["--config", "-c"]);

/** The same flag written as one argument. */
const CONFIG_ASSIGNMENT = /^--config=(.+)$/;

/** What a run naming no config reads: the working directory's own. */
const DEFAULT_CONFIG_NAME = "playwright.config";

/** Programs that run a module of this workspace, which may start a run. */
export const MODULE_RUNNERS = new Set(["node", "tsx", "ts-node"]);

/**
 * The flag that has one of those runners collect the files it is given
 * instead of running the first of them: `node --test <files>` starts Node's
 * own test runner over them, so the module is a suite that runner collects
 * rather than an entry point someone starts.
 */
export const TEST_RUNNER_FLAG = "--test";

/** Shells that take the command to run as a quoted argument. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

/** The CLI a module has to start for its arguments to describe a run. */
const PLAYWRIGHT_CLI = /@playwright\/test/;

const toPosix = (value: string): string => value.split(path.sep).join("/");

const basename = (value: string): string => value.split("/").pop() ?? value;

/** Whether a name could be a config file at all, rather than another flag. */
const namesModuleFile = (value: string): boolean =>
  MODULE_EXTENSIONS.some((extension) => value.endsWith(extension));

/**
 * A command with its `#` comments removed, so a command someone commented out
 * starts nothing. A `#` opens a comment only where a word starts: mid-word it
 * is part of the word, and inside quotes it is text.
 */
export function stripShellComments(command: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      out += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(command[index - 1]!))) {
      while (index < command.length && command[index] !== "\n") index += 1;
      out += "\n";
      continue;
    }
    out += char;
  }
  return out;
}

/** One run a command starts, as the config name it gives Playwright. */
interface Mention {
  /** The name the command gives the config; absent for Playwright's default. */
  specifier?: string;
  /** Workspace-relative paths that name can mean, in resolution order. */
  candidates: string[];
  /** The module the script reaches the run through, where it reaches one. */
  module?: string;
}

/** One such run, with the script that starts it. */
export interface ScriptRun extends Mention {
  /** Workspace-relative directory of the package declaring that script. */
  dir: string;
  /** The script's name in that package.json. */
  script: string;
}

/** Where the commands of one script run from. */
interface RunContext {
  /** Absolute workspace root. */
  root: string;
  /** The package directory a script's commands run from. */
  dir: string;
}

/** Where a name lands, as a workspace-relative path. */
function workspacePath(root: string, from: string, specifier: string): string {
  return toPosix(path.relative(root, path.resolve(root, from, specifier)));
}

/** The workspace file a runner's argument names, or null where there is none. */
function resolveFile(
  root: string,
  from: string,
  specifier: string,
): string | null {
  const relative = workspacePath(root, from, specifier);
  if (relative.split("/").some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return null; // build output and dependencies hold no authored command
  }
  try {
    return statSync(path.join(root, relative)).isFile() ? relative : null;
  } catch {
    return null;
  }
}

/**
 * Where a config name a command gives Playwright lands. It is resolved
 * against the working directory that command has, which is the directory of
 * the package whose script starts it — for a module that script runs too,
 * since the module inherits that working directory and starts the CLI in it.
 * Resolving against the module's own directory instead would call a config
 * sitting beside the module started, when the CLI would not find it there.
 */
function configPath(context: RunContext, specifier: string): string {
  return workspacePath(context.root, context.dir, specifier);
}

/** The configs Playwright reads where a run names none of its own. */
function defaultConfigs(dir: string): string[] {
  return MODULE_EXTENSIONS.map((extension) =>
    toPosix(path.join(dir, DEFAULT_CONFIG_NAME + extension)),
  );
}

/** Whether arguments run a suite, rather than install a browser or show help. */
const runsSuite = (args: string[]): boolean =>
  args.find((arg) => !arg.startsWith("-")) === RUN_SUBCOMMAND;

/** The config a run names, as written, or null where it names none. */
export function configArgument(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const assigned = CONFIG_ASSIGNMENT.exec(args[index]!);
    if (assigned) return assigned[1]!;
    const next = args[index + 1];
    if (CONFIG_FLAGS.has(args[index]!) && next !== undefined) return next;
  }
  return null;
}

/**
 * The `[...]` a position sits inside, or null where it sits in none. Brackets
 * inside a string are skipped, so a path or a message never opens a list.
 */
export function enclosingList(code: string, at: number): string | null {
  const open: number[] = [];
  let list: number | null = null;
  let quote: string | null = null;
  for (let index = 0; index < code.length; index += 1) {
    if (list === null && index >= at) {
      if (open.length === 0) return null; // the position is in no list at all
      list = open[open.length - 1]!;
    }
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
    if (char === "[") {
      open.push(index);
      continue;
    }
    if (char === "]") {
      const started = open.pop();
      if (list !== null && started === list) return code.slice(list + 1, index);
    }
  }
  return null;
}

/**
 * The argument lists a module hands the Playwright CLI: the bracketed list
 * the CLI's own path sits in. Bounding the search to that list is what makes
 * this a run rather than a mention — a module can hold the flag and a config
 * path in a list it passes nowhere, in a message about another suite, or in a
 * comment, and none of those starts anything. Counting a mention would have
 * this check report a suite as run on the strength of a sentence about it.
 */
export function cliArgumentLists(code: string): string[] {
  const lists: string[] = [];
  const marker = new RegExp(PLAYWRIGHT_CLI.source, "g");
  for (let found = marker.exec(code); found; found = marker.exec(code)) {
    const list = enclosingList(code, found.index);
    if (list !== null) lists.push(list);
  }
  return lists;
}

/**
 * Whether a module starts a browser suite itself, rather than only being run
 * by someone: it hands the Playwright CLI a run, the way the
 * moderation-timeout verifier sets up what that run records and then starts
 * it. Read from the module's source, with its comments stripped, and bounded
 * to the argument list the CLI's own path sits in for the reason above — a
 * mention is not a run.
 */
export function startsBrowserRun(source: string): boolean {
  return cliArgumentLists(stripComments(source)).some((list) =>
    stringLiterals(list).includes(RUN_SUBCOMMAND),
  );
}

/** The configs one such argument list names, as written. */
export function listConfigs(list: string): string[] {
  const literals = stringLiterals(list);
  if (!literals.includes(RUN_SUBCOMMAND)) return []; // it runs no suite
  const configs: string[] = [];
  for (let index = 0; index < literals.length; index += 1) {
    const literal = literals[index]!;
    const assigned = CONFIG_ASSIGNMENT.exec(literal);
    const specifier = assigned
      ? assigned[1]!
      : CONFIG_FLAGS.has(literal)
        ? literals[index + 1]
        : undefined;
    if (specifier !== undefined && namesModuleFile(specifier)) {
      configs.push(specifier);
    }
  }
  return configs;
}

/**
 * The module a runner's arguments name, as a workspace-relative path: its
 * first argument that is not a flag, resolved from the working directory the
 * script gives it. A later one is that module's own argument rather than
 * another module, so only the first is read.
 */
function runnerModule(context: RunContext, args: string[]): string | null {
  const target = args.find((arg) => !arg.startsWith("-"));
  if (target === undefined) return null;
  return resolveFile(context.root, context.dir, target);
}

/** The runs a module a script executes starts. */
function moduleRuns(context: RunContext, args: string[]): Mention[] {
  const module = runnerModule(context, args);
  if (module === null) return [];

  let source;
  try {
    source = readFileSync(path.join(context.root, module), "utf8");
  } catch {
    return []; // a module that cannot be read starts nothing this can see
  }
  const code = stripComments(source);
  return cliArgumentLists(code).flatMap((list) =>
    listConfigs(list).map((specifier) => ({
      specifier,
      candidates: [configPath(context, specifier)],
      module,
    })),
  );
}

/** One command a script runs: a program, and the arguments it is given. */
export interface ScriptCommand {
  /** The program, by the name it is called, without any path to it. */
  name: string;
  /** Its arguments, unquoted, with the runner wrappers already stripped. */
  args: string[];
}

/**
 * The commands one package script runs. Text someone commented out is
 * dropped, the settings and package-runner wrappers in front of a command
 * are stripped, and a shell handed its command as a quoted argument is
 * unwrapped to the command inside it, so what comes back is what really
 * starts.
 */
export function scriptCommands(command: string): ScriptCommand[] {
  const commands: ScriptCommand[] = [];
  for (const segment of splitSegments(stripShellComments(command))) {
    const tokens = commandTokens(tokenize(segment.text));
    const program = tokens[0];
    if (!program) continue;
    const name = basename(program.value);
    const args = tokens.slice(1).map((token) => token.value);
    if (SHELLS.has(name)) {
      const flag = args.indexOf("-c");
      const inner = flag === -1 ? undefined : args[flag + 1];
      if (inner !== undefined) commands.push(...scriptCommands(inner));
      continue;
    }
    commands.push({ name, args });
  }
  return commands;
}

/** The runs one script starts, across every command in it. */
function commandRuns(context: RunContext, command: string): Mention[] {
  return scriptCommands(command).flatMap<Mention>(({ name, args }) => {
    if (name === PLAYWRIGHT_PROGRAM) {
      if (!runsSuite(args)) return [];
      const specifier = configArgument(args);
      return specifier === null
        ? [{ candidates: defaultConfigs(context.dir) }]
        : [{ specifier, candidates: [configPath(context, specifier)] }];
    }
    if (MODULE_RUNNERS.has(name)) return moduleRuns(context, args);
    return [];
  });
}

/** Every browser run the workspace's package scripts start. */
export function findScriptRuns(
  root: string,
  packages: WorkspacePackage[],
): ScriptRun[] {
  const runs: ScriptRun[] = [];
  for (const pkg of packages) {
    const dir = toPosix(pkg.dir);
    for (const [script, command] of Object.entries(pkg.scripts)) {
      for (const mention of commandRuns({ root, dir }, command)) {
        runs.push({ ...mention, dir, script });
      }
    }
  }
  return runs;
}

/** One module of this workspace a package script hands a runner. */
export interface ModuleRun {
  /** Workspace-relative directory of the package declaring that script. */
  dir: string;
  /** The script's name in that package.json. */
  script: string;
  /** Workspace-relative path of the module, resolved from that directory. */
  module: string;
  /**
   * Whether the runner was told to collect it rather than run it, which is
   * what `${TEST_RUNNER_FLAG}` does: the module is then one file of a test
   * run rather than the command someone started.
   */
  collectedAsTest: boolean;
}

/**
 * Every module of this workspace its package scripts run directly. A script
 * naming a file that is not there, or one under build output or
 * dependencies, names no module of this workspace and is left out; what a
 * module does once it starts is for its reader to decide.
 */
export function findModuleRuns(
  root: string,
  packages: WorkspacePackage[],
): ModuleRun[] {
  const runs: ModuleRun[] = [];
  for (const pkg of packages) {
    const dir = toPosix(pkg.dir);
    for (const [script, command] of Object.entries(pkg.scripts)) {
      for (const { name, args } of scriptCommands(command)) {
        if (!MODULE_RUNNERS.has(name)) continue;
        const module = runnerModule({ root, dir }, args);
        if (module === null) continue;
        runs.push({
          dir,
          script,
          module,
          collectedAsTest: args.includes(TEST_RUNNER_FLAG),
        });
      }
    }
  }
  return runs;
}

export interface CommandCoverage {
  /** Discovered configs no script starts, workspace-relative. */
  unrun: string[];
  /** Runs naming a config that is not one of the discovered ones. */
  dangling: ScriptRun[];
}

/** Which configs the workspace's scripts start, and which names miss. */
export function readCoverage(
  configs: string[],
  runs: ScriptRun[],
): CommandCoverage {
  const discovered = new Set(configs);
  const started = new Set<string>();
  const dangling: ScriptRun[] = [];
  for (const run of runs) {
    const config = run.candidates.find((candidate) =>
      discovered.has(candidate),
    );
    if (config !== undefined) {
      started.add(config);
      continue;
    }
    // A run naming nothing takes Playwright's default, and a package with no
    // config of its own is not thereby broken; a run naming a config is.
    if (run.specifier !== undefined) dangling.push(run);
  }
  return {
    unrun: configs.filter((config) => !started.has(config)),
    dangling,
  };
}

const WHY = [
  "Why: a browser suite is only a check if some command starts it. A config can",
  "announce the settings its specs need and keep its failure output out of the",
  "repository and still be run by nothing at all — the two checks beside this one",
  "pass on a suite nobody can start, which is the quiet pass they exist to stop,",
  "one level up. `pnpm run test` leaves these suites out deliberately: they need a",
  "live server, a browser, and credentials. So what stands in for the root command",
  "running them is that a manifest names them — every Playwright config here is",
  `named by a package script, and \`pnpm --filter <package> run <script>\` is then`,
  "the command that runs it. A script reaching Playwright through a module it runs",
  "counts too: the moderation-timeout suite is started by its own verifier, which",
  "sets up what that run records before handing the CLI its config.",
].join("\n");

export function formatUnrun(unrun: string[]): string {
  const one = unrun.length === 1;
  const lines = [
    `${unrun.length} Playwright config${one ? "" : "s"} in this workspace ${one ? "is" : "are"} started by no command:`,
    "",
  ];
  for (const config of unrun) {
    lines.push(`  ${config}`);
    lines.push(
      `      problem: no package script runs \`${PLAYWRIGHT_PROGRAM} ${RUN_SUBCOMMAND}\` on it, and none runs a module that does`,
      `      fix: give it a script in the package.json of the package holding it —`,
      `           "${EXEMPLAR_SCRIPT}" in ${EXEMPLAR_PACKAGE}/package.json is the shape to copy —`,
      `           or delete the config with the suite it used to configure.`,
      "",
    );
  }
  return lines.join("\n");
}

export function formatDangling(dangling: ScriptRun[]): string {
  const one = dangling.length === 1;
  const lines = [
    `${dangling.length} command${one ? "" : "s"} in this workspace name${one ? "s" : ""} a Playwright config that is not there:`,
    "",
  ];
  for (const run of dangling) {
    lines.push(`  ${run.dir}/package.json → "${run.script}"`);
    if (run.module !== undefined) {
      lines.push(`      through: ${run.module}`);
    }
    lines.push(
      `      now: --config ${run.specifier}`,
      `      looked for: ${run.candidates.join(", ")}`,
      `      problem: no Playwright config of this workspace is there, so the run this command promises cannot start`,
      `      fix: name a config that is there, or drop the command with the suite it used to run.`,
      "",
    );
  }
  return lines.join("\n");
}

export function checkWorkspace(root: string): string | null {
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

  const runs = findScriptRuns(root, collectWorkspacePackages(root));
  const { unrun, dangling } = readCoverage(configs, runs);

  const sections: string[] = [];
  if (unrun.length > 0) sections.push(formatUnrun(unrun));
  if (dangling.length > 0) sections.push(formatDangling(dangling));
  if (sections.length === 0) return null;
  return [...sections, WHY].join("\n");
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const failure = checkWorkspace(root);
  if (failure) {
    console.error(
      `\nBrowser suite command convention violated\n\n${failure}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const configs = findPlaywrightConfigs(root);
  console.log(
    `All ${configs.length} Playwright config${configs.length === 1 ? "" : "s"} in this workspace ${configs.length === 1 ? "is" : "are"} started by a package script.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
