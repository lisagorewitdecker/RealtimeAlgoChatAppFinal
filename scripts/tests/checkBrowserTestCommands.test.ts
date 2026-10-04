import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  checkWorkspace,
  PLAYWRIGHT_PROGRAM,
  RUN_SUBCOMMAND,
} from "../src/checkBrowserTestCommands.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** The package this workspace's browser suites live in. */
const API = "artifacts/api-server";

interface PackageSpec {
  scripts?: Record<string, string>;
  /** Files of that package, by path relative to its directory. */
  files?: Record<string, string>;
}

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, packages: Record<string, PackageSpec>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "browser-command-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (relative: string, contents: string): void => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  write("pnpm-workspace.yaml", "packages:\n  - artifacts/*\n  - lib/*\n");
  write("package.json", JSON.stringify({ name: "workspace", scripts: {} }));
  for (const [dir, pkg] of Object.entries(packages)) {
    write(
      path.join(dir, "package.json"),
      JSON.stringify({ name: dir, scripts: pkg.scripts ?? {} }),
    );
    for (const [file, contents] of Object.entries(pkg.files ?? {})) {
      write(path.join(dir, file), contents);
    }
  }
  return root;
}

/** A Playwright config, recognized here the way the real ones are. */
const config = (
  suite: string,
): string => `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /${suite}\\.spec\\.ts/,
});
`;

/** The script shape this workspace's browser suites are run by. */
const runScript = (name: string): string =>
  `${PLAYWRIGHT_PROGRAM} install chromium && ${PLAYWRIGHT_PROGRAM} ${RUN_SUBCOMMAND} --config e2e/${name}`;

/**
 * A verifier that sets a run up and then starts the CLI itself, which is how
 * the moderation-timeout suite runs: its script names the verifier, not the
 * config.
 */
const verifier = (
  specifier: string,
): string => `import { spawn } from "node:child_process";
import { join } from "node:path";

spawn(process.execPath, [
  join(process.cwd(), "node_modules/@playwright/test/cli.js"),
  "test",
  "--config",
  "${specifier}",
]);
`;

/** The entries a report lists, which are the ones indented by two spaces. */
const reported = (failure: string): string[] =>
  failure
    .split("\n")
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => line.trim());

test("a config a package script names is a suite someone can run", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: { "test:e2e:banned-room": runScript("playwright.config.ts") },
      files: { "e2e/playwright.config.ts": config("banned-room") },
    },
  });

  assert.equal(checkWorkspace(root), null);
});

test("a config no script names fails", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: { "test:e2e:banned-room": runScript("playwright.config.ts") },
      files: {
        "e2e/playwright.config.ts": config("banned-room"),
        // The next suite someone adds, with no way to start it.
        "e2e/playwright.rooms.config.ts": config("rooms"),
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a suite no command starts is a check nobody runs");
  assert.match(failure, /started by no command/);
  assert.deepEqual(reported(failure), [
    `${API}/e2e/playwright.rooms.config.ts`,
  ]);
});

test("a browser suite in another artifact needs a command of its own", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: { "test:e2e:banned-room": runScript("playwright.config.ts") },
      files: { "e2e/playwright.config.ts": config("banned-room") },
    },
    "artifacts/chat-app": {
      scripts: { test: "jest" },
      files: { "e2e/playwright.profile.config.ts": config("profile") },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the two other browser checks pass on it either way");
  assert.deepEqual(reported(failure), [
    "artifacts/chat-app/e2e/playwright.profile.config.ts",
  ]);
});

test("a module the script runs can be what starts the suite", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:moderation-timeout":
          "CLERK_TELEMETRY_DISABLED=1 node e2e/moderation-timeout.verify.mjs",
      },
      files: {
        "e2e/playwright.moderation-timeout.config.ts":
          config("moderation-timeout"),
        "e2e/moderation-timeout.verify.mjs": verifier(
          "e2e/playwright.moderation-timeout.config.ts",
        ),
      },
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "the verifier hands the CLI the config its own script never names",
  );
});

test("an argument list the module hands nobody is not a run", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:moderation-timeout": "node e2e/moderation-timeout.verify.mjs",
      },
      files: {
        "e2e/playwright.moderation-timeout.config.ts":
          config("moderation-timeout"),
        "e2e/playwright.rooms.config.ts": config("rooms"),
        "e2e/moderation-timeout.verify.mjs": `import { spawn } from "node:child_process";
import { join } from "node:path";

// The arguments the rooms run used to be started with, now passed nowhere.
const retired = ["test", "--config", "e2e/playwright.rooms.config.ts"];

spawn(process.execPath, [
  join(process.cwd(), "node_modules/@playwright/test/cli.js"),
  "test",
  "--config",
  "e2e/playwright.moderation-timeout.config.ts",
]);
`,
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a config named in a list nothing passes is not started");
  assert.deepEqual(reported(failure), [
    `${API}/e2e/playwright.rooms.config.ts`,
  ]);
});

