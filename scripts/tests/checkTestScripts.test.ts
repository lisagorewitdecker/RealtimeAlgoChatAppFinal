import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  type CheckCoverageProblem,
  checkWorkspace,
  findCheckCoverageProblems,
  findRootScriptProblems,
  findTestFiles,
  PACKAGE_TEST_SCRIPT,
  RECURSIVE_TEST_COMMAND,
  UNIT_TEST_SCRIPT,
} from "../src/checkTestScripts.ts";
import type { WorkspacePackage } from "../src/checkTypecheckScripts.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const VALID_ROOT_TEST = `pnpm run ${UNIT_TEST_SCRIPT} && ${RECURSIVE_TEST_COMMAND}`;

interface PackageSpec {
  /** Its manifest name, where a filter has to name it; its directory else. */
  name?: string;
  scripts?: Record<string, string>;
  files?: string[];
}

interface WorkspaceSpec {
  /** Scripts of the workspace root package; a valid `test` script by default. */
  rootScripts?: Record<string, string>;
  /** What the root manifest states about checks outside the full run. */
  rootStatement?: unknown;
  packages: Record<string, PackageSpec>;
}

function write(root: string, relative: string, contents: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, spec: WorkspaceSpec): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "test-script-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  write(root, "pnpm-workspace.yaml", "packages:\n  - artifacts/*\n  - lib/*\n");
  write(
    root,
    "package.json",
    JSON.stringify({
      name: "workspace",
      scripts: spec.rootScripts ?? { test: VALID_ROOT_TEST },
      ...("rootStatement" in spec
        ? { checksOutsideFullRun: spec.rootStatement }
        : {}),
    }),
  );
  for (const [dir, pkg] of Object.entries(spec.packages)) {
    write(
      root,
      path.join(dir, "package.json"),
      JSON.stringify({ name: pkg.name ?? dir, scripts: pkg.scripts ?? {} }),
    );
    for (const file of pkg.files ?? []) write(root, path.join(dir, file), "");
  }
  return root;
}

test("a package with suites and no way to run them fails the check", (t) => {
  const root = workspace(t, {
    packages: {
      "artifacts/app": { files: ["__tests__/Home.test.tsx"] },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a package nothing can run should fail the check");
  assert.match(failure, /artifacts\/app\/__tests__\/Home\.test\.tsx/);
  assert.match(failure, new RegExp(`"${PACKAGE_TEST_SCRIPT}" script`));
});

test("a package's own test script is how the root reaches its suites", (t) => {
  const root = workspace(t, {
    packages: {
      "artifacts/api": {
        scripts: { test: "vitest run src" },
        files: ["src/lib/rooms.test.ts", "src/app.test.ts"],
      },
      "artifacts/app": {
        scripts: { test: "jest" },
        files: ["__tests__/Home.test.tsx", "server/serve.test.js"],
      },
    },
  });

  assert.equal(checkWorkspace(root), null);
});

test("suites in a package's tests directory need no test script", (t) => {
  const root = workspace(t, {
    packages: {
      "lib/db": { files: ["tests/queries.test.ts"] },
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "the root node:test discovery already runs them",
  );
});

test("a package reports only the suites its own tests directory misses", (t) => {
  const root = workspace(t, {
    packages: {
      "artifacts/api": {
        files: ["tests/profileIdentity.test.ts", "src/app.test.ts"],
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the colocated suite has no runner");
  assert.match(failure, /artifacts\/api\/src\/app\.test\.ts/);
  assert.doesNotMatch(failure, /profileIdentity/);
});

test("dependencies and build output hold no suites of their own", (t) => {
  const root = workspace(t, {
    packages: {
      "artifacts/app": {
        files: [
          "node_modules/some-dep/index.test.js",
          "dist/bundle.test.js",
          "static-build/app.test.js",
          "coverage/report.test.js",
        ],
      },
    },
  });

  assert.equal(checkWorkspace(root), null);
});

test("finds a suite whichever runner's naming it uses", (t) => {
  const root = workspace(t, {
    packages: {
      "artifacts/api": {
        scripts: { test: "vitest run src" },
        files: [
          "e2e/launch-smoke.spec.ts",
          "e2e/recovery.test.mjs",
          "src/app.test.ts",
          "src/ui/Panel.test.tsx",
          "src/helpers.ts",
        ],
      },
    },
  });

  assert.deepEqual(findTestFiles(root, "artifacts/api"), [
    "artifacts/api/e2e/launch-smoke.spec.ts",
    "artifacts/api/e2e/recovery.test.mjs",
    "artifacts/api/src/app.test.ts",
    "artifacts/api/src/ui/Panel.test.tsx",
  ]);
});

test("the root command has to run both halves, joined with &&", () => {
  assert.deepEqual(findRootScriptProblems(VALID_ROOT_TEST), []);
  assert.deepEqual(findRootScriptProblems(undefined), ["missing"]);
  assert.deepEqual(findRootScriptProblems(`pnpm run ${UNIT_TEST_SCRIPT}`), [
    "no-package-runners",
  ]);
  assert.deepEqual(findRootScriptProblems(RECURSIVE_TEST_COMMAND), [
    "no-unit-suites",
  ]);
  assert.deepEqual(
    findRootScriptProblems(
      `pnpm run ${UNIT_TEST_SCRIPT}; ${RECURSIVE_TEST_COMMAND}`,
    ),
    ["maskable"],
    "`;` reports only the last exit status, hiding an earlier failure",
  );
  assert.deepEqual(
    findRootScriptProblems(
      `pnpm run ${UNIT_TEST_SCRIPT} || ${RECURSIVE_TEST_COMMAND}`,
    ),
    ["maskable"],
  );
});

test("a filtered run is not a run of every package", () => {
  assert.deepEqual(
    findRootScriptProblems(
      `pnpm run ${UNIT_TEST_SCRIPT} && pnpm -r --filter ./artifacts/** --if-present run ${PACKAGE_TEST_SCRIPT}`,
    ),
    ["no-package-runners"],
    "a filter leaves the packages outside it unrun",
  );
});

test("a check step in front of the runners is allowed", (t) => {
  const root = workspace(t, {
    rootScripts: {
      test: `pnpm run check:test-scripts && pnpm run ${UNIT_TEST_SCRIPT} && ${RECURSIVE_TEST_COMMAND}`,
    },
    packages: { "artifacts/app": { scripts: { test: "jest" } } },
  });

  assert.equal(checkWorkspace(root), null);
});

/**
 * A root manifest's scripts in the shape this workspace's has: checks in front
 * of the suites in `test`, one more in `typecheck`, each of them delegating to
 * the package that holds it.
 */
