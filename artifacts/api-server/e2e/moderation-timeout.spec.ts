import { appendFileSync } from "node:fs";
import { db, userProfilesTable } from "@workspace/db";
// The accounts fixture alone: this case opens no page, and the module that
// does is the one reading the app's URL. Importing it would put `E2E_CHAT_URL`
// among this suite's settings, leaving every run of it announcing a gap that
// is not one.
import { test } from "./moderation-accounts.fixture";

test("a real timeout cleans both disposable accounts", async ({ disposableAccounts }) => {
  const recordPath = process.env.MODERATION_TIMEOUT_RECORD;
  if (!recordPath) throw new Error("Timeout regression must be started by its verifier");

  for (const role of ["non-moderator", "target"] as const) {
    const user = await disposableAccounts.create(role);
    // Persist the returned ID before any database await, so the independent
    // verifier can recover from an assertion failure or a failed insertion.
    appendFileSync(recordPath, `${role}:${user.id}\n`, { mode: 0o600 });
    await db.insert(userProfilesTable).values({
      userId: user.id,
      username: user.username,
    });
    if (role === "non-moderator") {
      // Space non-idempotent development-instance creates. Do not retry a
      // create whose response might have been lost.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  appendFileSync(recordPath, "ready\n");
  // The 90-second fixture cleanup budget is independent of this test timeout.
  // An unresolved promise triggers Playwright's actual timeout machinery.
  test.setTimeout(1_000);
  await new Promise<void>(() => {});
});