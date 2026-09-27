import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Decides once, before any suite loads, whether this run may go without a
    // database: it fails the run where one is expected but not configured,
    // and prints what was left out where DATABASE_TESTS=skip says none is.
    globalSetup: ["./src/testing/databaseTestRequirement.ts"],
  },
  resolve: {
    // Support the "workspace" custom condition used by workspace packages.
    conditions: ["workspace", "node", "import", "require"],
  },
});
