import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

const apiRequire = createRequire(
  resolve(process.cwd(), "artifacts/api-server/package.json"),
);
const expressRequire = createRequire(apiRequire.resolve("express"));
const bodyParser = expressRequire("body-parser");
const specRequire = createRequire(
  resolve(process.cwd(), "lib/api-spec/package.json"),
);
const orvalRequire = createRequire(specRequire.resolve("orval"));
const ajvRequire = createRequire(orvalRequire.resolve("ajv"));
const uri = ajvRequire("fast-uri");

test("URI normalization cannot turn percent-encoded schemes into executable URLs", () => {
  for (const input of ["%6Aavascript:alert(1)", "%u006Aavascript:alert(1)"]) {
    assert.notEqual(uri.parse(input).scheme, "javascript");
    assert.notEqual(uri.normalize(input), "javascript:alert(1)");
    assert.throws(
      () => uri.resolve("https://example.test/", input),
      /URI scheme is malformed/,
    );
  }
  assert.equal(
    uri.equal("%68ttp://example.test/", "http://example.test/"),
    false,
  );
  assert.equal(uri.normalize("https://example.test/"), "https://example.test/");
});

test(
  "compressed request bodies with trailing bytes do not crash the server",
  { timeout: 10000 },
  async (t) => {
    const parse = bodyParser.json();
    const server = createServer((req, res) => {
      parse(req, res, (error: { status?: number } | undefined) => {
        res.statusCode = error ? (error.status ?? 500) : 200;
        res.end();
      });
    });
    t.after(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const send = (body: Buffer) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
              "content-length": body.length,
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end(body);
      });

    const body = gzipSync('{"message":"hello"}');
    const status = await send(
      Buffer.concat([body, Buffer.from("trailing bytes")]),
    );
    assert.ok(status === 200 || status === 400);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await send(body), 200);
  },
);
