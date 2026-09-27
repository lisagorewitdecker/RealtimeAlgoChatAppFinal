/**
 * Every workspace check is run here the way the chain runs it: as its own
 * `check:*` command, against a workspace on disk.
 *
 * The suites beside this one call each check's `checkWorkspace()` and read the
 * report it returns. That leaves the last few lines of every one of those
 * modules untested, because an import never reaches them: the `main()` that
 * prints the report and sets `process.exitCode`, and the guard that decides
 * whether to call it at all. Those lines are the whole of what `pnpm run test`
 * depends on. A `main()` that throws before it prints, one that forgets
 * `process.exitCode`, a guard that no longer recognizes its own module, or a
 * `check:*` script naming a file that has since been renamed all leave the
 * command exiting 0 on a workspace its own functions call broken — and the
 * chain, which reads nothing but that exit status, stays green.
 *
 * So each check is spawned twice: once against a workspace that violates the
 * convention it holds, where a non-zero exit and the line naming the problem
 * are both required, and once against one that does not, where exiting 0 is.
 * The clean run is what catches a command that fails for its own reasons —
 * a crash on startup, or a script pointing at a file that is not there.
 *
 * A fixture is a real directory because that is what the command reads: each
 * check resolves the workspace it checks from its own file's location, so the
 * copy of this package that runs inside a fixture checks that fixture. Which
 * checks exist is read off this package's manifest rather than listed here, so
 * a check added later has to be given a workspace to pass on and one to fail
 * on before this suite will pass again.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ANNOUNCE_FUNCTION,
  DECLARATION_DIR,
  GLOBAL_SETUP_KEY,
  REQUIRED_KEY,
  REQUIREMENT_MODULE,
  REQUIREMENT_PACKAGE,
  SUITE_TYPE,
  TEST_MATCH_KEY,
} from "../src/checkBrowserTestRequirements.ts";
import {
  COMMAND_KEY,
  COMMAND_TYPE,
  PREFLIGHT_FUNCTION,
} from "../src/checkCommandRequirements.ts";
import { LEFT_OUT_SUITES, RELEASE_SCRIPT } from "../src/checkReleaseSuites.ts";
import { CHECK_SCRIPT_PREFIX } from "../src/checkTestScripts.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** This package's directory name, which is where a check command is run. */
const SCRIPTS_DIR = "scripts";

/** The package holding this workspace's browser suites and their commands. */
const SUITE_PACKAGE = path.posix.dirname(DECLARATION_DIR);

/** The suite kept out of the release command on purpose, as declared. */
const LEFT_OUT = LEFT_OUT_SUITES[0]!;

const manifest = (name: string, scripts: Record<string, string> = {}): string =>
  `${JSON.stringify({ name, scripts }, null, 2)}\n`;

/** A Playwright config keeping its failure output out of the repository. */
const config = (spec: string, body = ""): string =>
  `import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  ${TEST_MATCH_KEY}: /${spec.replace(/\./g, "\\.")}/,
  outputDir: join(tmpdir(), "${spec}-playwright"),
  preserveOutput: "never",
${body}});
`;

/** A Playwright config left at the defaults, as a new one starts out. */
const bareConfig = (spec: string): string =>
  `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  ${TEST_MATCH_KEY}: /${spec.replace(/\./g, "\\.")}/,
});
`;

const spec = (): string => `import { test } from "@playwright/test";

test("a case", async () => {});
`;

/** Shorthand for a file in the directory the browser suites live in. */
const e2e = (name: string): string => `${DECLARATION_DIR}/${name}`;

/**
 * The shared module both requirement checks read, declaring one browser suite
 * and one command run by hand. Each check reads only the declarations of its
 * own type, so one module serves both fixtures.
 */
