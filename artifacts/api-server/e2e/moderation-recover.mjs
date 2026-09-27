import { createClerkClient } from "@clerk/backend";
import { createRequire } from "node:module";
import { MODERATION_RECOVERY_COMMAND, requireCommandSettings } from "@workspace/browser-test-requirements";
import { assertDevelopment, RecoveryJournal, recoverDisposables } from "./moderation-recovery.mjs";

// Explicit development-only command. No raw provider/database errors are logged.
// What this cannot run without is declared with the browser suites' settings,
// and named here before anything is opened or deleted: a missing one would
// otherwise throw partway through and be reported below as a failed recovery.
if (requireCommandSettings(MODERATION_RECOVERY_COMMAND)) await recover();
else process.exitCode = 1;

async function recover() {
  let pool;
  try {
    assertDevelopment(process.env);
    if (!process.env.DATABASE_URL?.trim()) throw Error("Development database is required");
    const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
    const removed = await recoverDisposables({
      journal: new RecoveryJournal(),
      users: client.users,
      env: process.env,
      deleteAccountRows: async (id) => {
        await pool.query("DELETE FROM user_profiles WHERE user_id = $1", [id]);
        // An interrupted run can leave a granted moderator row behind.
        await pool.query("DELETE FROM moderators WHERE user_id = $1", [id]);
        // Recorded and seeded history rows naming this disposable account.
        await pool.query("DELETE FROM moderation_actions WHERE target_user_id = $1 OR actor_user_id = $1", [id]);
      },
    });
    console.log(`[moderation-recovery] Removed ${removed} proven disposable accounts and their database rows`);
  } catch {
    console.error("[moderation-recovery] Recovery failed; records retained for retry; provider details omitted");
    process.exitCode = 1;
  } finally {
    await pool?.end().catch(() => { process.exitCode = 1; });
  }
}
