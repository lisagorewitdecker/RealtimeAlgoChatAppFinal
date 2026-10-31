import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  type Dirent,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdir,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const require = createRequire(resolve(root, "package.json"));
const lockfile = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");

function versions(name: string): string[] {
  return [
    ...new Set(
      [...lockfile.matchAll(new RegExp(`^  ${name}@([^:(]+):$`, "gm"))].map(
        (match) => match[1],
      ),
    ),
  ];
}

function packagePath(name: string, version: string): string {
  return resolve(
    root,
    `node_modules/.pnpm/${name}@${version}/node_modules/${name}`,
  );
}

test("minimatch audit exception applies only to legacy implementations", () => {
  const installed = versions("minimatch");
  assert.ok(installed.length > 0);
  for (const version of installed) {
    const path = packagePath("minimatch", version);
    const [major, minor, patch] = version.split(".").map(Number);
    const matcher = require(path);
    if (major === 3) {
      assert.equal(version, "3.1.5");
      assert.equal(typeof matcher, "function");
      assert.equal(matcher.Minimatch.prototype.firstPhasePreProcess, undefined);
      assert.equal(matcher("src/test.ts", "src/*.ts"), true);
    } else {
      assert.ok(
        major > 11 || (major === 11 && (minor > 0 || patch >= 1)),
        version,
      );
      assert.equal(matcher.minimatch("src/test.ts", "src/*.ts"), true);
    }
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
        const matcher = require(process.argv[1]);
        new matcher.Minimatch("**/../".repeat(30) + "*.ts", { optimizationLevel: 2 });
      `,
        path,
      ],
      { timeout: 5000, encoding: "utf8" },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  }
});

for (const version of versions("glob")) {
  test(`glob ${version} preserves its API and stops directory reads on abort`, async (t) => {
    const glob = require(packagePath("glob", version));
    const cwd = mkdtempSync(resolve(tmpdir(), "glob-security-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    mkdirSync(resolve(cwd, "child"));
    writeFileSync(resolve(cwd, "child/test.ts"), "");

    if (version === "7.2.3") {
      assert.equal(typeof glob, "function");
      assert.deepEqual(glob.sync("**/*.ts", { cwd }), ["child/test.ts"]);
      return;
    }
    const [major, minor, patch] = version.split(".").map(Number);
    assert.ok(
      major > 14 || (major === 14 && (minor > 0 || patch >= 2)),
      version,
    );
    assert.deepEqual(await glob.glob("**/*.ts", { cwd }), ["child/test.ts"]);
    assert.deepEqual(glob.globSync("**/*.ts", { cwd }), ["child/test.ts"]);

    const controller = new AbortController();
    let reads = 0;
    const reason = new Error("test abort");
    await assert.rejects(
      glob.glob("**/*.ts", {
        cwd,
        signal: controller.signal,
        fs: {
          readdir(
            path: string,
            options: { withFileTypes: true },
            callback: (
              error: NodeJS.ErrnoException | null,
              entries: Dirent[],
            ) => void,
          ) {
            reads++;
            readdir(path, options, (error, entries) => {
              controller.abort(reason);
              callback(error, entries);
            });
          },
        },
      }),
      reason,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reads, 1);
  });
}
