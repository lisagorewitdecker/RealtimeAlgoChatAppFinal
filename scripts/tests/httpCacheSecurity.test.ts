import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const ngrokRequire = createRequire(chatAppRequire.resolve("@expo/ngrok"));
const gotRequire = createRequire(ngrokRequire.resolve("got"));
const cacheableRequestRequire = createRequire(
  gotRequire.resolve("cacheable-request"),
);
const CachePolicy = cacheableRequestRequire("http-cache-semantics");

test("stale cache hits never reuse responses with wildcard Vary", () => {
  const request = {
    method: "GET",
    url: "https://example.test/private",
    headers: { host: "example.test", accept: "text/html" },
  };
  const policy = new CachePolicy(
    request,
    {
      status: 200,
      headers: {
        "cache-control": "public, max-age=0",
        vary: "accept, *",
      },
    },
    { shared: true },
  );
  const staleRequest = {
    ...request,
    headers: { ...request.headers, "cache-control": "max-stale=1000" },
  };

  assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), false);
});
