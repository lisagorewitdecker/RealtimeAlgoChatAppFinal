import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const expoCliRequire = createRequire(expoRequire.resolve("@expo/cli"));
const expoConfigRequire = createRequire(expoCliRequire.resolve("@expo/config"));
const deepmerge = expoConfigRequire("deepmerge") as (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
) => Record<string, unknown>;

test("deepmerge ignores prototype-sensitive keys from targets and sources", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const target = JSON.parse(
      `{"${key}":{"polluted":true},"kept":{"target":true}}`,
    );
    const source = JSON.parse(
      `{"${key}":{"polluted":true},"kept":{"source":true}}`,
    );
    const result = deepmerge(target, source);

    assert.equal(Object.hasOwn(result, key), false);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.deepEqual(result.kept, { target: true, source: true });
  }

  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});
