/**
 * Names every setting the release command's browser suites need that this
 * environment does not provide, before the first of them starts.
 *
 * Each suite decides that for itself in its Playwright `globalSetup`, and
 * goes on doing so — that is what keeps a suite from skipping itself into a
 * green run. What one suite cannot decide is the run as a whole.
 * `pnpm run release:validate` chains every browser suite in this workspace,
 * so a missing moderator password used to stop the command only when the
 * suite signing in with it was reached: after the offline recovery
 * regressions, the launch smoke, the auth layout, the home-bar clearance and
 * the banned-room scenario had all run. Many minutes to be told about a
 * setting that was already missing before the first browser started, and told
 * about that one alone — the next run then stops on the next missing setting.
 *
 * So the same reading is made once, here, before the chain's first command.
 * Which suites the chain runs is read the way `checkReleaseSuites.ts` reads
 * it: the release script is followed through the scripts it calls, and each
 * one that starts a Playwright config is a suite. What that suite needs is
 * read off its own `BrowserSuite` declaration in
 * `@workspace/browser-test-requirements` — the declaration its `globalSetup`
 * decides against — and the union of those is decided by that module's own
 * `decideReleaseSettings`. Nothing here restates a setting name: a second
 * list of them is a list that falls behind the first, and then clears a run
 * the suites will refuse.
 *
 * Running one suite on its own is untouched. This stands in front of the
 * chain, not in front of a suite, so `pnpm --filter @workspace/api-server run
 * test:e2e:auth-layout` still reports the one setting that suite needs.
 *
 * Two things fail here besides a missing setting, because either would let
 * this clear a run it had not read:
 *   - the release command reaching no browser suite at all, which reads as a
 *     clean environment and is a check with nothing to check;
 *   - a config the command runs that no `BrowserSuite` declares, whose
 *     settings are therefore in no union this could compute.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as requirements from "@workspace/browser-test-requirements";
import { declaredPath } from "./checkBrowserTestRequirements.ts";
import {
  findSuiteScripts,
  RELEASE_SCRIPT,
  readReach,
  ROOT_DIR,
  type ScriptRef,
} from "./checkReleaseSuites.ts";
import {
  collectWorkspacePackages,
  type WorkspacePackage,
} from "./checkTypecheckScripts.ts";

type BrowserSuite = requirements.BrowserSuite;

type Environment = Readonly<Record<string, string | undefined>>;

/** The command this stands in front of, as a reader runs it. */
export const RELEASE_COMMAND = `pnpm run ${RELEASE_SCRIPT}`;

/**
 * The root script that makes this reading. It is the release chain's first
 * command and nothing else runs it: a suite's own script must go on deciding
 * for itself, or running one suite alone would be held to the settings every
 * other suite in the chain needs.
 */
export const RELEASE_SETTINGS_SCRIPT = "release:settings";

/** Where the suites are declared, named in a report that cannot find one. */
export const REQUIREMENT_MODULE = "lib/browser-test-requirements/src/index.ts";

/** This module, named in the report as where the reading is made. */
export const PREFLIGHT_MODULE = "scripts/src/releaseSettings.ts";

/** One suite of the release chain, as the script running it and what it declares. */
export interface ChainedSuite {
  /** The script the release command runs, in the package declaring it. */
  readonly script: ScriptRef;
  /** The Playwright config that script starts. */
  readonly config: string;
  /** What the suite that config runs declares, or null when nothing does. */
  readonly suite: BrowserSuite | null;
}

/**
 * Whether an export of the requirement module is a suite declaration.
 *
 * Read off the value rather than from a list of suite names, so a suite
 * declared tomorrow is one of these today. A `CommandRequirement` states a
 * `command` and no `config`, so it is not one of them, and neither is
 * anything else that module exports.
 *
 * Failing to recognize a suite is not quiet: every config the release
 * command runs has to be claimed by one of these, so a declaration this
 * passes over is reported as a config nothing declares.
 */
export function isBrowserSuite(value: unknown): value is BrowserSuite {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BrowserSuite>;
  return (
    typeof candidate.label === "string" &&
    typeof candidate.config === "string" &&
    typeof candidate.spec === "string" &&
    Array.isArray(candidate.required) &&
    Array.isArray(candidate.covers)
  );
}

/** Every suite the requirement module declares. */
export function declaredSuites(
  module: Readonly<Record<string, unknown>> = requirements,
): BrowserSuite[] {
  return Object.values(module).filter(isBrowserSuite);
}

/**
 * The browser suites the release command runs, in the order it runs them,
 * each paired with what it declares.
 *
 * A script the command runs that starts no Playwright config is not one of
 * these: `test:e2e:moderation-recovery` is `node --test` over offline
 * regressions, which reach no browser, no server and no account, and declare
 * nothing for this to read.
 */
