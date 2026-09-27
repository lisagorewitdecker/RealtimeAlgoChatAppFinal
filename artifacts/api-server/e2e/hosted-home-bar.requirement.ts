import {
  announceBrowserTests,
  HOSTED_HOME_BAR_SUITE,
} from "@workspace/browser-test-requirements";

/**
 * Playwright `globalSetup` for the hosted sandbox home-bar browser suite.
 *
 * It runs once, in the run's own process, before Playwright loads
 * `hosted-home-bar.spec.ts`: the run either fails here naming the settings it
 * is missing -- the app to open, the provider to sign in through, and the
 * account to sign in as -- or prints what a deliberately waived run is
 * leaving out.
 */
export default function setup(): void {
  announceBrowserTests(HOSTED_HOME_BAR_SUITE);
}
