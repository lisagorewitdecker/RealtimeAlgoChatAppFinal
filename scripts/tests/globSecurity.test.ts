import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const configRequire = createRequire(expoRequire.resolve("@expo/config"));
const { glob, globSync } = configRequire("glob");

test("glob retains synchronous and asynchronous pattern expansion", async () => {
  const pattern = "scripts/tests/{deepmerge,minimatch}Security.test.ts";
  const expected = [
    "scripts/tests/deepmergeSecurity.test.ts",
    "scripts/tests/minimatchSecurity.test.ts",
  ];
  assert.deepEqual(globSync(pattern).sort(), expected);
  assert.deepEqual((await glob(pattern)).sort(), expected);
});

test("glob respects cancellation in synchronous and asynchronous walks", async () => {
  const reason = new Error("cancelled");
  const options = { signal: AbortSignal.abort(reason) };
  assert.throws(
    () => globSync("**/*", options),
    (error) => error === reason,
  );
  await assert.rejects(glob("**/*", options), (error) => error === reason);
});