const requirementModule = (): string => `export interface ${SUITE_TYPE} {
  label: string;
  config: string;
  spec: string;
  ${REQUIRED_KEY}: string[];
  covers: string[];
}

export interface ${COMMAND_TYPE} {
  label: string;
  ${COMMAND_KEY}: string;
  ${REQUIRED_KEY}: string[];
  does: string[];
}

export function ${ANNOUNCE_FUNCTION}(): void {}

export function ${PREFLIGHT_FUNCTION}(): boolean {
  return true;
}

export const BANNED_ROOM_SUITE: ${SUITE_TYPE} = {
  label: "BANNED_ROOM_SUITE",
  config: "playwright.config.ts",
  spec: "banned-room.spec.ts",
  ${REQUIRED_KEY}: [],
  covers: [],
};

export const RECOVERY_COMMAND: ${COMMAND_TYPE} = {
  label: "RECOVERY_COMMAND",
  ${COMMAND_KEY}: "moderation-recover.mjs",
  ${REQUIRED_KEY}: ["DATABASE_URL"],
  does: [],
};
`;

/** The `globalSetup` module a browser config decides its run in. */
const requirement = (): string =>
  `import { ${ANNOUNCE_FUNCTION}, BANNED_ROOM_SUITE } from "${REQUIREMENT_PACKAGE}";

export default function setup(): void {
  ${ANNOUNCE_FUNCTION}(BANNED_ROOM_SUITE);
}
`;

/** A command someone runs by hand, refused before it opens anything. */
const commandModule = (): string =>
  `import { ${PREFLIGHT_FUNCTION}, RECOVERY_COMMAND } from "${REQUIREMENT_PACKAGE}";

if (!${PREFLIGHT_FUNCTION}(RECOVERY_COMMAND)) process.exitCode = 1;
else {
  console.log(process.env.DATABASE_URL);
}
`;

/** This package's own manifest, which is what a fixture copies. */
const scriptsPackageJson = (): {
  name?: string;
  scripts?: Record<string, string>;
} => {
  const file = path.join(WORKSPACE_ROOT, SCRIPTS_DIR, "package.json");
  const parsed: { name?: string; scripts?: Record<string, string> } =
    JSON.parse(readFileSync(file, "utf8"));
  return parsed;
};

/** The scripts it declares, which is where the check commands are. */
const scriptsManifest = (): Record<string, string> =>
  scriptsPackageJson().scripts ?? {};

/** The name a filter selects it by, in this workspace and in a copy of it. */
const SCRIPTS_PACKAGE_NAME = scriptsPackageJson().name ?? SCRIPTS_DIR;

/**
 * A root manifest that wraps every check this package declares and runs each
 * one from the full run, the way this workspace's own root does. The `test`
 * script's remaining half is the caller's, because that is what the case below
 * varies.
 *
 * A fixture copies this package's manifest whole, so the checks it declares
 * are the fixture's checks too, and `check:test-scripts` holds a workspace to
 * running all of them. Reading them off that manifest rather than listing them
 * here keeps a check added later from turning the workspace this check is
 * meant to pass on into a violation of the rule it is proving.
 */
const checkRunningRoot = (test: string): string => {
  const checks = Object.keys(scriptsManifest())
    .filter((script) => script.startsWith(CHECK_SCRIPT_PREFIX))
    .sort();
  return manifest("workspace", {
    ...Object.fromEntries(
      checks.map((script) => [
        script,
        `pnpm --filter ${SCRIPTS_PACKAGE_NAME} run ${script}`,
      ]),
    ),
    test: [...checks.map((script) => `pnpm run ${script}`), test].join(" && "),
    "test:unit": "node --test",
  });
};

interface CheckCase {
  /** The `check:*` script this package declares for the check. */
  script: string;
  /** A workspace the check finds nothing to report in. */
  clean: Record<string, string>;
  /** The same workspace, with one violation of the convention it holds. */
  broken: Record<string, string>;
  /** The line of the report naming that violation. */
  problem: RegExp;
}

/** A root manifest with the shared-library build every typecheck runs. */
const LIBRARY_BUILDING_ROOT = manifest("workspace", {
  "typecheck:libs": "tsc --build",
});

/** The browser suite every browser-check fixture is built around. */
const BROWSER_SUITE: Record<string, string> = {
  [e2e("playwright.config.ts")]: config("banned-room.spec.ts"),
  [e2e("banned-room.spec.ts")]: spec(),
};

/** The manifest of the package holding those suites, and their commands. */
const suitePackage = (
  scripts: Record<string, string> = {},
): Record<string, string> => ({
  [`${SUITE_PACKAGE}/package.json`]: manifest("@workspace/api-server", {
    "test:e2e:banned-room": "playwright test --config e2e/playwright.config.ts",
    ...scripts,
  }),
});

