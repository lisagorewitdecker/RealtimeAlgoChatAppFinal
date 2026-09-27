import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  collectUnitTestFiles,
  findUnitTestFiles,
  UNIT_TEST_DIR,
} from "../src/runUnitTests.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** A throwaway tree of empty files, removed when the test ends. */
function tree(t: TestContext, files: string[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "unit-test-discovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "");
  }
  return root;
}

test("finds a suite added to a package's tests directory", (t) => {
  const root = tree(t, [
    `artifacts/api/${UNIT_TEST_DIR}/existing.test.ts`,
    `artifacts/api/${UNIT_TEST_DIR}/brandNew.test.ts`,
    `scripts/${UNIT_TEST_DIR}/convention.test.ts`,
  ]);
  assert.deepEqual(findUnitTestFiles(root, ["artifacts/api", "scripts"]), [
    `artifacts/api/${UNIT_TEST_DIR}/brandNew.test.ts`,
    `artifacts/api/${UNIT_TEST_DIR}/existing.test.ts`,
    `scripts/${UNIT_TEST_DIR}/convention.test.ts`,
  ]);
});

test("finds suites nested below the tests directory", (t) => {
  const root = tree(t, [`lib/db/${UNIT_TEST_DIR}/queries/rooms.test.ts`]);
  assert.deepEqual(findUnitTestFiles(root, ["lib/db"]), [
    `lib/db/${UNIT_TEST_DIR}/queries/rooms.test.ts`,
  ]);
});

test("leaves suites that belong to another runner alone", (t) => {
  const root = tree(t, [
    // vitest and jest suites, run by their own package's `test` script
    "artifacts/api/src/lib/rooms.test.ts",
    "artifacts/app/__tests__/Home.test.tsx",
    // helpers and fixtures next to the suites, and an e2e suite elsewhere
    `artifacts/api/${UNIT_TEST_DIR}/helpers.ts`,
    `artifacts/api/${UNIT_TEST_DIR}/fixtures/profile.json`,
    "artifacts/api/e2e/launch-smoke.test.ts",
  ]);
  assert.deepEqual(
    findUnitTestFiles(root, ["artifacts/api", "artifacts/app"]),
    [
      // the tests directory only; nothing colocated with source
    ],
  );
});

test("skips anything vendored inside node_modules", (t) => {
  const root = tree(t, [
    `scripts/${UNIT_TEST_DIR}/real.test.ts`,
    `scripts/node_modules/some-dep/${UNIT_TEST_DIR}/dep.test.ts`,
  ]);
  assert.deepEqual(
    findUnitTestFiles(root, ["scripts", "scripts/node_modules"]),
    [`scripts/${UNIT_TEST_DIR}/real.test.ts`],
  );
});

test("discovers this workspace's suites without a hardcoded list", () => {
  const files = collectUnitTestFiles(WORKSPACE_ROOT);

  // This file is discovered by the same pattern that runs it.
  assert.ok(
    files.includes(`scripts/${UNIT_TEST_DIR}/runUnitTests.test.ts`),
    `this suite should discover itself, found: ${files.join(", ")}`,
  );
  assert.ok(
    files.includes(
      `artifacts/api-server/${UNIT_TEST_DIR}/profileIdentity.test.ts`,
    ),
    `the api-server suite should be discovered, found: ${files.join(", ")}`,
  );
  for (const file of files) {
    assert.match(file, new RegExp(`/${UNIT_TEST_DIR}/`));
  }
});
