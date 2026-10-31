import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const store = resolve(process.cwd(), "node_modules/.pnpm");
const versions = readdirSync(store).filter((name) =>
  /^minimatch@\d/.test(name),
);
assert.ok(versions.length > 0, "installed minimatch versions must be tested");

for (const version of versions) {
  const packagePath = resolve(store, version, "node_modules/minimatch");
  const cjs = require(packagePath);
  const major = Number(
    require(resolve(packagePath, "package.json")).version.split(".")[0],
  );

  if (major === 3) {
    test(`${version} retains its callable API without vulnerable preprocessing`, () => {
      assert.equal(typeof cjs, "function");
      assert.equal(cjs("src/file.ts", "src/**/*.ts"), true);
      assert.equal(cjs.Minimatch.prototype.firstPhasePreProcess, undefined);
      assert.equal(cjs.Minimatch.prototype.secondPhasePreProcess, undefined);
    });
    continue;
  }

  assert.ok(
    major === 10 || major >= 11,
    `uncovered minimatch version: ${version}`,
  );
  for (const [entry, load] of [
    ["CommonJS", () => cjs],
    [
      "ESM",
      () =>
        import(pathToFileURL(resolve(packagePath, "dist/esm/index.js")).href),
    ],
  ] as const) {
    test(`${version} ${entry} bounds preprocessing and retains ordinary matching`, async () => {
      const { Minimatch, minimatch } = await load();
      assert.equal(minimatch("src/file.ts", "src/**/*.ts"), true);
      assert.equal(minimatch("src/file.js", "src/**/*.ts"), false);
      const matcher = new Minimatch("**/../a/b", {
        optimizationLevel: 2,
        braceExpandMax: 8,
      });
      const parts = Array.from({ length: 8 }, () => ["**", "..", "a", "b"]);
      assert.equal(matcher.firstPhasePreProcess(parts).length, 8);
      const largeSet = Array.from({ length: 1001 }, (_, i) => [`file${i}`]);
      matcher.partsMatch = () =>
        assert.fail("large sets must skip quadratic deduplication");
      assert.equal(matcher.secondPhasePreProcess(largeSet), largeSet);
    });
  }
}
