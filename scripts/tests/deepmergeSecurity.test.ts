import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoCliRequire = createRequire(chatAppRequire.resolve("@expo/cli"));
const expoConfigRequire = createRequire(expoCliRequire.resolve("@expo/config"));
const deepmerge = expoConfigRequire("deepmerge");

test("deepmerge does not allow __proto__ to poison merged object prototypes", () => {
  const target = Object.create(null);
  const source = JSON.parse(
    '{"safe":"value","__proto__":{"polluted":true}}',
  ) as Record<string, unknown>;
  const merged = deepmerge(target, source);

  assert.equal(merged.safe, "value");
  assert.equal(merged.polluted, undefined);
  assert.equal(Object.hasOwn(merged, "__proto__"), false);
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
});
