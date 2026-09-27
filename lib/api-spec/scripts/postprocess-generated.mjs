import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const generatedFiles = [
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-client-react/src/generated/api.ts",
  "lib/api-zod/src/generated/api.ts",
];

for (const relativePath of generatedFiles) {
  const filePath = new URL(`../../../${relativePath}`, import.meta.url);
  let content = await readFile(filePath, "utf8");

  if (relativePath === "lib/api-zod/src/generated/api.ts") {
    content = content.replace(
      "import * as zod from 'zod';",
      "import * as zod from 'zod/v4';",
    );
  }

  await writeFile(filePath, `${content.trimEnd()}\n`);
}

console.log(`Post-processed generated API files in ${workspaceRoot}`);