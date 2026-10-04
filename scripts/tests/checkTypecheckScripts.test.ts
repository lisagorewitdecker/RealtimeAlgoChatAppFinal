import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  checkWorkspace,
  findViolations,
  formatViolations,
  readWorkspaceGlobs,
  type Violation,
  type WorkspacePackage,
} from "../src/checkTypecheckScripts.ts";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** A fake workspace root, so path comparisons never touch the real one. */
const FAKE_ROOT = "/workspace";

function inPackage(
  scripts: Record<string, string>,
  dir = "artifacts/new-app",
): WorkspacePackage[] {
  return [{ dir, name: "@workspace/new-app", scripts }];
}

function check(
  command: string,
  dir = "artifacts/new-app",
): Violation | undefined {
  return findViolations(inPackage({ typecheck: command }, dir), FAKE_ROOT)[0];
}

test("flags a tsc -p script that skips the shared-library build", () => {
  const violation = check("tsc -p tsconfig.json --noEmit");
  assert.equal(violation?.kind, "missing");
  assert.equal(violation?.script, "typecheck");
});

test("flags a bare tsc --noEmit that checks the current directory", () => {
  assert.equal(check("tsc --noEmit")?.kind, "missing");
});

test("flags a package-local tsc --build, which skips the shared libraries", () => {
  const violation = check("tsc --build && tsc -p tsconfig.json --noEmit");
  assert.equal(violation?.kind, "missing");
  assert.match(String(violation?.hint), /package-local/);
});

test("flags a library build that only runs when a sibling project is built", () => {
  assert.equal(
    check("tsc --build ../../lib/db && tsc -p tsconfig.json --noEmit")?.kind,
    "missing",
  );
});

test("flags a library build joined with || so failure skips it", () => {
  assert.equal(
    check("pnpm -w run typecheck:libs || tsc -p tsconfig.json --noEmit")?.kind,
    "unguarded",
  );
});

test("flags a library build joined with ; so failure does not stop the check", () => {
  assert.equal(
    check("pnpm -w run typecheck:libs ; tsc -p tsconfig.json --noEmit")?.kind,
    "unguarded",
  );
});

test("flags a script that only mentions the build script as text", () => {
  assert.equal(
    check("echo typecheck:libs && tsc -p tsconfig.json --noEmit")?.kind,
    "missing",
  );
});

test("flags a build of another package's script rather than the root one", () => {
  assert.equal(
    check(
      "pnpm --filter @workspace/db run typecheck:libs && tsc -p tsconfig.json --noEmit",
    )?.kind,
    "missing",
  );
});

test("flags a non-root package calling the script without -w", () => {
  assert.equal(
    check("pnpm run typecheck:libs && tsc -p tsconfig.json --noEmit")?.kind,
    "missing",
  );
});

test("flags a library build that runs after the typecheck", () => {
  assert.equal(
    check("tsc -p tsconfig.json --noEmit && pnpm -w run typecheck:libs")?.kind,
    "out-of-order",
  );
});

test("flags a typecheck hidden inside sh -c", () => {
  assert.equal(check("sh -c 'tsc -p tsconfig.json --noEmit'")?.kind, "missing");
});

test("accepts the workspace convention and equivalent spellings", () => {
  assert.deepEqual(
    findViolations(
      inPackage({
        typecheck:
          "pnpm -w run typecheck:libs && tsc -p tsconfig.json --noEmit",
        "typecheck:e2e":
          "pnpm --workspace-root run typecheck:libs && tsc --project e2e/tsconfig.json --noEmit",
        "typecheck:both":
          "pnpm -w run typecheck:libs && tsc -p tsconfig.json --noEmit && pnpm exec tsc -p e2e/tsconfig.json --noEmit",
        "typecheck:root-project":
          "tsc --build ../../tsconfig.json && tsc -p tsconfig.json --noEmit",
        "typecheck:shell":
          "pnpm -w run typecheck:libs && sh -c 'tsc -p tsconfig.json --noEmit'",
      }),
      FAKE_ROOT,
    ),
    [],
  );
});

test("accepts the root package building the libraries without -w", () => {
  assert.equal(
    check("pnpm run typecheck:libs && tsc -p tsconfig.json --noEmit", "."),
    undefined,
  );
});

test("ignores scripts that never check a project with tsc", () => {
  assert.deepEqual(
    findViolations(
      inPackage({
        build: "node ./build.mjs",
        "typecheck:libs": "tsc --build",
        version: "tsc --version",
        test: "vitest run src",
        dev: "vite dev --port 3000",
      }),
      FAKE_ROOT,
    ),
    [],
  );
});

test("says what to add and why", () => {
  const message = formatViolations(
    findViolations(
      inPackage({ typecheck: "tsc -p tsconfig.json --noEmit" }),
      FAKE_ROOT,
    ),
  );
  assert.match(
    message,
    /fix: pnpm -w run typecheck:libs && tsc -p tsconfig\.json --noEmit/,
  );
  assert.match(message, /lib\/<name>\/dist/);
});

test("this workspace follows the convention", () => {
  assert.equal(checkWorkspace(WORKSPACE_ROOT), null);
});

test("reads the package globs out of pnpm-workspace.yaml", () => {
  const globs = readWorkspaceGlobs(
    [
      "# comment",
      "packages:",
      "  - artifacts/*",
      "  - scripts",
      "",
      "catalog:",
      "  zod: ^3",
    ].join("\n"),
  );
  assert.deepEqual(globs, ["artifacts/*", "scripts"]);
});
