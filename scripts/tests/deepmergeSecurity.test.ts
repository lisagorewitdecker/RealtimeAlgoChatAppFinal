import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const configRequire = createRequire(expoRequire.resolve("@expo/config"));
const deepmerge = configRequire("deepmerge");

test("deepmerge does not poison the prototype with a null-prototype target", () => {
  const source = Object.create(null);
  Object.defineProperty(source, "__proto__", {
    value: { compromised: true },
    enumerable: true,
  });
  source.safe = "value";

  const result = deepmerge(Object.create(null), source);

  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "__proto__"), false);
  assert.equal(result.safe, "value");
  assert.equal(({} as { compromised?: boolean }).compromised, undefined);
});