function fullRunScripts(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "check:test-scripts":
      "pnpm --filter @workspace/scripts run check:test-scripts",
    "check:browser-output":
      "pnpm --filter @workspace/scripts run check:browser-output",
    "check:typecheck-scripts":
      "pnpm --filter @workspace/scripts run check:typecheck-scripts",
    test: `pnpm run check:test-scripts && pnpm run check:browser-output && ${VALID_ROOT_TEST}`,
    "test:unit": "pnpm --filter @workspace/scripts run test:unit",
    typecheck:
      "pnpm run check:typecheck-scripts && pnpm run typecheck:libs && pnpm -r --if-present run typecheck",
    "typecheck:libs": "tsc --build",
    ...overrides,
  };
}

/**
 * The packages those scripts delegate to, each declaring the checks the root
 * hands it — the arrangement a filtered command is resolved against.
 */
const CHECK_PACKAGES: WorkspacePackage[] = [
  { dir: ".", name: "workspace", scripts: {} },
  {
    dir: "scripts",
    name: "@workspace/scripts",
    scripts: {
      "check:browser-output": "tsx ./src/checkBrowserOutput.ts",
      "check:test-scripts": "tsx ./src/checkTestScripts.ts",
      "check:typecheck-scripts": "tsx ./src/checkTypecheckScripts.ts",
      "test:unit": "tsx ./src/runUnitTests.ts",
    },
  },
  {
    dir: "artifacts/chat-app",
    name: "@workspace/chat-app",
    scripts: { test: "jest" },
  },
  {
    dir: "artifacts/api-server",
    name: "@workspace/api-server",
    scripts: { test: "vitest run src" },
  },
];

