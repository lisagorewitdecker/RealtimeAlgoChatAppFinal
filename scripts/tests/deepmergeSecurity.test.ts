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
const expoCliRequire = createRequire(chatAppRequire.resolve("@expo/cli"));
const expoConfigRequire = createRequire(
  expoCliRequire.resolve("@expo/config"),
);
const deepmerge = expoConfigRequire("deepmerge");

test("merging __proto__ properties cannot poison the result prototype", () => {
  const source = JSON.parse('{"__proto__":{"polluted":true}}');
  const target = Object.create(null);
  const fromSource = deepmerge(target, source);

  assert.equal(Object.getPrototypeOf(fromSource), Object.prototype);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(fromSource, "__proto__")?.value,
    { polluted: true },
  );

  const fromTarget = deepmerge(source, {});
  assert.equal(Object.getPrototypeOf(fromTarget), Object.prototype);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(fromTarget, "__proto__")?.value,
    { polluted: true },
  );
});
