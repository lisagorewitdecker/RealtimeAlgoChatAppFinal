import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const configRequire = createRequire(expoRequire.resolve("@expo/config"));
const deepmerge = configRequire("deepmerge") as (
  target: object,
  source: object,
) => Record<string, unknown>;

test("deepmerge does not copy prototype-polluting keys", () => {
  const dangerousProperties = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}',
  ) as Record<string, unknown>;
  const target = Object.assign(Object.create(null), dangerousProperties);
  const merged = deepmerge(target, dangerousProperties);

  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(Object.hasOwn(merged, "__proto__"), false);
  assert.equal(Object.hasOwn(merged, "constructor"), false);
  assert.equal(Object.hasOwn(merged, "prototype"), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
