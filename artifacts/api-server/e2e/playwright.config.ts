import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BANNED_ROOM_SUITE,
  browserTestWaiver,
} from "@workspace/browser-test-requirements";

// A waived run reaches nothing outside itself. Leaving the suite out has to
// mean leaving out the step that asks Clerk for a testing token too, or a run
// that was told not to check anything could still fail on a Clerk outage.
const { waived } = browserTestWaiver(BANNED_ROOM_SUITE);

export default defineConfig({
  testDir: ".",
  testMatch: /banned-room\.spec\.ts/,
  // Decides once, before any spec file loads, whether this run may go without
  // the settings these browser checks need: it fails the run where they are
  // expected but absent, and prints what was left out where BROWSER_TESTS=skip
  // says none are expected here.
  globalSetup: "./banned-room.requirement.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // A failure snapshot copies the page as it stands, sign-in form included, so
  // it can hold a typed password. Keep that outside the repository and drop it
  // once the run ends, the way the moderation suite already does.
  outputDir: join(tmpdir(), `banned-room-playwright-${process.pid}`),
  preserveOutput: "never",
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
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
      },
      dependencies: waived ? [] : ["setup"],
    },
  ],
});
