/**
 * Runs the workspace's `node:test` unit suites, discovered by pattern.
 *
 * The convention is one directory per package: every `.test.ts` file under the
 * `tests` directory of a package listed in `pnpm-workspace.yaml` is a unit
 * suite, so a new file runs the moment it is written. The root `test:unit`
 * script used to name each file by path instead, which meant a suite nobody
 * remembered to add to that list never ran while the command still reported
 * success.
 *
 * Suites colocated with source are deliberately not matched: `artifacts/
 * api-server/src` holds vitest suites and `artifacts/chat-app/__tests__` holds
 * jest suites, both run by their own package's `test` script and neither
 * runnable by Node's test runner.
 *
 * Discovery that matches nothing fails instead of reporting an empty pass —
 * `node --test` given a glob that matches no file exits 0 with zero tests,
 * which is the same silent green this script exists to prevent.
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectWorkspacePackages } from "./checkTypecheckScripts.ts";

/** Directory, inside a workspace package, holding that package's unit suites. */
export const UNIT_TEST_DIR = "tests";

/** What counts as a unit suite inside that directory. */
export const UNIT_TEST_GLOB = `${UNIT_TEST_DIR}/**/*.test.ts`;

const toPosix = (value: string): string => value.split(path.sep).join("/");

/**
 * Unit suites inside the given package directories, as workspace-relative
 * paths, sorted so a run is reproducible.
 */
export function findUnitTestFiles(
  root: string,
  packageDirs: string[],
): string[] {
  const files = new Set<string>();
  for (const dir of packageDirs) {
    const pattern = toPosix(path.join(dir, UNIT_TEST_GLOB));
    for (const match of globSync(pattern, { cwd: root })) {
      const file = toPosix(match);
      if (file.split("/").includes("node_modules")) continue;
      files.add(file);
    }
  }
  return [...files].sort();
}

/** Every unit suite in the workspace, package list read from pnpm-workspace.yaml. */
export function collectUnitTestFiles(root: string): string[] {
  const dirs = collectWorkspacePackages(root).map((pkg) => pkg.dir);
  return findUnitTestFiles(root, dirs);
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const files = collectUnitTestFiles(root);

  if (files.length === 0) {
    console.error(
      [
        "",
        `No unit test files matched ${UNIT_TEST_GLOB} in any workspace package.`,
        "",
        "That is reported as a failure on purpose: a run with nothing to run",
        `looks identical to a passing run. Either add a suite under a package's`,
        `${UNIT_TEST_DIR}/ directory, or update the discovery in`,
        "scripts/src/runUnitTests.ts if the convention moved.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Running ${files.length} unit test file${files.length === 1 ? "" : "s"}:`,
  );
  for (const file of files) console.log(`  ${file}`);

  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