/**
 * The suite the release command leaves out on purpose, as declared. Every
 * workspace read against that declaration keeps the script it names: without
 * it the declaration is a waiver held open, which fails for its own reason.
 */
const LEFT_OUT_SCRIPT: Record<string, string> = {
  [LEFT_OUT.script]: "node e2e/recovery.verify.mjs",
};

/** A root manifest whose release command runs the suite below. */
const RELEASING_ROOT = manifest("workspace", {
  [RELEASE_SCRIPT]:
    "pnpm --filter @workspace/api-server run test:e2e:banned-room",
});

/** That suite, with the command that starts it. */
const STARTED_SUITE: Record<string, string> = {
  ...BROWSER_SUITE,
  ...suitePackage(),
};

/** That suite, wired to what decides whether its run may go ahead. */
const DECLARED_SUITE: Record<string, string> = {
  ...BROWSER_SUITE,
  [REQUIREMENT_MODULE]: requirementModule(),
  [e2e("playwright.config.ts")]: config(
    "banned-room.spec.ts",
    `  ${GLOBAL_SETUP_KEY}: "./banned-room.requirement.ts",\n`,
  ),
  [e2e("banned-room.requirement.ts")]: requirement(),
};

/** The next suite someone adds, which is what each broken fixture is. */
const SECOND_SUITE: Record<string, string> = {
  [e2e("playwright.rooms.config.ts")]: config("rooms.spec.ts"),
  [e2e("rooms.spec.ts")]: spec(),
};

const CASES: CheckCase[] = [
  {
    script: "check:test-scripts",
    clean: {
      "package.json": checkRunningRoot(
        "pnpm run test:unit && pnpm -r --if-present run test",
      ),
    },
    broken: {
      // The half that drives each package's own runner, dropped.
      "package.json": checkRunningRoot("pnpm run test:unit"),
    },
    problem: /problem: nothing runs each package's own "test" script/,
  },
  {
    script: "check:typecheck-scripts",
    clean: { "package.json": LIBRARY_BUILDING_ROOT },
    broken: {
      "package.json": LIBRARY_BUILDING_ROOT,
      // A package typechecking itself against whatever dist holds today.
      "artifacts/app/package.json": manifest("@workspace/app", {
        typecheck: "tsc -p tsconfig.json --noEmit",
      }),
    },
    problem: /problem: no shared-library build runs first/,
  },
  {
    script: "check:browser-output",
    clean: { ...BROWSER_SUITE },
    broken: {
      ...BROWSER_SUITE,
      ...SECOND_SUITE,
      // ... taking Playwright's defaults with it.
      [e2e("playwright.rooms.config.ts")]: bareConfig("rooms.spec.ts"),
    },
    problem: /problem: it names no run-wide outputDir/,
  },
  {
    script: "check:browser-commands",
    clean: { ...STARTED_SUITE },
    broken: {
      ...STARTED_SUITE,
      // ... with no command that starts it.
      ...SECOND_SUITE,
    },
    problem: /started by no command/,
  },
  {
    script: "check:browser-requirements",
    clean: { ...DECLARED_SUITE },
    broken: {
      ...DECLARED_SUITE,
      // ... wired to nothing that decides what its cases need.
      ...SECOND_SUITE,
    },
    problem: new RegExp(`names no ${GLOBAL_SETUP_KEY}`),
  },
  {
    script: "check:command-requirements",
    clean: {
      [REQUIREMENT_MODULE]: requirementModule(),
      [e2e("moderation-recover.mjs")]: commandModule(),
    },
    broken: {
      [REQUIREMENT_MODULE]: requirementModule(),
      // The command as it was before it asked: a missing setting surfaces as
      // a throw partway through what it does.
      [e2e("moderation-recover.mjs")]:
        "console.log(process.env.DATABASE_URL);\n",
    },
    problem: new RegExp(`never calls ${PREFLIGHT_FUNCTION}\\(\\)`),
  },
  {
    script: "check:release-suites",
    clean: {
      ...BROWSER_SUITE,
      "package.json": RELEASING_ROOT,
      ...suitePackage(LEFT_OUT_SCRIPT),
    },
    broken: {
      ...BROWSER_SUITE,
      "package.json": RELEASING_ROOT,
      // ... added after the release chain was last read.
      ...suitePackage({
        "test:e2e:rooms":
          "playwright test --config e2e/playwright.rooms.config.ts",
        ...LEFT_OUT_SCRIPT,
      }),
      ...SECOND_SUITE,
    },
    problem: /run by no command made before publishing/,
  },
];

