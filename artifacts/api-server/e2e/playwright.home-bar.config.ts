import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: /home-bar-clearance\.spec\.ts/,
  // Says once, before the spec file loads, whether this run is really making
  // these checks. They need no settings, so the only thing it has to report
  // is a run waived with BROWSER_TESTS=skip, which makes none of them.
  globalSetup: "./home-bar.requirement.ts",
  // Nothing here waits on a network: the cases build both documents and
  // answer the page's requests for them from the run's own process.
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // A failure here is a layout one, so a picture of it is worth keeping for
  // as long as the run: the window, with whichever control ended up under
  // the home bar. It holds nothing but a document this run built, and it
  // still goes outside the repository and is dropped at the end, the way
  // every other browser config here writes its output.
  outputDir: join(tmpdir(), `home-bar-playwright-${process.pid}`),
  preserveOutput: "never",
  use: {
    // Chromium in particular: the inset these cases measure against is one
    // its remote-debugging protocol can emulate. The phone-sized window they
    // measure in is declared by the spec file, beside the measurements.
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
});
