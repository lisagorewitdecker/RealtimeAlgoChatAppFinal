/**
 * Workspace consistency check: every browser suite meant to run before
 * publishing is reached by the one command a reader is told to run then.
 *
 * The check beside this one (checkBrowserTestCommands.ts) holds every
 * Playwright config to being named by a package script, so each suite has a
 * command that runs it. It says nothing about who runs that command. A suite
 * whose script only exists is run when somebody remembers its name, which is
 * the same "remembered, not enforced" pairing that check closed one level
 * down: `pnpm run release:validate` used to run the launch smoke and nothing
 * else, while the banned-room, moderation, moderation-timeout, and
 * auth-layout suites waited to be recalled.
 *
 * So the pairing is read rather than remembered here too. `release:validate`
 * is the command the Run & Operate list in replit.md sends a person to before
 * publishing; this check follows it through the package scripts it runs and
 * requires every browser suite's script to be one of them. A suite the
 * command does not reach fails, and so does a chain that would let a failing
 * suite go unreported: `;` and `||` report only the last command's exit
 * status, the way the root `test` script is already held.
 *
 * A suite may genuinely not belong in that run, and that is stated rather
 * than left to omission — `LEFT_OUT_SUITES` names it with the reason, and
 * every passing run prints both, because a suite left out in silence and a
 * suite forgotten look identical from outside. The declaration is held honest
 * both ways: one naming a script that is no longer a browser suite fails as a
 * waiver held open, and one the command does reach fails for saying the
 * opposite of what the command does.
 *
 * What counts as a browser suite's script is read two ways, so neither a
 * rename nor a new config slips through: this workspace's `test:e2e:*`
 * naming, and the runs checkBrowserTestCommands.ts already reads out of the
 * scripts — a script that starts a Playwright config under any other name is
 * held the same way.
 *
 * What it can follow has limits, and each one fails loudly rather than
 * quietly. Only `<runner> run <script>` is read as running another script, so
 * a reference assembled at run time, or written in pnpm's script shorthand,
 * reaches nothing and the suite behind it is reported as unreached. A run
 * that restates what a suite's script runs — the Playwright command copied
 * into the release chain instead of the script being called — does not count
 * either: the root `test` script drives each package's own script rather than
 * restating it for the same reason, so that the two cannot drift apart.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findScriptRuns,
  stripShellComments,
} from "./checkBrowserTestCommands.ts";
import {
  collectWorkspacePackages,
  ENV_ASSIGNMENT,
  FILTER_FLAGS,
  splitSegments,
  tokenize,
  type WorkspacePackage,
} from "./checkTypecheckScripts.ts";
import { findPlaywrightConfigs } from "./playwrightConfigs.ts";

/** The command a reader is told to run before publishing. */
export const RELEASE_SCRIPT = "release:validate";

/** Workspace-relative directory of the package declaring that command. */
export const ROOT_DIR = ".";

/** How this workspace names a script that runs a browser suite. */
export const SUITE_SCRIPT_PREFIX = "test:e2e:";

/** One command of the release chain, named in the report as the shape to copy. */
export const EXEMPLAR_COMMAND =
  "pnpm --filter @workspace/api-server run test:e2e:launch-smoke";

/** This module, named in the report as where a waiver is written. */
export const WAIVER_MODULE = "scripts/src/checkReleaseSuites.ts";

/** Programs that run a package script. */
const SCRIPT_RUNNERS = new Set(["pnpm", "npm", "yarn", "bun"]);

/** Shells that take the command to run as a quoted argument. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

/** How a runner is told to run a script, rather than a binary. */
const RUN_SUBCOMMAND = "run";

/** The same filter flags written as one argument. */
const FILTER_ASSIGNMENT = /^--(?:filter|workspace)=(.+)$/;

/** Flags selecting the workspace root rather than the current package. */
const ROOT_FLAGS = new Set(["-w", "--workspace-root"]);