test("a config beside the module is not the one the command finds", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:moderation-timeout": "node e2e/moderation-timeout.verify.mjs",
      },
      files: {
        // The verifier's own directory, which is not where it runs from: the
        // script runs in the package, so the CLI resolves the name there.
        "e2e/playwright.moderation-timeout.config.ts":
          config("moderation-timeout"),
        // The verifier names it the way it sits beside the module, which is
        // not where the command runs from.
        "e2e/moderation-timeout.verify.mjs": verifier(
          "playwright.moderation-timeout.config.ts",
        ),
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "Playwright would not find a config named that way");
  assert.match(failure, /--config playwright\.moderation-timeout\.config\.ts/);
  assert.deepEqual(reported(failure), [
    `${API}/e2e/playwright.moderation-timeout.config.ts`,
    `${API}/package.json → "test:e2e:moderation-timeout"`,
  ]);
});

test("a config named only in a comment is started by nothing", (t) => {
  const commentedOut = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:banned-room": `${PLAYWRIGHT_PROGRAM} install chromium # ${PLAYWRIGHT_PROGRAM} ${RUN_SUBCOMMAND} --config e2e/playwright.config.ts`,
      },
      files: { "e2e/playwright.config.ts": config("banned-room") },
    },
  });

  const commentedScript = checkWorkspace(commentedOut);
  assert.ok(commentedScript, "a command commented out starts nothing");
  assert.deepEqual(reported(commentedScript), [
    `${API}/e2e/playwright.config.ts`,
  ]);

  const inTheVerifier = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:moderation-timeout": "node e2e/moderation-timeout.verify.mjs",
      },
      files: {
        "e2e/playwright.moderation-timeout.config.ts":
          config("moderation-timeout"),
        "e2e/moderation-timeout.verify.mjs": `import { spawn } from "node:child_process";
import { join } from "node:path";

// It used to start the suite with
//   "--config", "e2e/playwright.moderation-timeout.config.ts"
spawn(process.execPath, [
  join(process.cwd(), "node_modules/@playwright/test/cli.js"),
  "test",
]);
`,
      },
    },
  });

  const commentedModule = checkWorkspace(inTheVerifier);
  assert.ok(commentedModule, "a module naming it in a comment starts nothing");
  assert.deepEqual(reported(commentedModule), [
    `${API}/e2e/playwright.moderation-timeout.config.ts`,
  ]);
});

test("a command naming a config that is not there fails", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:banned-room": runScript("playwright.config.ts"),
        // The name it had before the suite was renamed.
        "test:e2e:moderation": runScript("playwright.moderation.config.ts"),
      },
      files: {
        "e2e/playwright.config.ts": config("banned-room"),
        "e2e/playwright.moderation-cases.config.ts": config("moderation"),
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a command promising a run that cannot start");
  assert.match(failure, /names a Playwright config that is not there/);
  assert.match(failure, /--config e2e\/playwright\.moderation\.config\.ts/);
  assert.match(
    failure,
    new RegExp(`looked for: ${API}/e2e/playwright\\.moderation\\.config\\.ts`),
  );
  // The renamed config is reported from the other side too: nothing runs it.
  assert.deepEqual(reported(failure), [
    `${API}/e2e/playwright.moderation-cases.config.ts`,
    `${API}/package.json → "test:e2e:moderation"`,
  ]);
});

test("a module naming a config that is not there fails too", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:moderation-timeout": "node e2e/moderation-timeout.verify.mjs",
      },
      files: {
        "e2e/moderation-timeout.verify.mjs": verifier(
          "e2e/playwright.moderation-timeout.config.ts",
        ),
        "e2e/playwright.config.ts": config("banned-room"),
        "e2e/playwright.banned-room.spec.ts": "",
      },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the config the verifier hands the CLI is not there");
  assert.match(
    failure,
    /through: artifacts\/api-server\/e2e\/moderation-timeout\.verify\.mjs/,
  );
  assert.match(
    failure,
    /--config e2e\/playwright\.moderation-timeout\.config\.ts/,
  );
});

test("installing a browser is not running a suite", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: {
        "test:e2e:banned-room": `${PLAYWRIGHT_PROGRAM} install chromium`,
      },
      files: { "e2e/playwright.config.ts": config("banned-room") },
    },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "only `playwright test` starts a suite");
  assert.deepEqual(reported(failure), [`${API}/e2e/playwright.config.ts`]);
});

test("a run naming no config takes the package's own", (t) => {
  const root = workspace(t, {
    [API]: {
      scripts: { "test:e2e": `${PLAYWRIGHT_PROGRAM} ${RUN_SUBCOMMAND}` },
      files: { "playwright.config.ts": config("banned-room") },
    },
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "Playwright reads the config in the directory the script runs from",
  );
});

test("finding no Playwright config at all is a failure", (t) => {
  const root = workspace(t, {
    [API]: { scripts: { test: "vitest run src" } },
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a check with nothing to check passes like a clean one");
  assert.match(failure, /No Playwright config was found/);
});

test("this workspace starts every Playwright config from a package script", () => {
  assert.equal(
    checkWorkspace(WORKSPACE_ROOT),
    null,
    "every browser suite here should have a command that runs it",
  );
});
