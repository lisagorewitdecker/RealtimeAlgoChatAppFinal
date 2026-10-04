import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  findPlaywrightConfigs,
  isPlaywrightConfig,
} from "../src/playwrightConfigs.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** A Playwright config, whatever the file it is written in is called. */
const PLAYWRIGHT = `import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "." });
`;

/** A throwaway workspace on disk, removed when the test ends. */
function workspace(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "playwright-configs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

test("a config is found wherever a package keeps one", (t) => {
  const root = workspace(t, {
    "artifacts/api-server/e2e/playwright.config.ts": PLAYWRIGHT,
    "artifacts/chat-app/e2e/browser/playwright.tabs.config.ts": PLAYWRIGHT,
    "lib/db/e2e/playwright.migrations.config.ts": PLAYWRIGHT,
    "scripts/e2e/playwright.checks.config.ts": PLAYWRIGHT,
    // Above every package, belonging to no one and running everything.
    "playwright.config.ts": PLAYWRIGHT,
    // Named for nothing in particular, and still a Playwright config.
    "tools/browserChecks.ts": PLAYWRIGHT,
  });

  assert.deepEqual(findPlaywrightConfigs(root), [
    "artifacts/api-server/e2e/playwright.config.ts",
    "artifacts/chat-app/e2e/browser/playwright.tabs.config.ts",
    "lib/db/e2e/playwright.migrations.config.ts",
    "playwright.config.ts",
    "scripts/e2e/playwright.checks.config.ts",
    "tools/browserChecks.ts",
  ]);
});

test("nobody else's configs are read as this workspace's", (t) => {
  const root = workspace(t, {
    "artifacts/api-server/e2e/playwright.config.ts": PLAYWRIGHT,
    // A dependency's own config, and build output holding a copy of ours.
    "node_modules/some-pkg/playwright.config.ts": PLAYWRIGHT,
    "artifacts/api-server/node_modules/pkg/playwright.config.js": PLAYWRIGHT,
    "artifacts/api-server/dist/e2e/playwright.config.js": PLAYWRIGHT,
    // Tooling state rather than a package: caches, editor and agent files.
    ".cache/playwright.config.ts": PLAYWRIGHT,
    ".local/state/playwright.config.ts": PLAYWRIGHT,
  });

  assert.deepEqual(findPlaywrightConfigs(root), [
    "artifacts/api-server/e2e/playwright.config.ts",
  ]);
});

test("another tool's config is not Playwright's", () => {
  assert.equal(
    isPlaywrightConfig(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
`,
    ),
    false,
    "a bare *.config.ts out in the workspace belongs to whoever named it",
  );
  assert.equal(
    isPlaywrightConfig("jest.config.js", "module.exports = { preset: 'x' };\n"),
    false,
  );
  assert.equal(isPlaywrightConfig("playwright.config.ts", ""), true);
  assert.equal(isPlaywrightConfig("browserChecks.ts", PLAYWRIGHT), true);
});

test("a suite is not a config, however much of one it quotes", () => {
  // These checks are themselves tested against config sources written
  // inline, so a test file read as a real config would be held to
  // conventions its fixtures are written to break.
  const fixture = `const source = \`${PLAYWRIGHT}\`;
`;
  assert.equal(
    isPlaywrightConfig("checkBrowserOutput.test.ts", fixture),
    false,
  );
  assert.equal(isPlaywrightConfig("moderation.spec.ts", fixture), false);
});

test("this workspace's own checks are not read as configs", () => {
  assert.deepEqual(
    findPlaywrightConfigs(WORKSPACE_ROOT).filter((config) =>
      config.startsWith("scripts/"),
    ),
    [],
    "the files testing these checks quote configs rather than being them",
  );
});
