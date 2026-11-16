import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const require = createRequire(import.meta.url);
const store = resolve(root, "node_modules/.pnpm");
const specRequire = createRequire(resolve(root, "lib/api-spec/package.json"));
const orvalRequire = createRequire(specRequire.resolve("orval"));
const yaml = orvalRequire("js-yaml") as {
  load: (content: string) => {
    packages: Record<string, unknown>;
    patchedDependencies: Record<string, string>;
    snapshots: Record<string, unknown>;
  };
};

test("the lockfile excludes minimatch releases affected by GHSA-g3hv-75wg-m249", () => {
  const lockfile = yaml.load(
    readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"),
  );
  const resolved = Object.keys(lockfile.packages)
    .filter((name) => name.startsWith("minimatch@"))
    .map((name) => name.slice("minimatch@".length));
  assert.ok(resolved.length > 0);
  for (const version of resolved) {
    const [major, minor, patch] = version.split(".").map(Number);
    if (major === 3) {
      assert.equal(version, "3.1.5");
      continue;
    }
    assert.ok(
      major > 11 || (major === 11 && (minor > 0 || patch >= 1)),
      `vulnerable minimatch ${version}`,
    );
  }
});

test("the lockfile registers the TypeDoc compatibility patch on every resolution", () => {
  const lockfile = yaml.load(
    readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"),
  );
  const hash = createHash("sha256")
    .update(readFileSync(resolve(root, "patches/typedoc@0.28.20.patch")))
    .digest("hex");
  assert.equal(lockfile.patchedDependencies["typedoc@0.28.20"], hash);
  const resolutions = Object.keys(lockfile.snapshots).filter((key) =>
    key.startsWith("typedoc@"),
  );
  assert.ok(resolutions.length > 0);
  for (const resolution of resolutions) {
    assert.ok(resolution.includes(`(patch_hash=${hash})`), resolution);
  }
});

const versions = readdirSync(store).filter((name) =>
  /^minimatch@\d/.test(name),
);
assert.ok(versions.length > 0, "installed minimatch versions must be tested");

for (const version of versions) {
  const packagePath = resolve(store, version, "node_modules/minimatch");
  const cjs = require(packagePath);
  const [major, minor, patch] = (
    require(resolve(packagePath, "package.json")) as { version: string }
  ).version
    .split(".")
    .map(Number);

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
    major > 11 || (major === 11 && (minor > 0 || patch >= 1)),
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
      const matcher = new Minimatch(Array(30).fill("**/../a/b").join("/"), {
        optimizationLevel: 2,
        braceExpandMax: 8,
      });
      assert.equal(matcher.set.length, 8);
      const parts = Array.from({ length: 8 }, () => ["**", "..", "a", "b"]);
      assert.equal(matcher.firstPhasePreProcess(parts).length, 8);
      const largeSet = Array.from({ length: 1001 }, (_, i) => [`file${i}`]);
      matcher.partsMatch = () =>
        assert.fail("large sets must skip quadratic deduplication");
      assert.equal(matcher.secondPhasePreProcess(largeSet), largeSet);
    });
  }
}

test("Expo fingerprint and test-exclude consumers retain expected matching behavior", () => {
  const chatAppRequire = createRequire(
    resolve(root, "artifacts/chat-app/package.json"),
  );
  const expoRequire = createRequire(chatAppRequire.resolve("expo"));
  const fingerprintRequire = createRequire(
    expoRequire.resolve("@expo/fingerprint/package.json"),
  );
  const { isIgnoredPath, buildPathMatchObjects, buildDirMatchObjects } =
    fingerprintRequire("./build/utils/Path.js");
  const patterns = ["**/generated/**", "!**/generated/keep.ts"];
  assert.equal(isIgnoredPath("src/generated/skip.ts", patterns), true);
  assert.equal(isIgnoredPath("src/generated/keep.ts", patterns), false);
  assert.equal(isIgnoredPath("src/index.ts", patterns), false);
  assert.deepEqual(buildDirMatchObjects(buildPathMatchObjects(patterns)), []);

  for (const entry of readdirSync(store).filter((name) =>
    name.startsWith("test-exclude@"),
  )) {
    const TestExclude = require(resolve(store, entry, "node_modules/test-exclude"));
    const exclude = new TestExclude({
      cwd: root,
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
    });
    assert.equal(
      exclude.shouldInstrument(join(root, "src/index.ts"), "src/index.ts"),
      true,
    );
    assert.equal(
      exclude.shouldInstrument(
        join(root, "src/index.test.ts"),
        "src/index.test.ts",
      ),
      false,
    );
  }
});

test("TypeDoc retains nested glob discovery with minimatch 11", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "minimatch-typedoc-"));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  for (const relativePath of [
    "src/index.ts",
    "src/nested/component.tsx",
    "src/nested/skip.js",
    "src/.hidden/secret.ts",
    "src/node_modules/dependency/index.ts",
    "docs/example.ts",
  ]) {
    const file = join(tempRoot, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  const typedocDir = dirname(specRequire.resolve("typedoc/package.json"));
  const typedocRequire = createRequire(join(typedocDir, "package.json"));
  const { glob, splitGlobToPathAndSpecial } = (await import(
    pathToFileURL(join(typedocDir, "dist/node-utils.js")).href
  )) as {
    glob: (pattern: string, root: string) => string[];
    splitGlobToPathAndSpecial: (pattern: string) => {
      modifiers: string;
      path: string;
      glob: string;
    };
  };
  assert.deepEqual(glob(`${tempRoot}/src/**/*.{ts,tsx}`, tempRoot).sort(), [
    join(tempRoot, "src/index.ts"),
    join(tempRoot, "src/nested/component.tsx"),
  ]);
  assert.deepEqual(glob(`${tempRoot}/src/node_modules/**/*.ts`, tempRoot), [
    join(tempRoot, "src/node_modules/dependency/index.ts"),
  ]);
  assert.deepEqual(glob(`!${tempRoot}/src/**/*.{ts,tsx}`, tempRoot), [
    join(tempRoot, "src/nested/skip.js"),
  ]);
  const split = splitGlobToPathAndSpecial(`${tempRoot}/src/**/*.{ts,tsx}`);
  assert.equal(split.modifiers, "");
  assert.equal(split.path, `${tempRoot}/src`);
  const { minimatch } = typedocRequire("minimatch") as {
    minimatch: (p: string, pattern: string) => boolean;
  };
  for (const candidate of ["index.ts", "nested/component.tsx", "nested/skip.js"]) {
    assert.equal(
      minimatch(candidate, split.glob),
      minimatch(candidate, "**/*.{ts,tsx}"),
      candidate,
    );
  }
});
