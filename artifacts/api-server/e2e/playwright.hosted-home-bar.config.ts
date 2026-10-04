import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserTestWaiver,
  HOSTED_HOME_BAR_SUITE,
} from "@workspace/browser-test-requirements";

// A waived run reaches nothing outside itself. Leaving the suite out has to
// mean leaving out the step that asks Clerk for a testing token too, or a run
// that was told not to check anything could still fail on a Clerk outage.
const { waived } = browserTestWaiver(HOSTED_HOME_BAR_SUITE);

export default defineConfig({
  testDir: ".",
  testMatch: /hosted-home-bar\.spec\.ts/,
  // Decides once, before the spec file loads, whether this run may go without
  // the settings it signs in with, rather than failing inside the case for a
  // setting nothing said was missing. It is decided there and not here
  // because Playwright evaluates this module again in every worker process.
  globalSetup: "./hosted-home-bar.requirement.ts",
  // The case signs in once and then loads the app twice, each time waiting on
  // a cold Metro bundle and on the server's own document.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // A failure snapshot copies the page as it stands, so it goes outside the
  // repository and is dropped when the run ends, the way every other browser
  // config here writes its output.
  outputDir: join(tmpdir(), `hosted-home-bar-playwright-${process.pid}`),
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
        // Chromium in particular: the two browsers this case compares differ
        // only in whether they report a touch screen, which is what the host
        // screen reads to decide a phone is drawing the page. The window they
        // are given is declared by the spec, beside the measurements.
        ...devices["Desktop Chrome"],
        baseURL: process.env["E2E_CHAT_URL"],
        navigationTimeout: 60_000,
        screenshot: "off",
        trace: "off",
        video: "off",
      },
      dependencies: waived ? [] : ["setup"],
    },
  ],
});
