import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserTestWaiver,
  LAUNCH_SMOKE_SUITE,
} from "@workspace/browser-test-requirements";

// A waived run reaches nothing outside itself. Leaving the suite out has to
// mean leaving out the step that asks Clerk for a testing token too, or a run
// that was told not to check anything could still fail on a Clerk outage.
const { waived } = browserTestWaiver(LAUNCH_SMOKE_SUITE);

export default defineConfig({
  testDir: ".",
  testMatch: /launch-smoke\.spec\.ts/,
  // Decides once, before any spec file loads, whether this run may go without
  // the settings this check signs in with: it fails the run where they are
  // expected but absent or not routed URLs, and prints what was left out
  // where BROWSER_TESTS=skip says none are expected here. The decision is
  // made there rather than here because this module is evaluated again in
  // every worker process.
  globalSetup: "./launch-smoke.requirement.ts",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: join(tmpdir(), `launch-smoke-playwright-${process.pid}`),
  preserveOutput: "never",
  projects: [
    ...(waived
      ? []
      : [
          {
            name: "setup",
            testMatch: /global\.setup\.ts/,
          },
        ]),
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env["E2E_CHAT_URL"],
        actionTimeout: 15_000,
        navigationTimeout: 45_000,
        screenshot: "off",
        trace: "off",
        video: "off",
      },
      dependencies: waived ? [] : ["setup"],
    },
  ],
});