/** Those packages, with one more check declared by the package that holds it. */
const packagesDeclaring = (
  dir: string,
  scripts: Record<string, string>,
): WorkspacePackage[] =>
  CHECK_PACKAGES.map((pkg) =>
    pkg.dir === dir ? { ...pkg, scripts: { ...pkg.scripts, ...scripts } } : pkg,
  );

/**
 * The package those root wrappers delegate to, as a workspace on disk has it:
 * a wrapper naming a package that is not there runs nothing, which is a
 * problem of its own rather than part of what these fixtures are about.
 */
const CHECK_HOLDER: Record<string, PackageSpec> = {
  "lib/scripts": {
    name: "@workspace/scripts",
    scripts: {
      "check:browser-output": "tsx ./src/checkBrowserOutput.ts",
      "check:test-scripts": "tsx ./src/checkTestScripts.ts",
      "check:typecheck-scripts": "tsx ./src/checkTypecheckScripts.ts",
      "test:unit": "tsx ./src/runUnitTests.ts",
    },
  },
};

/** The problems the full-run chains of one manifest leave, nothing stated. */
const coverageProblems = (
  overrides: Record<string, string> = {},
  stated?: unknown,
  packages: WorkspacePackage[] = CHECK_PACKAGES,
): CheckCoverageProblem[] =>
  findCheckCoverageProblems(fullRunScripts(overrides), stated, packages);

test("the full run accounts for every check the root declares", () => {
  assert.deepEqual(coverageProblems(), []);
});

test("a check dropped from the chain is run by nothing", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && ${VALID_ROOT_TEST}`,
    }),
    [
      {
        kind: "unrun",
        script: "check:browser-output",
        command: "pnpm --filter @workspace/scripts run check:browser-output",
      },
    ],
    "dropping it from the chain is what this check exists to notice",
  );
});

test("a check the typecheck chain runs is run", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && ${VALID_ROOT_TEST}`,
      typecheck:
        "pnpm run check:typecheck-scripts && pnpm run check:browser-output && pnpm run typecheck:libs",
    }),
    [],
    "either command running it is enough; it is one full run in two halves",
  );
});

test("a check a chain reaches through another script it runs is run", () => {
  assert.deepEqual(
    coverageProblems({
      "check:workspace":
        "pnpm run check:test-scripts && pnpm run check:browser-output",
      test: `pnpm run check:workspace && ${VALID_ROOT_TEST}`,
    }),
    [],
  );
});

