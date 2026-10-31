import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const configRequire = createRequire(expoRequire.resolve("@expo/config"));
const packageDir = dirname(configRequire.resolve("deepmerge/package.json"));

for (const entry of ["dist/cjs.js", "dist/umd.js"]) {
  const merge = configRequire(resolve(packageDir, entry));

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
