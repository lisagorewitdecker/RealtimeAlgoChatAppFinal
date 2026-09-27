import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: /auth-layout-visual\.spec\.ts/,
  // Decides once, before any spec file loads, whether this run may go without
  // the settings these browser checks need: it fails the run where they are
  // expected but absent, and prints what was left out where BROWSER_TESTS=skip
  // says none are expected here.
  globalSetup: "./auth-layout.requirement.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // A failure snapshot copies the page as it stands, sign-in form included, so
  // it can hold whatever was typed there. Keep that outside the repository and
  // drop it once the run ends, the way the other browser configs already do.
  outputDir: join(tmpdir(), `auth-layout-playwright-${process.pid}`),
  preserveOutput: "never",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env["E2E_CHAT_URL"],
    viewport: { width: 375, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
