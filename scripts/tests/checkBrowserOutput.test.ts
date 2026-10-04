import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  checkWorkspace,
  inspectConfig,
  namesTemporaryDirectory,
  OUTPUT_DIR_KEY,
  PRESERVE_OUTPUT_KEY,
  PRESERVE_OUTPUT_VALUE,
  readEntries,
} from "../src/checkBrowserOutput.ts";
import { findPlaywrightConfigs } from "../src/playwrightConfigs.ts";

/** The tree this workspace's packages live in. */
const ARTIFACTS_DIR = "artifacts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** The imports a config redirecting its output carries. */
const TEMP_DIR_IMPORTS = `import { tmpdir } from "node:os";
import { join } from "node:path";
`;

/** The two entries every browser config in this workspace has to carry. */
const REDIRECTED = `  ${OUTPUT_DIR_KEY}: join(tmpdir(), "moderation-playwright"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`;

function config(body: string, imports = TEMP_DIR_IMPORTS): string {
  return `import { defineConfig } from "@playwright/test";
${imports}
export default defineConfig({
  testDir: ".",
  testMatch: /moderation\\.spec\\.ts/,
${body}});
`;
}

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "browser-output-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

/** Shorthand for a file in the directory holding this workspace's suites. */
const e2e = (name: string): string => `${ARTIFACTS_DIR}/api-server/e2e/${name}`;

/**
 * The configs a report lists, which are the ones indented by two spaces. The
 * fix names a compliant config as the shape to copy, indented further.
 */
const reportedConfigs = (failure: string): string[] =>
  failure
    .split("\n")
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => line.trim());

test("a config writing to a temporary directory and keeping nothing passes", (t) => {
  const root = workspace(t, {
    [e2e("playwright.moderation.config.ts")]: config(REDIRECTED),
  });

  assert.equal(checkWorkspace(root), null);
});

test("a new config left at the defaults fails", (t) => {
  const root = workspace(t, {
    [e2e("playwright.moderation.config.ts")]: config(REDIRECTED),
    // The next suite someone adds, taking Playwright's defaults with it.
    [e2e("playwright.rooms.config.ts")]: config("  workers: 1,\n", ""),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a config at the defaults writes snapshots into the repo");
  assert.match(failure, /playwright\.rooms\.config\.ts/);
  assert.match(failure, new RegExp(`names no run-wide ${OUTPUT_DIR_KEY}`));
  assert.match(failure, new RegExp(`names no ${PRESERVE_OUTPUT_KEY}`));
  // The compliant config is named in the fix as the shape to copy, so what
  // matters is that it is not one of the entries reported.
  assert.deepEqual(reportedConfigs(failure), [
    e2e("playwright.rooms.config.ts"),
  ]);
});

test("an output directory inside the repository fails", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: "./test-results",
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      "",
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a relative path resolves against the config's own dir");
  assert.match(failure, /not rooted outside the repository/);
});

test("an absolute path inside the repository is still inside it", (t) => {
  const root = workspace(t, { [e2e("placeholder.txt")]: "" });
  const configPath = e2e("playwright.config.ts");
  writeFileSync(
    path.join(root, configPath),
    config(
      `  ${OUTPUT_DIR_KEY}: "${path.join(root, "artifacts/api-server/e2e/out")}",
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      "",
    ),
  );

  const problem = inspectConfig(root, configPath);
  assert.ok(problem, "naming the repository by its absolute path is no better");
  assert.deepEqual(problem.kinds, ["repository-output-dir"]);
});

test("an absolute path outside the repository passes", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: "/var/tmp/banned-room-playwright",
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      "",
    ),
  });

  assert.equal(checkWorkspace(root), null);
});

test("a path climbing back out of the temporary directory fails", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: join(tmpdir(), "..", "..", "workspace", "test-results"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a climb with .. can land anywhere, this repository too");
  assert.match(failure, /not rooted outside the repository/);
});

test("a later resolve argument starting the path over fails", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: resolve(tmpdir(), process.cwd(), "test-results"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      `import { tmpdir } from "node:os";
import { resolve } from "node:path";
`,
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "resolve reads its arguments from the right, so this lands under the working directory",
  );
  assert.match(failure, /not rooted outside the repository/);
});

test("an absolute repository path later in resolve fails", (t) => {
  const root = workspace(t, { [e2e("placeholder.txt")]: "" });
  const configPath = e2e("playwright.config.ts");
  writeFileSync(
    path.join(root, configPath),
    config(
      `  ${OUTPUT_DIR_KEY}: resolve(tmpdir(), "${path.join(root, "test-results")}"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      `import { tmpdir } from "node:os";
import { resolve } from "node:path";
`,
    ),
  );

  const problem = inspectConfig(root, configPath);
  assert.ok(problem, "the last absolute argument is the one that decides");
  assert.deepEqual(problem.kinds, ["repository-output-dir"]);
});

test("resolve restarted at the temporary directory passes", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: resolve("test-results", tmpdir(), "banned-room-playwright"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      `import { tmpdir } from "node:os";
import { resolve } from "node:path";
`,
    ),
  });

  assert.equal(
    checkWorkspace(root),
    null,
    "what precedes the last absolute argument is discarded by resolve",
  );
});

