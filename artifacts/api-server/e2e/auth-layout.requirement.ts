import {
  announceBrowserTests,
  AUTH_LAYOUT_SUITE,
} from "@workspace/browser-test-requirements";

/**
 * Playwright `globalSetup` for the sign-in layout browser suite.
 *
 * It runs once, in the run's own process, before Playwright loads
 * `auth-layout-visual.spec.ts`: the run either fails here naming the settings
 * it is missing, or prints what a deliberately waived run is leaving out.
 */
export default function setup(): void {
  announceBrowserTests(AUTH_LAYOUT_SUITE);
}
