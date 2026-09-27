import {
  announceBrowserTests,
  browserTestWaiver,
  LAUNCH_SMOKE_SUITE,
} from "@workspace/browser-test-requirements";

/**
 * A setting that is present but is not a plain HTTP(S) origin fails for the
 * same reason a missing one does: the run would otherwise fail somewhere
 * inside a case and read as a broken product rather than a broken setting.
 * A URL carrying credentials is refused instead of being handed to a browser
 * context, where it would end up in a report.
 *
 * The value is handed in beside the name rather than read from the name,
 * because this module is one of the files checkBrowserTestRequirements reads
 * for what this run takes out of the environment, and a setting reached as
 * `process.env[name]` has no name until the run is already going.
 */
function requireRoutedUrl(name: string, value: string | undefined): void {
  try {
    const url = new URL(value!);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(`[launch-smoke] ${name} must be a valid HTTP(S) URL.`);
  }
}

/**
 * Playwright `globalSetup` for the launch smoke check run before publishing.
 *
 * It runs once, in the run's own process, before Playwright loads
 * `launch-smoke.spec.ts`: the run either fails here naming the settings it is
 * missing, or prints what a deliberately waived run is leaving out. The URLs
 * are only inspected for a run that is going ahead; a waived one is not using
 * them.
 */
export default function setup(): void {
  announceBrowserTests(LAUNCH_SMOKE_SUITE);
  if (browserTestWaiver(LAUNCH_SMOKE_SUITE).waived) return;
  requireRoutedUrl("E2E_CHAT_URL", process.env.E2E_CHAT_URL);
  requireRoutedUrl("E2E_API_URL", process.env.E2E_API_URL);
}
