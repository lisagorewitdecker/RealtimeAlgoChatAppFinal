import {
  announceBrowserTests,
  BROWSER_TESTS_ENV_VAR,
  BROWSER_TESTS_REQUIRED,
  MODERATION_TIMEOUT_SUITE,
} from "@workspace/browser-test-requirements";

/**
 * Playwright `globalSetup` for the moderation timeout cleanup regression.
 *
 * It runs once, in the run's own process, before Playwright loads
 * `moderation-timeout.spec.ts`, and fails the run naming any setting the
 * case's account fixture cannot do without.
 *
 * The waiver is deliberately not read here, and this is the one suite that
 * does not read it. This run is never part of a repository-wide one:
 * `moderation-timeout.verify.mjs` starts it by hand, after checking these
 * same settings and contacting the provider itself, and passes down the
 * record path without which the case refuses to run at all. Reading the
 * waiver here would only announce a skip for a run that is going ahead
 * anyway, which is the kind of disagreement the announcement exists to
 * prevent.
 */
export default function setup(): void {
  announceBrowserTests(MODERATION_TIMEOUT_SUITE, {
    ...process.env,
    [BROWSER_TESTS_ENV_VAR]: BROWSER_TESTS_REQUIRED,
  });
}