export function readChain(
  root: string,
  packages: WorkspacePackage[],
  suites: readonly BrowserSuite[],
): ChainedSuite[] {
  const { reached } = readReach(packages, {
    dir: ROOT_DIR,
    script: RELEASE_SCRIPT,
  });
  const byConfig = new Map(
    suites.map((suite) => [declaredPath(suite.config), suite]),
  );
  const found = findSuiteScripts(root, packages);

  const chained: ChainedSuite[] = [];
  for (const ref of reached.values()) {
    const config = found.find(
      (suite) => suite.dir === ref.dir && suite.script === ref.script,
    )?.config;
    if (config === undefined) continue;
    chained.push({
      script: { dir: ref.dir, script: ref.script },
      config,
      suite: byConfig.get(config) ?? null,
    });
  }
  return chained;
}

const WHY = [
  `Why: \`${RELEASE_COMMAND}\` runs every browser suite in this workspace, one`,
  "after another, and each suite decides for itself whether the settings it signs",
  "in with are there. That decision is right and stays; what it cannot do is make",
  "itself early. A setting only the last suite needs used to stop the command",
  "after every suite before it had run, and to name that one setting only, so the",
  "next run stops on the next one. This reads the same declarations the suites",
  "decide against — the `BrowserSuite` entries in",
  `${REQUIREMENT_MODULE} — and makes that reading once,`,
  "for all of them, before the first browser starts.",
].join("\n");

function label(ref: ScriptRef): string {
  return `${ref.dir === ROOT_DIR ? "" : `${ref.dir}/`}package.json → "${ref.script}"`;
}

export function formatUndeclared(undeclared: ChainedSuite[]): string {
  const one = undeclared.length === 1;
  const lines = [
    `${one ? "1 suite" : `${undeclared.length} suites`} the release command runs ${one ? "is" : "are"} declared by no BrowserSuite:`,
    "",
  ];
  for (const entry of undeclared) {
    lines.push(
      `  ${label(entry.script)}`,
      `      runs: ${entry.config}`,
      `      problem: no BrowserSuite in ${REQUIREMENT_MODULE} names this config, so what it needs is in no union this can read, and a run cleared here would still stop inside it`,
      `      fix: declare it there, the way every other suite in the chain is declared, and name that declaration's module as the config's globalSetup — \`pnpm run check:browser-requirements\` holds both sides of that.`,
      "",
    );
  }
  return lines.join("\n");
}

export function formatNoSuites(): string {
  return [
    "The release command reaches no browser suite in this workspace.",
    "",
    "That is reported as a failure on purpose: with nothing to read, this clears",
    "the run exactly the way it clears a fully configured one, and then hands it",
    "on to suites whose settings nothing looked at. Either the command no longer",
    "runs browser suites, in which case nothing needs deciding here and this",
    `should go with them, or it does and they are no longer found — in which case`,
    `\`pnpm run check:release-suites\` is reporting that too.`,
    "",
  ].join("\n");
}

export interface ReleaseSettingsReport {
  /** Why the release command must not start, or null when it may. */
  readonly failure: string | null;
  /** What a starting run says about the settings it has, printed as it starts. */
  readonly notice: string;
}

/**
 * Reads the workspace and the environment and decides whether the release
 * command may start. The suites are a parameter so this rule is covered
 * against workspaces written for the purpose, rather than only against the
 * one it runs in.
 */
export function readReleaseSettings(
  root: string,
  env: Environment,
  suites: readonly BrowserSuite[] = declaredSuites(),
): ReleaseSettingsReport {
  const packages = collectWorkspacePackages(root);
  const chained = readChain(root, packages, suites);

  if (chained.length === 0) {
    return { failure: [formatNoSuites(), WHY].join("\n"), notice: "" };
  }

  const undeclared = chained.filter((entry) => entry.suite === null);
  if (undeclared.length > 0) {
    return {
      failure: [formatUndeclared(undeclared), WHY].join("\n"),
      notice: "",
    };
  }

  const decision = requirements.decideReleaseSettings(env, {
    command: RELEASE_COMMAND,
    suites: chained.map((entry) => entry.suite!),
  });
  const message = decision.detail
    ? `${decision.headline}\n\n${decision.detail}`
    : decision.headline;

  return decision.kind === "fail"
    ? { failure: [message, "", WHY].join("\n"), notice: "" }
    : { failure: null, notice: message };
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const { failure, notice } = readReleaseSettings(root, process.env);

  if (failure) {
    console.error(`\nThe release run was not started\n\n${failure}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${notice}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
