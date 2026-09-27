/**
 * How often a screen that gates on the moderator role re-reads it while the
 * screen stays in view.
 *
 * A grant or a revocation normally arrives on the chat connection the app
 * already holds, and is applied the moment it lands; a connection that drops
 * re-reads the role as soon as it is back. This interval is only the last
 * safety net under those two, for a change that somehow reached neither, so
 * it is long: every member sitting in a room would otherwise pay for it.
 *
 * It lives apart from the app context so that tests which replace the
 * context still get the real interval.
 */
export const ROLE_RECHECK_INTERVAL_MS = 5 * 60_000;
