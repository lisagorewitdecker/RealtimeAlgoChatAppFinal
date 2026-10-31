import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const configRequire = createRequire(expoRequire.resolve("@expo/config"));
const deepmergePath = configRequire.resolve("deepmerge");

for (const entry of ["cjs.js", "umd.js"]) {
  const deepmerge = configRequire(resolve(deepmergePath, "..", entry));

  test(`deepmerge ${entry} rejects prototype poisoning from targets and sources`, () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    for (const [target, source] of [
      [payload, {}],
      [Object.create(null), payload],
      [payload, payload],
      [{ nested: payload }, { nested: { other: 2 } }],
      [[], [payload]],
    ]) {
      const result = deepmerge(target, source);
      const objects = Array.isArray(result) ? result : [result, result.nested];
      for (const object of objects.filter(Boolean)) {
        assert.equal(Object.getPrototypeOf(object), Object.prototype);
        assert.equal(object.polluted, undefined);
        assert.equal(Object.hasOwn(object, "__proto__"), false);
      }
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test(`deepmerge ${entry} preserves ordinary merge behavior`, () => {
    const symbol = Symbol("setting");
    const target = { nested: { a: 1 }, list: [1], [symbol]: { a: 1 } };
    const source = { nested: { b: 2 }, list: [2], [symbol]: { b: 2 } };
    const expected = {
      nested: { a: 1, b: 2 },
      list: [1, 2],
      [symbol]: { a: 1, b: 2 },
    };
    assert.deepEqual(deepmerge(target, source), expected);
    assert.deepEqual(deepmerge.all([target, source]), expected);
    assert.deepEqual(target.nested, { a: 1 });
    assert.deepEqual(source.nested, { b: 2 });
    assert.deepEqual(
      deepmerge(
        { list: [1] },
        { list: [2] },
        { arrayMerge: (_: unknown, s: unknown) => s },
      ),
      { list: [2] },
    );
  });
}