/** Flags selecting every package. */
const RECURSIVE_FLAGS = new Set(["-r", "--recursive"]);

/** One script, as the package declaring it and its name there. */
export interface ScriptRef {
  /** Workspace-relative directory of the package declaring it. */
  dir: string;
  /** The script's name in that package.json. */
  script: string;
}

/** A script that runs a browser suite. */
export interface SuiteScript extends ScriptRef {
  /** The Playwright config it starts, where the run could be read. */
  config?: string;
}

/**
 * A suite the release command deliberately does not run.
 *
 * Every entry is printed by every passing run, because a suite left out on
 * purpose and a suite forgotten are the same absence from outside. An entry
 * the release command does reach fails, and so does one naming a script that
 * is no longer a browser suite: a waiver nobody needs is a waiver held open.
 */
export interface LeftOutSuite extends ScriptRef {
  /** Why publishing does not wait for this suite. */
  why: string;
}

export const LEFT_OUT_SUITES: readonly LeftOutSuite[] = [
  {
    dir: "artifacts/api-server",
    script: "test:e2e:moderation-recovery-live",
    // It proves the recovery contract against a live Clerk instance by
    // killing a worker between the create call and the response, so it is
    // opt-in on purpose and refuses to start without MODERATION_RECOVERY_LIVE.
    // A release run calling it would fail on an opt-in the release is not
    // meant to give it; the offline regressions it backs up
    // (`test:e2e:moderation-recovery`) do run before publishing.
    why: "it is opt-in against a live Clerk instance and refuses to start without MODERATION_RECOVERY_LIVE=1, so a release run calling it would fail on an opt-in publishing is not meant to give",
  },
];

const toPosix = (value: string): string => value.split(path.sep).join("/");

const basename = (value: string): string => value.split("/").pop() ?? value;

/** One script, as one key, so the same script is never counted twice. */
export const refKey = (ref: ScriptRef): string =>
  `${ref.dir}\u0000${ref.script}`;

const label = (ref: ScriptRef): string =>
  `${ref.dir === ROOT_DIR ? "" : `${ref.dir}/`}package.json → "${ref.script}"`;

