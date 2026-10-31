import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const expoConfigRequire = createRequire(
  expoRequire.resolve("@expo/config"),
);
const deepmerge = expoConfigRequire("deepmerge");

test("deepmerge does not use own __proto__ keys to poison merged object prototypes", () => {
  const target = JSON.parse('{"__proto__":{"safe":true}}');
  const source = JSON.parse('{"__proto__":{"injected":true},"retained":true}');
  const result = deepmerge(target, source);

  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "injected"), false);
  assert.equal(Object.hasOwn(result, "retained"), true);
});