test("resolving only relative paths lands in the working directory", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: resolve("test-results", "browser"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      `import { resolve } from "node:path";\n`,
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "resolve with nothing absolute starts at process.cwd()");
  assert.match(failure, /not rooted outside the repository/);
});

test("an output directory the environment chooses fails", (t) => {
  const root = workspace(t, {
    [e2e("playwright.moderation-timeout.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: process.env.MODERATION_TIMEOUT_OUTPUT ?? join(tmpdir(), "moderation-timeout-output"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(
    failure,
    "a temporary-directory fallback says nothing about the run where the variable is set",
  );
  assert.match(failure, /taken from the environment/);
});

test("reaching the temporary directory through the os module passes", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: os.tmpdir() + "/banned-room-playwright",
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
      `import * as os from "node:os";\n`,
    ),
  });

  assert.equal(checkWorkspace(root), null);
});

test("a template rooted at the temporary directory passes", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: \`\${tmpdir()}/banned-room-playwright-\${process.pid}\`,
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
    ),
  });

  assert.equal(checkWorkspace(root), null);
});

test("a local function borrowing the name is not the temporary directory", (t) => {
  const source = config(
    `  ${OUTPUT_DIR_KEY}: join(tmpdir(), "banned-room-playwright"),
  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
    `import { tmpdir } from "./paths";
import { join } from "node:path";
`,
  );
  const root = workspace(t, { [e2e("playwright.config.ts")]: source });

  assert.equal(
    namesTemporaryDirectory(source, "tmpdir()"),
    false,
    "only node:os is known to sit outside the repository",
  );
  const failure = checkWorkspace(root);
  assert.ok(failure, "a same-named local helper can point anywhere");
  assert.match(failure, /not rooted outside the repository/);
});

test("a project writing into the repository fails a config that otherwise passes", (t) => {
  const configPath = e2e("playwright.config.ts");
  const root = workspace(t, {
    [configPath]: config(
      `${REDIRECTED}  projects: [
    { name: "desktop" },
    { name: "phone", ${OUTPUT_DIR_KEY}: "./test-results" },
  ],
`,
    ),
  });

  const problem = inspectConfig(root, configPath);
  assert.ok(problem, "a project names where its own failures are written");
  assert.deepEqual(problem.kinds, ["repository-output-dir"]);
  assert.ok(
    problem.settings.some((setting) => setting.includes("a project's own")),
    `the offending entry is named as a project's: ${problem.settings.join("; ")}`,
  );
});

test("projects naming their own temporary directories still need a run-wide one", (t) => {
  const configPath = e2e("playwright.config.ts");
  const root = workspace(t, {
    [configPath]: config(
      `  ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
  projects: [
    { name: "desktop", ${OUTPUT_DIR_KEY}: join(tmpdir(), "desktop-playwright") },
    { name: "phone", ${OUTPUT_DIR_KEY}: join(tmpdir(), "phone-playwright") },
  ],
`,
    ),
  });

  const problem = inspectConfig(root, configPath);
  assert.ok(problem, "the next project added inherits the default");
  assert.deepEqual(problem.kinds, ["default-output-dir"]);
});

test("a project redirecting its own output alongside the run's passes", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `${REDIRECTED}  projects: [
    { name: "desktop" },
    { name: "phone", ${OUTPUT_DIR_KEY}: join(tmpdir(), "phone-playwright") },
  ],
`,
    ),
  });

  assert.equal(checkWorkspace(root), null);
});

test("every entry is read, not just the first", () => {
  const entries = readEntries(
    `  ${OUTPUT_DIR_KEY}: join(tmpdir(), "run"),
  projects: [{ name: "phone", ${OUTPUT_DIR_KEY}: "./test-results" }],
`,
    OUTPUT_DIR_KEY,
  );

  assert.deepEqual(entries, [
    { value: 'join(tmpdir(), "run")', depth: 0 },
    { value: '"./test-results"', depth: 2 },
  ]);
});

