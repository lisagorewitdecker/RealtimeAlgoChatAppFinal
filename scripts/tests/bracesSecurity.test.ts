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
const bracesApi = micromatchRequire("braces") as {
  compile: (input: AstNode) => string;
  expand: (input: AstNode) => string[];
};

type AstNode = {
  type: string;
  nodes?: AstNode[];
  parent?: AstNode;
  value?: string;
};

const createNestedAst = (depth: number): AstNode => {
  const root: AstNode = { type: "root", nodes: [] };
  let parent = root;

  for (let index = 0; index < depth; index += 1) {
    const child: AstNode = { type: "paren", nodes: [], parent };
    parent.nodes!.push(child);
    parent = child;
  }

  parent.nodes!.push({ type: "text", value: "x", parent });
  return root;
};

test("braces rejects patterns exceeding its recursion depth limit", () => {
  const patterns = [
    "{".repeat(101) + "x" + "}".repeat(101),
    "(".repeat(101) + "x" + ")".repeat(101),
  ];

  for (const pattern of patterns) {
    assert.throws(() => braces(pattern), /maximum nesting depth/);
  }
});

test("braces compile and expand reject deeply nested ASTs", () => {
  const ast = createNestedAst(101);

  assert.throws(() => bracesApi.compile(ast), /maximum nesting depth/);
  assert.throws(() => bracesApi.expand(ast), /maximum nesting depth/);
});

test("braces continues compiling ordinary patterns", () => {
  assert.doesNotThrow(() => braces("src/{app,lib}/index.ts"));
});
