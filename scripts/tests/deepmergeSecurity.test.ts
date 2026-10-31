import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
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