/** Files every fixture has, whatever else the check under test needs. */
const BASE_FILES: Record<string, string> = {
  "pnpm-workspace.yaml": `packages:\n  - artifacts/*\n  - lib/*\n  - ${SCRIPTS_DIR}\n`,
  "package.json": manifest("workspace"),
};

/**
 * A throwaway workspace with this package copied into it, removed when the
 * test ends.
 *
 * The copy is what makes the fixture checkable: every check resolves the
 * workspace it reads from its own file's path, so the command has to be run
 * from inside the workspace it is meant to check. The sources are copied
 * rather than linked, because Node resolves a module's real path and a linked
 * check would read the workspace it was copied from. Its dependencies are the
 * ones already installed here, which is all `tsx` needs to start.
 */
function fixture(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "check-command-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const from = path.join(WORKSPACE_ROOT, SCRIPTS_DIR);
  const to = path.join(root, SCRIPTS_DIR);
  cpSync(path.join(from, "src"), path.join(to, "src"), { recursive: true });
  cpSync(path.join(from, "package.json"), path.join(to, "package.json"));
  symlinkSync(path.join(from, "node_modules"), path.join(to, "node_modules"));

  for (const [relative, contents] of Object.entries({
    ...BASE_FILES,
    ...files,
  })) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

interface CommandResult {
  /** The exit status the chain reads, which is the whole point of the run. */
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one check the way the chain runs it, from inside a fixture. */
function runCheck(root: string, script: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "pnpm",
      ["run", script],
      { cwd: path.join(root, SCRIPTS_DIR), maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error); // the command could not be started at all
          return;
        }
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
      },
    );
  });
}

/** What a failed run said, for a test that expected it to pass. */
const said = (result: CommandResult): string =>
  `${result.stdout}${result.stderr}`.trim();

describe("every check command", { concurrency: 4 }, () => {
  for (const entry of CASES) {
    it(`\`pnpm run ${entry.script}\` fails on a workspace that violates it`, async (t) => {
      const root = fixture(t, entry.broken);
      const result = await runCheck(root, entry.script);

      assert.notEqual(
        result.code,
        0,
        `the chain reads the exit status alone, and this run said nothing was wrong:\n${said(result)}`,
      );
      assert.match(
        result.stderr,
        entry.problem,
        "the run has to say which problem it failed on, not just fail",
      );
    });

    it(`\`pnpm run ${entry.script}\` passes on one that does not`, async (t) => {
      const root = fixture(t, entry.clean);
      const result = await runCheck(root, entry.script);

      assert.equal(
        result.code,
        0,
        `a check that fails on a clean workspace is a check nobody can act on:\n${said(result)}`,
      );
      assert.notEqual(
        result.stdout.trim(),
        "",
        "a passing run says what it checked",
      );
    });
  }
});

it("every check this package declares is run by a case here", () => {
  const declared = Object.keys(scriptsManifest())
    .filter((script) => script.startsWith(CHECK_SCRIPT_PREFIX))
    .sort();

  assert.deepEqual(
    declared,
    CASES.map((entry) => entry.script).sort(),
    "a check added here needs a workspace it passes on and one it fails on",
  );
});

it("every check script names a file that is there", () => {
  const missing: string[] = [];
  for (const [script, command] of Object.entries(scriptsManifest())) {
    if (!script.startsWith(CHECK_SCRIPT_PREFIX)) continue;
    const named = command
      .split(/\s+/)
      .filter((word) => /\.[cm]?[jt]s$/.test(word));
    assert.notDeepEqual(
      named,
      [],
      `"${script}" names no module to run: ${command}`,
    );
    for (const file of named) {
      if (!existsSync(path.join(WORKSPACE_ROOT, SCRIPTS_DIR, file))) {
        missing.push(`"${script}" runs ${file}, which is not there`);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    "a renamed check file leaves the command failing for a reason of its own",
  );
});