test("keeping the output of failed runs is keeping the captured page", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  ${OUTPUT_DIR_KEY}: join(tmpdir(), "banned-room-playwright"),
  ${PRESERVE_OUTPUT_KEY}: "failures-only",
`,
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a failed run is the one that captured the sign-in page");
  assert.match(failure, /keeps output the run wrote/);
  assert.match(failure, /failures-only/);
});

test("commented-out entries are not settings", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(
      `  // ${OUTPUT_DIR_KEY}: join(tmpdir(), "banned-room-playwright"),
  // ${PRESERVE_OUTPUT_KEY}: "${PRESERVE_OUTPUT_VALUE}",
`,
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a config mentioning the keys in comments sets nothing");
  assert.match(failure, new RegExp(`names no run-wide ${OUTPUT_DIR_KEY}`));
  assert.match(failure, new RegExp(`names no ${PRESERVE_OUTPUT_KEY}`));
});

test("a config built somewhere this check cannot read fails", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]:
      `import { defineConfig } from "@playwright/test";
import { buildConfig } from "./configFactory.ts";

export default buildConfig(defineConfig);
`,
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "a config nobody can read is a config nobody reviews");
  assert.match(failure, /cannot find the object it exports/);
});

test("a config bound to a name before it is exported is read", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]:
      `import type { PlaywrightTestConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config: PlaywrightTestConfig = {
  testDir: ".",
${REDIRECTED}};

export default config;
`,
  });

  assert.equal(checkWorkspace(root), null);
});

test("every package is searched, and only Playwright's configs are read", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(REDIRECTED),
    // A second artifact adding browser checks of its own.
    [`${ARTIFACTS_DIR}/chat-app/e2e/browser/playwright.tabs.config.ts`]:
      config(REDIRECTED),
    // Named like a config, but nothing to do with Playwright's output.
    [`${ARTIFACTS_DIR}/api-server/vitest.config.ts`]: `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
`,
    [`${ARTIFACTS_DIR}/chat-app/jest.config.js`]:
      "module.exports = { preset: 'jest-expo' };\n",
    // A browser config under another name is still a browser config.
    [`${ARTIFACTS_DIR}/api-server/e2e/browserChecks.ts`]: config(REDIRECTED),
    // Dependencies and build output are not this workspace's configs.
    [`${ARTIFACTS_DIR}/api-server/node_modules/pkg/playwright.config.ts`]:
      config("  workers: 1,\n", ""),
    [`${ARTIFACTS_DIR}/api-server/dist/playwright.config.js`]: config(
      "  workers: 1,\n",
      "",
    ),
  });

  assert.deepEqual(findPlaywrightConfigs(root), [
    `${ARTIFACTS_DIR}/api-server/e2e/browserChecks.ts`,
    `${ARTIFACTS_DIR}/api-server/e2e/playwright.config.ts`,
    `${ARTIFACTS_DIR}/chat-app/e2e/browser/playwright.tabs.config.ts`,
  ]);
  assert.equal(checkWorkspace(root), null);
});

test("a browser config above the packages is checked too", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(REDIRECTED),
    // A config at the workspace root, and one in a shared library: neither
    // sits under artifacts/, and both write into this working copy.
    "playwright.config.ts": config("  workers: 1,\n", ""),
    "lib/db/e2e/playwright.migrations.config.ts": config("  workers: 1,\n", ""),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the convention is the workspace's, not one tree's");
  assert.deepEqual(reportedConfigs(failure), [
    "lib/db/e2e/playwright.migrations.config.ts",
    "playwright.config.ts",
  ]);
});

test("a browser config in another artifact is checked too", (t) => {
  const root = workspace(t, {
    [e2e("playwright.config.ts")]: config(REDIRECTED),
    [`${ARTIFACTS_DIR}/chat-app/e2e/playwright.tabs.config.ts`]: config(
      "  workers: 1,\n",
      "",
    ),
  });

  const failure = checkWorkspace(root);
  assert.ok(failure, "the convention is the workspace's, not one package's");
  assert.match(failure, /chat-app\/e2e\/playwright\.tabs\.config\.ts/);
});

test("finding no config at all is a failure, not an empty pass", (t) => {
  const root = workspace(t, {});

  const failure = checkWorkspace(root);
  assert.ok(failure, "a check with nothing to check reports the same green");
  assert.match(failure, /No Playwright config/);
});

test("this workspace's browser configs keep their output out of it", () => {
  assert.equal(
    checkWorkspace(WORKSPACE_ROOT),
    null,
    "every Playwright config in this workspace should write its output outside the repository and keep none of it",
  );
});
