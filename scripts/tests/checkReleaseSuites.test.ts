import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  checkWorkspace,
  LEFT_OUT_SUITES,
  RELEASE_SCRIPT,
  ROOT_DIR,
} from "../src/checkReleaseSuites.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** The package this workspace's browser suites live in. */
const API = "artifacts/api-server";

/** The suite left out of the release command on purpose, as declared. */
const LEFT_OUT = LEFT_OUT_SUITES[0]!;

/**
 * That suite's script, kept in the workspaces below because the declaration
 * is read against the workspace it is checked in: a workspace without the
 * script it names is the waiver-held-open case, which one test here is about.
 */
const leftOutScript: Record<string, string> = {
  [LEFT_OUT.script]: "node e2e/recovery.verify.mjs",
};

interface PackageSpec {
  /** The package's name, which is what a `--filter` selects it by. */
  name?: string;
  scripts?: Record<string, string>;
  /** Files of that package, by path relative to its directory. */
  files?: Record<string, string>;
}

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, packages: Record<string, PackageSpec>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-suite-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (relative: string, contents: string): void => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  write("pnpm-workspace.yaml", "packages:\n  - artifacts/*\n  - lib/*\n");
  for (const [dir, pkg] of Object.entries(packages)) {
    write(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: pkg.name ?? (dir === ROOT_DIR ? "workspace" : dir),
        scripts: pkg.scripts ?? {},
      }),
    );
    for (const [file, contents] of Object.entries(pkg.files ?? {})) {
      write(path.join(dir, file), contents);
    }
  }
  if (!(ROOT_DIR in packages)) {
    write("package.json", JSON.stringify({ name: "workspace", scripts: {} }));
  }
  return root;
}

/** How the release command runs one suite of one package. */
const runs = (dir: string, script: string): string =>
  `pnpm --filter ${dir} run ${script}`;

/** The release chain, which is how every suite in it is held to failing it. */
const release = (...commands: string[]): Record<string, string> => ({
  [RELEASE_SCRIPT]: commands.join(" && "),
});

/** A Playwright config, recognized here the way the real ones are. */
const config = (
  suite: string,
): string => `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /${suite}\\.spec\\.ts/,
});
`;

/** The entries a report lists, which are the ones indented by two spaces. */
const reported = (failure: string): string[] =>
  failure
    .split("\n")
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => line.trim());

test("a suite the release command runs is a suite run before publishing", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: {
      scripts: release(
        runs(API, "test:e2e:launch-smoke"),
        runs(API, "test:e2e:banned-room"),
      ),
    },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
        "test:e2e:banned-room": "playwright test --config e2e/rooms.config.ts",
      },
      files: {
        "e2e/smoke.config.ts": config("smoke"),
        "e2e/rooms.config.ts": config("banned-room"),
      },
    },
  });

  assert.equal(checkWorkspace(root), null);
});

test("a suite no documented command reaches fails", (t) => {
  const root = workspace(t, {
    // The chain as it stood: the smoke suite, and the rest by memory.
    [ROOT_DIR]: { scripts: release(runs(API, "test:e2e:launch-smoke")) },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
        "test:e2e:banned-room": "playwright test --config e2e/rooms.config.ts",
      },
      files: {
        "e2e/smoke.config.ts": config("smoke"),
        "e2e/rooms.config.ts": config("banned-room"),
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a suite waiting to be remembered is a run nobody makes");
  assert.match(failure, /run by no command made before publishing/);
  assert.match(failure, /runs: artifacts\/api-server\/e2e\/rooms\.config\.ts/);
  assert.deepEqual(reported(failure), [
    `${API}/package.json → "test:e2e:banned-room"`,
  ]);
});

test("a browser suite in another artifact needs a place in the chain too", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: { scripts: release(runs(API, "test:e2e:launch-smoke")) },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
      },
      files: { "e2e/smoke.config.ts": config("smoke") },
    },
    "artifacts/chat-app": {
      scripts: {
        "test:e2e:profile": "playwright test --config e2e/profile.config.ts",
      },
      files: { "e2e/profile.config.ts": config("profile") },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the command-pairing check passes on it either way");
  assert.deepEqual(reported(failure), [
    `artifacts/chat-app/package.json → "test:e2e:profile"`,
  ]);
});

test("a script the command calls can be what runs the suites", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: {
      scripts: release("pnpm --filter @workspace/api-server run test:e2e:all"),
    },
    [API]: {
      name: "@workspace/api-server",
      scripts: {
        ...leftOutScript,
        "test:e2e:all":
          "pnpm run test:e2e:launch-smoke && pnpm run test:e2e:banned-room",
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
        "test:e2e:banned-room": "playwright test --config e2e/rooms.config.ts",
      },
      files: {
        "e2e/smoke.config.ts": config("smoke"),
        "e2e/rooms.config.ts": config("banned-room"),
      },
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "a named aggregate the release command calls reaches what it calls",
  );
});

