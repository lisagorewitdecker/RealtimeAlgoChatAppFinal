import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const specRequire = createRequire(
  resolve(process.cwd(), "lib/api-spec/package.json"),
);
const orvalRequire = createRequire(specRequire.resolve("orval"));
const yaml = orvalRequire("js-yaml");

test("the security lockfile has unique mapping keys and complete snapshots", () => {
  const lockfile = yaml.load(
    readFileSync(resolve(process.cwd(), "pnpm-lock.yaml"), "utf8"),
  );

  for (const [key, snapshot] of Object.entries(lockfile.snapshots)) {
    assert.ok(snapshot && typeof snapshot === "object", `${key} is empty`);
    const packageKey = key.split("(")[0];
    assert.ok(
      lockfile.packages[packageKey]?.resolution,
      `${key} has no package resolution`,
    );
  }
});
