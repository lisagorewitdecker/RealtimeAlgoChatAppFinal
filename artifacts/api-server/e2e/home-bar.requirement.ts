import {
  announceBrowserTests,
  HOME_BAR_SUITE,
} from "@workspace/browser-test-requirements";

/**
 * Playwright `globalSetup` for the home-bar clearance browser suite.
 *
 * It runs once, in the run's own process, before Playwright loads
 * `home-bar-clearance.spec.ts`. That suite serves both documents from the
 * run itself, so there is no setting here that could be missing and nothing
 * it can fail on: what it prints is that the checks are really being made,
 * or -- where the waiver says none are expected here -- what leaving them
 * out costs.
 */
export default function setup(): void {
  announceBrowserTests(HOME_BAR_SUITE);
}
