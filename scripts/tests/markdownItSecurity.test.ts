import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const apiSpecRequire = createRequire(
  resolve(process.cwd(), "lib/api-spec/package.json"),
);
const orvalRequire = createRequire(apiSpecRequire.resolve("orval"));
let typedocPath: string | undefined;
try {
  typedocPath = orvalRequire.resolve("typedoc");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error;
}
const typedocRequire = typedocPath ? createRequire(typedocPath) : undefined;
const markdownItPath = typedocRequire?.resolve("markdown-it");
const MarkdownIt = typedocRequire?.("markdown-it");
const options = {
  skip: typedocRequire
    ? false
    : "Orval's optional TypeDoc peer is not installed",
};

test("markdown-it preserves ordinary smartquote rendering", options, () => {
  const md = new MarkdownIt({ typographer: true });

  assert.equal(
    md.render(`"hello" and 'world'`),
    "<p>“hello” and ‘world’</p>\n",
  );
});

for (const [opening, closing] of [
  ['"a ', "b' "],
  ["'a ", 'b" '],
]) {
  test(
    `markdown-it handles unmatched ${closing.trim()} quotes without excessive CPU use`,
    options,
    () => {
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          `
          const assert = require("node:assert/strict");
          const md = require(process.argv[1])({ typographer: true });
          const input = process.argv[2].repeat(200000) +
            process.argv[3].repeat(200000);
          const output = md.render(input);
          assert.ok(output.startsWith("<p>"));
          assert.ok(output.endsWith("</p>\\n"));
        `,
          markdownItPath!,
          opening,
          closing,
        ],
        { encoding: "utf8", timeout: 15000 },
      );

      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    },
  );
}
