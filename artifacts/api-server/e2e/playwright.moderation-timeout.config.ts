import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: /moderation-timeout\.spec\.ts/,
  // Decides once, before the spec file loads, whether this run can reach the
  // settings its account fixture needs, and fails the run naming the ones it
  // cannot. Its verifier starts this run deliberately, so the waiver other
  // suites honour does not apply here; see moderation-timeout.requirement.ts.
  globalSetup: "./moderation-timeout.requirement.ts",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: [["json", { outputFile: process.env.MODERATION_TIMEOUT_REPORT ?? join(tmpdir(), "moderation-timeout-unconfigured.json") }]],
  // Failure output stays outside the repository and does not outlive the run.
  // The environment does not get to choose this directory: a path taken from
  // there can name any place at all, this working copy included.
  outputDir: join(tmpdir(), `moderation-timeout-playwright-${process.pid}`),
  preserveOutput: "never",
  use: { screenshot: "off", trace: "off", video: "off" },
});
