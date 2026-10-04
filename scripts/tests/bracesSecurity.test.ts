import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const apiServerRequire = createRequire(
  resolve(process.cwd(), "artifacts/api-server/package.json"),
);
const proxyMiddlewareRequire = createRequire(
  apiServerRequire.resolve("http-proxy-middleware"),
);
const micromatchRequire = createRequire(
  proxyMiddlewareRequire.resolve("micromatch"),
);
const braces = micromatchRequire("braces") as (pattern: string) => string[];

test("braces rejects patterns exceeding its recursion depth limit", () => {
  const patterns = [
    "{".repeat(101) + "x" + "}".repeat(101),
    "(".repeat(101) + "x" + ")".repeat(101),
  ];

  for (const pattern of patterns) {
    assert.throws(() => braces(pattern), /maximum nesting depth/);
  }
});

test("braces continues compiling ordinary patterns", () => {
  assert.doesNotThrow(() => braces("src/{app,lib}/index.ts"));
});
