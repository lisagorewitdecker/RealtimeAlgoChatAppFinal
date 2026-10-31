import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { dirname, resolve } from "node:path";
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
const packageDir = dirname(configRequire.resolve("deepmerge/package.json"));

for (const entry of ["dist/cjs.js", "dist/umd.js"]) {
  const merge = configRequire(resolve(packageDir, entry));

  test(`deepmerge ${entry} ignores prototype-sensitive keys from targets and sources`, () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const target = JSON.parse(
        `{"${key}":{"polluted":true},"kept":{"target":true}}`,
      );
      const source = JSON.parse(
        `{"${key}":{"polluted":true},"kept":{"source":true}}`,
      );
      const result = merge(target, source);
      assert.equal(Object.hasOwn(result, key), false);
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.deepEqual(result.kept, { target: true, source: true });
    }
  });

  test(`deepmerge ${entry} rejects prototype poisoning from either operand`, () => {
    const payload = JSON.parse('{"__proto__":{"poisoned":true},"safe":1}');
    for (const target of [
      {},
      payload,
      Object.assign(Object.create(null), payload),
    ]) {
      for (const source of [{}, payload]) {
        for (const clone of [true, false]) {
          const result = merge(target, source, { clone });
          assert.equal(Object.getPrototypeOf(result), Object.prototype);
          assert.equal(result.poisoned, undefined);
          assert.equal(Object.hasOwn(result, "__proto__"), false);
        }
      }
    }
    const nested = merge({}, { nested: payload, array: [payload] });
    assert.equal(nested.nested.poisoned, undefined);
    assert.equal(nested.array[0].poisoned, undefined);
    assert.equal(Object.getPrototypeOf(nested.nested), Object.prototype);
    assert.equal(Object.getPrototypeOf(nested.array[0]), Object.prototype);
  });

  test(`deepmerge ${entry} preserves ordinary merges and enumerable symbols`, () => {
    const symbol = Symbol("key");
    assert.deepEqual(
      merge(
        { nested: { left: 1 }, array: [1], [symbol]: { left: 1 } },
        { nested: { right: 2 }, array: [2], [symbol]: { right: 2 } },
      ),
      {
        nested: { left: 1, right: 2 },
        array: [1, 2],
        [symbol]: { left: 1, right: 2 },
      },
    );
    assert.deepEqual(merge.all([{ left: 1 }, { right: 2 }]), {
      left: 1,
      right: 2,
    });
  });
}
const expoCliRequire = createRequire(chatAppRequire.resolve("@expo/cli"));
const expoConfigRequire = createRequire(expoCliRequire.resolve("@expo/config"));
const deepmerge = expoConfigRequire("deepmerge");

test("deepmerge does not use own __proto__ keys to poison merged object prototypes", () => {
  const target = JSON.parse('{"__proto__":{"safe":true}}');
  const source = JSON.parse('{"__proto__":{"injected":true},"retained":true}');
  const result = deepmerge(target, source);

  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "injected"), false);
  assert.equal(Object.hasOwn(result, "retained"), true);
});

test("merging __proto__ properties cannot poison the result prototype", () => {
test("deepmerge used by Expo CLI ignores __proto__ properties safely", () => {
  const source = JSON.parse('{"__proto__":{"polluted":true}}');
  const target = Object.create(null);
  const fromSource = deepmerge(target, source);

  assert.equal(Object.getPrototypeOf(fromSource), Object.prototype);
  assert.equal(Object.hasOwn(fromSource, "__proto__"), false);
  assert.equal(fromSource.polluted, undefined);

  const fromTarget = deepmerge(source, {});
  assert.equal(Object.getPrototypeOf(fromTarget), Object.prototype);
  assert.equal(Object.hasOwn(fromTarget, "__proto__"), false);
  assert.equal(fromTarget.polluted, undefined);
});