test("restating what a suite's script runs is not running that script", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: {
      // The suite's own command, copied into the chain instead of called. The
      // two can then drift apart with nothing to notice.
      scripts: release(
        `pnpm --filter ${API} exec playwright test --config e2e/smoke.config.ts`,
      ),
    },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
      },
      files: { "e2e/smoke.config.ts": config("smoke") },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the script is what the chain has to run");
  assert.deepEqual(reported(failure), [
    `${API}/package.json → "test:e2e:launch-smoke"`,
  ]);
});

test("a suite started under another name is held to the command too", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: { scripts: release(runs(API, "test:e2e:launch-smoke")) },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
        // A browser suite outside the `test:e2e:*` naming, which the prefix
        // alone would never see.
        "verify:rooms": "playwright test --config e2e/rooms.config.ts",
      },
      files: {
        "e2e/smoke.config.ts": config("smoke"),
        "e2e/rooms.config.ts": config("banned-room"),
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "what it runs is what makes it a browser suite");
  assert.deepEqual(reported(failure), [`${API}/package.json → "verify:rooms"`]);
});

test("a chain that can leave a failing suite unreported fails", (t) => {
  const masked = workspace(t, {
    [ROOT_DIR]: {
      scripts: {
        // Both suites run, but only the last one's exit status is the
        // command's, so the first can fail into a green release.
        [RELEASE_SCRIPT]: `${runs(API, "test:e2e:launch-smoke")}; ${runs(API, "test:e2e:banned-room")}`,
      },
    },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
        "test:e2e:banned-room": "playwright test --config e2e/rooms.config.ts",
      },
      files: {
        "e2e/smoke.config.ts": config("smoke"),
        "e2e/rooms.config.ts": config("banned-room"),
      },
    },
  });

  const failure = checkWorkspace(masked);
  assert.ok(failure, "a suite that cannot fail the command is not a gate");
  assert.match(failure, /only the last one's exit status is reported/);
  assert.deepEqual(reported(failure), [`package.json → "${RELEASE_SCRIPT}"`]);

  const swallowed = workspace(t, {
    [ROOT_DIR]: { scripts: release(runs(API, "test:e2e:all")) },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:all":
          "pnpm run test:e2e:launch-smoke || echo 'the browser is not installed'",
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
      },
      files: { "e2e/smoke.config.ts": config("smoke") },
    },
  });

  const inTheAggregate = checkWorkspace(swallowed);
  assert.ok(inTheAggregate, "a script in the chain can mask it just as well");
  assert.deepEqual(reported(inTheAggregate), [
    `${API}/package.json → "test:e2e:all"`,
  ]);
});

test("a suite left out on purpose says so where a reader can see it", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: {
      scripts: release(runs(LEFT_OUT.dir, "test:e2e:launch-smoke")),
    },
    [LEFT_OUT.dir]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
      },
      files: { "e2e/smoke.config.ts": config("smoke") },
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "the declaration is what makes it left out rather than forgotten",
  );
  assert.ok(
    LEFT_OUT.why.length > 0,
    "and the reason is what a reader is given for it",
  );
});

test("a suite declared left out that is no longer one fails", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: {
      scripts: release(runs(LEFT_OUT.dir, "test:e2e:launch-smoke")),
    },
    [LEFT_OUT.dir]: {
      // The waived suite, retired without its declaration going with it.
      scripts: {
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
      },
      files: { "e2e/smoke.config.ts": config("smoke") },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a waiver nobody needs is a waiver held open");
  assert.match(failure, /not a browser suite here/);
  assert.deepEqual(reported(failure), [
    `${LEFT_OUT.dir}/package.json → "${LEFT_OUT.script}"`,
  ]);
});

test("a suite declared left out that the command runs fails", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: {
      scripts: release(
        runs(LEFT_OUT.dir, "test:e2e:launch-smoke"),
        runs(LEFT_OUT.dir, LEFT_OUT.script),
      ),
    },
    [LEFT_OUT.dir]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
      },
      files: { "e2e/smoke.config.ts": config("smoke") },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the reason given describes a run that happens");
  assert.match(
    failure,
    /declared left out of the release command is run by it/,
  );
  assert.deepEqual(reported(failure), [
    `${LEFT_OUT.dir}/package.json → "${LEFT_OUT.script}"`,
  ]);
});

test("losing the documented command is a failure of its own", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: { scripts: { test: "pnpm -r --if-present run test" } },
    [API]: {
      scripts: {
        ...leftOutScript,
        "test:e2e:launch-smoke": "playwright test --config e2e/smoke.config.ts",
      },
      files: { "e2e/smoke.config.ts": config("smoke") },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a renamed command leaves the reader's one out of date");
  assert.match(failure, new RegExp(`no longer declares a "${RELEASE_SCRIPT}"`));
});

test("finding no browser suite at all is a failure", (t) => {
  const root = workspace(t, {
    [ROOT_DIR]: { scripts: release("echo nothing to validate") },
    [API]: { scripts: { test: "vitest run src" } },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a check with nothing to check passes like a clean one");
  assert.match(failure, /No browser suite was found/);
});

test("this workspace runs every browser suite before publishing", () => {
  assert.equal(
    checkWorkspace(WORKSPACE_ROOT),
    null,
    "each browser suite here should run from one documented command",
  );
});
