import {
  announceBrowserTests,
  BANNED_ROOM_SUITE,
} from "@workspace/browser-test-requirements";

/**
 * Playwright `globalSetup` for the banned-room browser suite.
 *
 * It runs once, in the run's own process, before Playwright loads
 * `banned-room.spec.ts`: the run either fails here naming the settings it is
 * missing, or prints what a deliberately waived run is leaving out.
 */
export default function setup(): void {
  announceBrowserTests(BANNED_ROOM_SUITE);
}
