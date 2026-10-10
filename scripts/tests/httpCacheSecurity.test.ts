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

test("max-stale cannot override shared-cache reuse restrictions", () => {
  const request = {
    method: "GET",
    url: "https://example.test/private",
    headers: { host: "example.test" },
  };
  const staleRequest = {
    ...request,
    headers: { ...request.headers, "cache-control": "max-stale=1000" },
  };
  const restrictedResponses = [
    {
      headers: {
        "cache-control": "public, max-age=600",
        "set-cookie": "session=alice",
      },
    },
    { headers: { "cache-control": "public, max-age=600, proxy-revalidate" } },
    { headers: { "cache-control": "public, max-age=600, no-cache" } },
    { headers: { "cache-control": "public, max-age=600, must-revalidate" } },
    { headers: { "cache-control": "public, max-age=600, no-store" } },
  ];

  for (const response of restrictedResponses) {
    const policy = new CachePolicy(
      request,
      { status: 200, ...response },
      { shared: true },
    );

    assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), false);
  }
});

test("max-stale still permits ordinary stale shared responses", () => {
  const request = {
    method: "GET",
    url: "https://example.test/public",
    headers: { host: "example.test" },
  };
  const policy = new CachePolicy(
    request,
    {
      status: 200,
      headers: { "cache-control": "public, max-age=0" },
    },
    { shared: true },
  );
  const staleRequest = {
    ...request,
    headers: { ...request.headers, "cache-control": "max-stale=1000" },
  };

  assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), true);
});