/** The packages one `--filter` selects: by package name, or by directory. */
function filtered(
  packages: WorkspacePackage[],
  filter: string,
): WorkspacePackage[] {
  const dir = filter.replace(/^\.\//, "").replace(/\/+$/, "");
  return packages.filter(
    (pkg) =>
      pkg.name === filter || toPosix(pkg.dir) === (dir === "" ? "." : dir),
  );
}

/** The scripts one command of a script runs. */
function segmentTargets(
  packages: WorkspacePackage[],
  from: ScriptRef,
  segment: string,
): ScriptRef[] {
  const tokens = tokenize(segment).filter(
    (token) => token.quoted || !ENV_ASSIGNMENT.test(token.value),
  );
  const head = tokens[0];
  if (!head) return [];

  if (SHELLS.has(basename(head.value))) {
    const flag = tokens.findIndex((token) => token.value === "-c");
    const inner = flag === -1 ? undefined : tokens[flag + 1];
    return inner === undefined
      ? []
      : commandTargets(packages, from, inner.value);
  }
  if (!SCRIPT_RUNNERS.has(basename(head.value))) return [];

  const filters: string[] = [];
  let fromRoot = false;
  let recursive = false;
  let script: string | undefined;
  for (let index = 1; index < tokens.length; index += 1) {
    const value = tokens[index]!.value;
    if (FILTER_FLAGS.has(value)) {
      const next = tokens[index + 1];
      if (next) filters.push(next.value);
      index += 1;
      continue;
    }
    const assigned = FILTER_ASSIGNMENT.exec(value);
    if (assigned) {
      filters.push(assigned[1]!);
      continue;
    }
    if (ROOT_FLAGS.has(value)) fromRoot = true;
    else if (RECURSIVE_FLAGS.has(value)) recursive = true;
    else if (value === RUN_SUBCOMMAND) {
      script = tokens[index + 1]?.value;
      break;
    }
  }
  // Only `run <script>` is read as running a script. A name assembled at run
  // time, or pnpm's shorthand for one, is left unfollowed rather than guessed
  // at, and the suite behind it is then reported as reached by nothing.
  if (script === undefined) return [];

  const selected =
    filters.length > 0
      ? filters.flatMap((filter) => filtered(packages, filter))
      : fromRoot
        ? packages.filter((pkg) => toPosix(pkg.dir) === ROOT_DIR)
        : recursive
          ? packages
          : packages.filter((pkg) => toPosix(pkg.dir) === from.dir);

  return selected
    .filter((pkg) => script! in pkg.scripts)
    .map((pkg) => ({ dir: toPosix(pkg.dir), script: script! }));
}

/** The scripts a whole command runs, across every part of it. */
function commandTargets(
  packages: WorkspacePackage[],
  from: ScriptRef,
  command: string,
): ScriptRef[] {
  return splitSegments(stripShellComments(command)).flatMap((segment) =>
    segmentTargets(packages, from, segment.text),
  );
}

/** A script whose own parts let an earlier failure go unreported. */
export interface MaskableScript extends ScriptRef {
  command: string;
}

export interface Reach {
  /** Every script the command runs, directly or through another script. */
  reached: Map<string, ScriptRef>;
  /** Scripts in that chain joined so a failing suite is not reported. */
  maskable: MaskableScript[];
}

/**
 * Every script one command runs, followed through the scripts it calls. A
 * script is followed once: a chain that circles back has already been read.
 */
export function readReach(
  packages: WorkspacePackage[],
  start: ScriptRef,
): Reach {
  const reached = new Map<string, ScriptRef>();
  const maskable: MaskableScript[] = [];
  const seen = new Set<string>([refKey(start)]);
  const queue: ScriptRef[] = [start];

  while (queue.length > 0) {
    const ref = queue.shift()!;
    const pkg = packages.find(
      (candidate) => toPosix(candidate.dir) === ref.dir,
    );
    const command = pkg?.scripts[ref.script];
    if (command === undefined) continue; // a script that is not there runs nothing

    // `a; b` and `a || b` report only b's exit status, so a suite that failed
    // earlier in the chain would leave the release command green.
    const segments = splitSegments(stripShellComments(command));
    const chained = segments.every(
      (segment) =>
        segment.operatorBefore === "start" || segment.operatorBefore === "&&",
    );
    if (!chained) maskable.push({ ...ref, command });

    for (const target of segments.flatMap((segment) =>
      segmentTargets(packages, ref, segment.text),
    )) {
      if (seen.has(refKey(target))) continue;
      seen.add(refKey(target));
      reached.set(refKey(target), target);
      queue.push(target);
    }
  }
  return { reached, maskable };
}

/**
 * Every script in this workspace that runs a browser suite, read two ways: by
 * the `test:e2e:*` naming this workspace uses, and by the Playwright runs the
 * neighbouring check reads out of the scripts themselves, so a suite started
 * under another name is held to the same command.
 */
export function findSuiteScripts(
  root: string,
  packages: WorkspacePackage[],
): SuiteScript[] {
  const suites = new Map<string, SuiteScript>();
  for (const pkg of packages) {
    const dir = toPosix(pkg.dir);
    for (const script of Object.keys(pkg.scripts)) {
      if (!script.startsWith(SUITE_SCRIPT_PREFIX)) continue;
      suites.set(refKey({ dir, script }), { dir, script });
    }
  }

  const configs = new Set(findPlaywrightConfigs(root));
  for (const run of findScriptRuns(root, packages)) {
    const config = run.candidates.find((candidate) => configs.has(candidate));
    // A run naming a config that is not there promises a run that cannot
    // start; the neighbouring check reports that, and holding it to the
    // release command too would report the same broken script twice.
    if (config === undefined) continue;
    suites.set(refKey(run), { dir: run.dir, script: run.script, config });
  }

  return [...suites.values()].sort(
    (left, right) =>
      left.dir.localeCompare(right.dir) ||
      left.script.localeCompare(right.script),
  );
}

export interface SuiteCoverage {
  /** Suites the release command reaches. */
  covered: SuiteScript[];
  /** Suites it reaches that nothing says may be left out. */
  unreached: SuiteScript[];
  /** Waivers for a script that is no longer a browser suite here. */
  stale: LeftOutSuite[];
  /** Waivers for a suite the release command runs after all. */
  contradicted: LeftOutSuite[];
}

/** Which browser suites the release command runs, and which waivers hold. */
export function readCoverage(
  suites: SuiteScript[],
  reached: Map<string, ScriptRef>,
  leftOut: readonly LeftOutSuite[] = LEFT_OUT_SUITES,
): SuiteCoverage {
  const waived = new Set(leftOut.map(refKey));
  const known = new Set(suites.map(refKey));
  return {
    covered: suites.filter((suite) => reached.has(refKey(suite))),
    unreached: suites.filter(
      (suite) => !reached.has(refKey(suite)) && !waived.has(refKey(suite)),
    ),
    stale: leftOut.filter((suite) => !known.has(refKey(suite))),
    contradicted: leftOut.filter((suite) => reached.has(refKey(suite))),
  };
}

const WHY = [
  "Why: a browser suite runs before publishing only if the command someone is",
  `told to run then reaches it. \`pnpm run ${RELEASE_SCRIPT}\` is that command. Every`,
  "Playwright config here is already named by a package script — the check beside",
  "this one holds it to that — but a script is only a command someone could run,",
  "and a suite waiting to be remembered by name is the run nobody makes. These",
  "suites stay out of `pnpm run test` deliberately: they need a live server, a",
  "browser, and credentials. This is the command that does run them, so a suite",
  "belongs in its chain, joined with && like every other part of it, or in",
  `LEFT_OUT_SUITES in ${WAIVER_MODULE} with the reason publishing`,
  "does not wait for it — which every passing run then prints, because a suite",
  "left out on purpose and a suite forgotten are the same absence from outside.",
].join("\n");

export function formatUnreached(unreached: SuiteScript[]): string {
  const one = unreached.length === 1;
  const lines = [
    `${unreached.length} browser suite${one ? "" : "s"} in this workspace ${one ? "is" : "are"} run by no command made before publishing:`,
    "",
  ];
  for (const suite of unreached) {
    lines.push(`  ${label(suite)}`);
    if (suite.config !== undefined) lines.push(`      runs: ${suite.config}`);
    lines.push(
      `      problem: \`pnpm run ${RELEASE_SCRIPT}\` does not reach this script, so the suite runs only when someone remembers its name`,
      `      fix: add it to the "${RELEASE_SCRIPT}" chain in package.json —`,
      `           \`${EXEMPLAR_COMMAND}\` is the shape to copy —`,
      `           or declare it in LEFT_OUT_SUITES in ${WAIVER_MODULE}, with the reason publishing does not wait for it.`,
      "",
    );
  }
  return lines.join("\n");
}

export function formatMaskable(maskable: MaskableScript[]): string {
  const one = maskable.length === 1;
  const lines = [
    `${maskable.length} script${one ? "" : "s"} the release command runs through can leave a failing suite unreported:`,
    "",
  ];
  for (const script of maskable) {
    lines.push(
      `  ${label(script)}`,
      `      now: ${script.command}`,
      "      problem: its parts are joined with `;` or `||`, so only the last one's exit status is reported",
      "      fix: join every part with `&&`, so the first suite that fails fails the command.",
      "",
    );
  }
  return lines.join("\n");
}

export function formatStale(stale: LeftOutSuite[]): string {
  const one = stale.length === 1;
  const lines = [
    `${one ? "1 suite" : `${stale.length} suites`} declared left out of the release command ${one ? "is" : "are"} not a browser suite here:`,
    "",
  ];
  for (const suite of stale) {
    lines.push(
      `  ${label(suite)}`,
      `      now: left out because ${suite.why}`,
      `      problem: no script of that name runs a browser suite in this workspace, so the waiver holds nothing open but itself`,
      `      fix: drop the entry from LEFT_OUT_SUITES in ${WAIVER_MODULE}, or name the script the suite is run by now.`,
      "",
    );
  }
  return lines.join("\n");
}

export function formatContradicted(contradicted: LeftOutSuite[]): string {
  const one = contradicted.length === 1;
  const lines = [
    `${one ? "1 suite" : `${contradicted.length} suites`} declared left out of the release command ${one ? "is" : "are"} run by it:`,
    "",
  ];
  for (const suite of contradicted) {
    lines.push(
      `  ${label(suite)}`,
      `      now: left out because ${suite.why}`,
      `      problem: \`pnpm run ${RELEASE_SCRIPT}\` reaches this script, so the reason given for leaving it out describes a run that happens`,
      `      fix: take it out of the "${RELEASE_SCRIPT}" chain, or drop its entry from LEFT_OUT_SUITES in ${WAIVER_MODULE}.`,
      "",
    );
  }
  return lines.join("\n");
}

export function checkWorkspace(root: string): string | null {
  const packages = collectWorkspacePackages(root);
  const rootPackage = packages.find((pkg) => toPosix(pkg.dir) === ROOT_DIR);
  if (!rootPackage || !(RELEASE_SCRIPT in rootPackage.scripts)) {
    return [
      `The root package.json no longer declares a "${RELEASE_SCRIPT}" script.`,
      "",
      "That is the command this workspace's browser suites are run from before",
      "publishing, and the only one that runs more than one of them. Restore it",
      `(\`${EXEMPLAR_COMMAND} && ...\`), or rename it here and in replit.md's Run &`,
      "Operate list, so the command a reader is sent to is the command checked.",
      "",
      WHY,
    ].join("\n");
  }

  const suites = findSuiteScripts(root, packages);
  if (suites.length === 0) {
    return [
      "No browser suite was found in this workspace.",
      "",
      "That is reported as a failure on purpose: a check with nothing to check",
      "passes exactly the way a compliant workspace does. Either the suites are",
      `run by scripts named some other way than \`${SUITE_SCRIPT_PREFIX}*\`, in which case`,
      `widen the search in ${WAIVER_MODULE}, or they are gone and`,
      "this check should go with them.",
      "",
      WHY,
    ].join("\n");
  }

  const { reached, maskable } = readReach(packages, {
    dir: ROOT_DIR,
    script: RELEASE_SCRIPT,
  });
  const { unreached, stale, contradicted } = readCoverage(suites, reached);

  const sections: string[] = [];
  if (unreached.length > 0) sections.push(formatUnreached(unreached));
  if (maskable.length > 0) sections.push(formatMaskable(maskable));
  if (stale.length > 0) sections.push(formatStale(stale));
  if (contradicted.length > 0) sections.push(formatContradicted(contradicted));
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
      `\nRelease browser-suite convention violated\n\n${failure}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const packages = collectWorkspacePackages(root);
  const { reached } = readReach(packages, {
    dir: ROOT_DIR,
    script: RELEASE_SCRIPT,
  });
  const { covered } = readCoverage(findSuiteScripts(root, packages), reached);
  console.log(
    `All ${covered.length} browser suite${covered.length === 1 ? "" : "s"} in this workspace run from \`pnpm run ${RELEASE_SCRIPT}\`: ${covered
      .map((suite) => suite.script)
      .join(", ")}.`,
  );
  // Said out loud on every run: a suite left out on purpose and a suite
  // forgotten are the same absence from outside.
  for (const suite of LEFT_OUT_SUITES) {
    console.log(
      `Left out of it: ${suite.dir} → "${suite.script}" — ${suite.why}.`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