test("a check whose failure would be reported over is not run", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts; pnpm run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    [
      {
        kind: "masked",
        script: "check:test-scripts",
        chain: "test",
        command: "pnpm run check:test-scripts",
      },
    ],
    "`;` reports the next command's exit status over this one's failure",
  );

  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts || true && ${VALID_ROOT_TEST}`,
      typecheck:
        "pnpm run check:typecheck-scripts && pnpm run check:browser-output && pnpm run typecheck:libs",
    }),
    [
      {
        kind: "masked",
        script: "check:test-scripts",
        chain: "test",
        command: "pnpm run check:test-scripts",
      },
    ],
    "`|| true` swallows the failure the check was run for",
  );
});

test("a check nothing has been wired to yet is reported", () => {
  assert.deepEqual(
    coverageProblems({
      "check:room-keys": "pnpm --filter @workspace/api-server run check:rooms",
    }),
    [
      {
        kind: "unrun",
        script: "check:room-keys",
        command: "pnpm --filter @workspace/api-server run check:rooms",
      },
    ],
    "the checks are read off the manifest, so a new one is held to this too",
  );
});

test("naming a check is not running it", () => {
  assert.deepEqual(
    coverageProblems({
      test: `echo pnpm run check:browser-output && pnpm run check:test-scripts && ${VALID_ROOT_TEST}`,
    }),
    [
      {
        kind: "unrun",
        script: "check:browser-output",
        command: "pnpm --filter @workspace/scripts run check:browser-output",
      },
    ],
    "a chain that only mentions a check runs nothing",
  );
});

test("a filter that selects no package runs no check", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && pnpm --filter @workspace/scrpits run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    [
      {
        kind: "runs-nothing",
        script: "check:browser-output",
        chain: "test",
        command:
          "pnpm --filter @workspace/scrpits run check:browser-output",
        reason: "no-package",
      },
    ],
    "pnpm says it matched nothing and exits 0, so the chain stays green",
  );
});

test("a filter that selects a package without the check runs no check", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && pnpm --filter @workspace/api-server run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    [
      {
        kind: "runs-nothing",
        script: "check:browser-output",
        chain: "test",
        command:
          "pnpm --filter @workspace/api-server run check:browser-output",
        reason: "no-script",
      },
    ],
    "the package it names holds no such script, so that command runs nothing",
  );
});

test("a chain may run a check from the package that holds it", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && pnpm --filter scripts run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    [],
    "pnpm matches a package by its name without the scope as well",
  );

  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && pnpm --filter ./scripts run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    [],
    "and by the directory it sits in",
  );

  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && pnpm --filter=@workspace/scripts run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    [],
    "however the filter is written out",
  );
});

test("a selector this check cannot resolve proves nothing", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm run check:test-scripts && pnpm --filter "[origin/main]" run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    [
      {
        kind: "unreadable-filter",
        script: "check:browser-output",
        chain: "test",
        command: 'pnpm --filter "[origin/main]" run check:browser-output',
      },
    ],
    "what changed since a commit is not a property of the workspace",
  );
});

test("a check reached both by a real run and an empty filter is run", () => {
  assert.deepEqual(
    coverageProblems({
      test: `pnpm --filter @workspace/scrpits run check:browser-output && pnpm run check:browser-output && pnpm run check:test-scripts && ${VALID_ROOT_TEST}`,
    }),
    [],
    "the reading that proves the most wins, here the root's own script",
  );
});

test("a check can be stated as belonging outside the full run", () => {
  const scripts = {
    "check:debugger": "pnpm --filter @workspace/chat-app run check:debugger",
  };
  assert.deepEqual(
    coverageProblems(scripts, {
      "check:debugger": "run as the expo-debugger workflow",
    }),
    [],
  );
  assert.deepEqual(
    coverageProblems(scripts, { "check:debugger": "  " }),
    [{ kind: "stated-without-reason", script: "check:debugger" }],
    "a bare name says only that someone wanted it to stop failing",
  );
  assert.deepEqual(
    coverageProblems(scripts),
    [
      {
        kind: "unrun",
        script: "check:debugger",
        command: "pnpm --filter @workspace/chat-app run check:debugger",
      },
    ],
    "left out with nothing said, it is indistinguishable from a dropped check",
  );
});

test("a statement that speaks for nothing is reported", () => {
  assert.deepEqual(
    coverageProblems({}, { "check:debugger": "run as the expo-debugger workflow" }),
    [{ kind: "stated-without-script", script: "check:debugger" }],
    "the check it was written for is gone, so the entry only hides the next one",
  );
  assert.deepEqual(
    coverageProblems({}, {
      "check:test-scripts": "run as the expo-debugger workflow",
    }),
    [{ kind: "stated-and-run", script: "check:test-scripts", chain: "test" }],
    "stated as outside the full run while the chain runs it",
  );
  assert.deepEqual(
    coverageProblems({}, ["check:debugger"]),
    [{ kind: "unreadable-statement" }],
    "a list of names states no reason for any of them",
  );
});

/** A check of its own, declared by the package that holds it. */
const ROOMS_CHECK = { "check:rooms": "tsx ./src/checkRooms.ts" };

test("a package's check is run through the root script that wraps it", () => {
  assert.deepEqual(
    coverageProblems(
      {
        "check:rooms": "pnpm --filter @workspace/api-server run check:rooms",
        test: `pnpm run check:test-scripts && pnpm run check:browser-output && pnpm run check:rooms && ${VALID_ROOT_TEST}`,
      },
      undefined,
      packagesDeclaring("artifacts/api-server", ROOMS_CHECK),
    ),
    [],
    "the wrapper is in the chain, so the check the package holds runs",
  );
});

test("a package's check no root script wraps is run by nothing", () => {
  assert.deepEqual(
    coverageProblems(
      {},
      undefined,
      packagesDeclaring("artifacts/api-server", ROOMS_CHECK),
    ),
    [
      {
        kind: "unwrapped",
        script: "check:rooms",
        dir: "artifacts/api-server",
        name: "@workspace/api-server",
        command: "tsx ./src/checkRooms.ts",
      },
    ],
    "a check nothing wraps is missing from the root manifest the rule above reads",
  );
});

test("a wrapper nothing runs is reported once, against the root", () => {
  assert.deepEqual(
    coverageProblems(
      { "check:rooms": "pnpm --filter @workspace/api-server run check:rooms" },
      undefined,
      packagesDeclaring("artifacts/api-server", ROOMS_CHECK),
    ),
    [
      {
        kind: "unrun",
        script: "check:rooms",
        command: "pnpm --filter @workspace/api-server run check:rooms",
      },
    ],
    "the wrapper is what has to reach a chain, so it is what the report names",
  );
});

test("a wrapper naming a check its package does not declare wraps nothing", () => {
  assert.deepEqual(
    coverageProblems(
      {
        "check:rooms": "pnpm --filter @workspace/api-server run check:rooms",
        test: `pnpm run check:test-scripts && pnpm run check:browser-output && pnpm run check:rooms && ${VALID_ROOT_TEST}`,
      },
      undefined,
      packagesDeclaring("scripts", ROOMS_CHECK),
    ),
    [
      {
        kind: "runs-nothing",
        script: "check:rooms",
        chain: "check:rooms",
        command: "pnpm --filter @workspace/api-server run check:rooms",
        reason: "no-script",
      },
      {
        kind: "unwrapped",
        script: "check:rooms",
        dir: "scripts",
        name: "@workspace/scripts",
        command: "tsx ./src/checkRooms.ts",
      },
    ],
    "the wrapper runs nothing, and the package that holds the check is reached by nothing",
  );
});

test("a wrapper that reports its own check's failure over is not running it", () => {
  assert.deepEqual(
    coverageProblems(
      {
        "check:rooms":
          "pnpm --filter @workspace/api-server run check:rooms; echo checked",
        test: `pnpm run check:test-scripts && pnpm run check:browser-output && pnpm run check:rooms && ${VALID_ROOT_TEST}`,
      },
      undefined,
      packagesDeclaring("artifacts/api-server", ROOMS_CHECK),
    ),
    [
      {
        kind: "masked",
        script: "check:rooms",
        chain: "check:rooms",
        command: "pnpm --filter @workspace/api-server run check:rooms",
      },
    ],
    "the chain runs the wrapper and the wrapper exits 0, check or no check",
  );
});

test("a package's check a chain reports over is not run either", () => {
  assert.deepEqual(
    coverageProblems(
      {
        test: `pnpm --filter @workspace/api-server run check:rooms; ${VALID_ROOT_TEST}`,
        typecheck:
          "pnpm run check:typecheck-scripts && pnpm run check:test-scripts && pnpm run check:browser-output && pnpm run typecheck:libs",
      },
      undefined,
      packagesDeclaring("artifacts/api-server", ROOMS_CHECK),
    ),
    [
      {
        kind: "masked",
        script: "check:rooms",
        chain: "test",
        command: "pnpm --filter @workspace/api-server run check:rooms",
      },
    ],
    "no root script of that name stands between the chain and the check, so the package's own declaration is where it is read",
  );
});

test("a chain may run a package's check without a wrapper of its own", () => {
  assert.deepEqual(
    coverageProblems(
      {
        test: `pnpm run check:test-scripts && pnpm run check:browser-output && pnpm --filter @workspace/api-server run check:rooms && ${VALID_ROOT_TEST}`,
      },
      undefined,
      packagesDeclaring("artifacts/api-server", ROOMS_CHECK),
    ),
    [],
    "the chain reaches it where it lives; a wrapper is the usual way, not the only one",
  );
});

test("a package's check can be stated as belonging outside the full run", () => {
  const packages = packagesDeclaring("artifacts/chat-app", {
    "check:debugger": "node scripts/check-debugger.cjs",
  });
  assert.deepEqual(
    coverageProblems(
      {},
      { "check:debugger": "run as the expo-debugger workflow" },
      packages,
    ),
    [],
    "the statement speaks for the package's check, wrapper or no wrapper",
  );
  assert.deepEqual(
    coverageProblems({}, undefined, packages),
    [
      {
        kind: "unwrapped",
        script: "check:debugger",
        dir: "artifacts/chat-app",
        name: "@workspace/chat-app",
        command: "node scripts/check-debugger.cjs",
      },
    ],
    "left out with nothing said, it is indistinguishable from a check nobody wired up",
  );
});

test("a workspace whose full run dropped a check fails the check", (t) => {
  const root = workspace(t, {
    rootScripts: fullRunScripts({ test: VALID_ROOT_TEST }),
    packages: { ...CHECK_HOLDER, "artifacts/app": { scripts: { test: "jest" } } },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a check nothing runs should fail the check");
  assert.match(
    failure,
    /problem: neither `pnpm run test` nor `pnpm run typecheck` runs it/,
  );
  assert.match(failure, /"check:browser-output"/);
});

test("a workspace whose chain runs a check in no package fails the check", (t) => {
  const root = workspace(t, {
    rootScripts: fullRunScripts({
      test: `pnpm run check:test-scripts && pnpm --filter @workspace/scrpits run check:browser-output && ${VALID_ROOT_TEST}`,
    }),
    packages: { ...CHECK_HOLDER, "artifacts/app": { scripts: { test: "jest" } } },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a command that runs no check should fail the check");
  assert.match(failure, /its filter matches no package in this workspace/);
  assert.match(failure, /"check:browser-output"/);
});

test("a workspace whose package declares an unwrapped check fails the check", (t) => {
  const root = workspace(t, {
    rootScripts: fullRunScripts(),
    packages: {
      ...CHECK_HOLDER,
      "artifacts/app": {
        scripts: { test: "jest", "check:rooms": "node scripts/checkRooms.cjs" },
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a check no root script wraps should fail the check");
  assert.match(failure, /artifacts\/app\/package\.json → "check:rooms"/);
  assert.match(failure, /now: node scripts\/checkRooms\.cjs/);
  assert.match(
    failure,
    /"check:rooms": "pnpm --filter artifacts\/app run check:rooms"/,
    "the fix is the root wrapper every other check reaches its chain through",
  );
});

test("a workspace states the check it keeps out of the full run", (t) => {
  const root = workspace(t, {
    rootScripts: fullRunScripts({
      "check:debugger": "pnpm --filter @workspace/chat-app run check:debugger",
    }),
    rootStatement: {
      "check:debugger": "run as the expo-debugger workflow",
    },
    packages: { ...CHECK_HOLDER, "artifacts/app": { scripts: { test: "jest" } } },
  });

  assert.equal(checkWorkspace(root), null);
});

test("this workspace runs every package's suites from the root command", () => {
  assert.equal(
    checkWorkspace(WORKSPACE_ROOT),
    null,
    "every suite in this workspace should be reachable from `pnpm run test`",
  );
});
