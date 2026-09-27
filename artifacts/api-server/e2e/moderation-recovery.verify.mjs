import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createClerkClient } from "@clerk/backend";
import { MODERATION_RECOVERY_LIVE_COMMAND, requireCommandSettings } from "@workspace/browser-test-requirements";
import { assertDevelopment, RecoveryJournal, newIntent, ownership, recoverDisposables } from "./moderation-recovery.mjs";

const client = () => createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

// The child deliberately never journals Clerk's response. The parent kills it
// only after Clerk has accepted the create, at the lost-response boundary.
if (process.argv.includes("--create-worker")) {
  process.once("message", async (intent) => {
    try {
      assertDevelopment(process.env);
      if (process.env.MODERATION_RECOVERY_LIVE !== "1") throw Error();
      await client().users.createUser({
        emailAddress: [intent.email],
        password: `E2e-${randomUUID()}!9`,
        firstName: "Recovery disposable",
        lastName: "E2E",
        skipLegalChecks: true,
        privateMetadata: { moderationDisposable: ownership(intent) },
      });
      process.send({ ready: true });
      setInterval(() => {}, 1000);
    } catch {
      process.send({ failed: true });
      process.exitCode = 1;
      process.disconnect();
    }
  });
} else if (requireCommandSettings(MODERATION_RECOVERY_LIVE_COMMAND)) {
  await run();
} else {
  // Checked once, here: the worker above is forked with this environment, and
  // a refusal inside it would surface as the interruption boundary never being
  // reached rather than as a setting to set.
  process.exitCode = 1;
}

async function interruptCreate(intent) {
  await new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ["--create-worker"], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let ready = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("message", (message) => {
      if (message?.ready === true) ready = true;
      child.kill("SIGKILL");
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error("Worker failed"));
    });
    child.once("exit", (_code, signal) => {
      clearTimeout(timer);
      if (ready && signal === "SIGKILL") resolve();
      else reject(Error("Worker did not reach the interruption boundary"));
    });
    child.send(intent);
  });
}

async function run() {
  let phase = "development opt-in preflight";
  let pool;
  let clerk;
  let journal;
  let intent;
  let baseline;
  let failed = false;
  let passed = false;
  const moderators = [];
  try {
    if (process.env.MODERATION_RECOVERY_LIVE !== "1") throw Error();
    assertDevelopment(process.env);
    if (!process.env.DATABASE_URL?.trim()) throw Error();
    const emails = [process.env.E2E_MODERATOR_EMAIL, process.env.E2E_MODERATOR_EMAIL_2]
      .map((email) => email.trim().toLowerCase());
    if (new Set(emails).size !== 2) throw Error();
    const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Do not allow asynchronous pg errors to emit raw connection details.
    pool.on("error", () => { failed = true; });
    clerk = client();
    phase = "moderator baseline";
    for (const email of emails) {
      const result = await clerk.users.getUserList({ emailAddress: [email], limit: 100 });
      assert.equal(result.totalCount, 1);
      assert.equal(result.data.length, 1);
      const account = result.data[0];
      assert.ok(account.emailAddresses.some((address) =>
        address.id === account.primaryEmailAddressId && address.emailAddress.toLowerCase() === email));
      moderators.push(account.id);
    }
    assert.equal(new Set(moderators).size, 2);
    baseline = await snapshot(clerk, pool, moderators);

    phase = "persisted create intent";
    intent = newIntent(randomUUID(), "target");
    const store = new RecoveryJournal();
    // Leave failed evidence in the normal persistent journal for the guarded
    // recovery command, but never sweep any other run from this verifier.
    journal = {
      records: () => new RecoveryJournal(store.directory).records().filter((r) => r.token === intent.token),
      save: (record) => store.save(record),
      remove: (record) => store.remove(record),
    };
    journal.save(intent);
    phase = "interrupted Clerk create";
    await interruptCreate(intent);
    assert.equal(journal.records().length, 1);
    assert.equal(journal.records()[0].id, undefined);

    phase = "exact-email reconciliation and persisted metadata";
    const result = await clerk.users.getUserList({ emailAddress: [intent.email], limit: 100 });
    assert.equal(result.totalCount, 1);
    assert.equal(result.data.length, 1);
    const disposable = await clerk.users.getUser(result.data[0].id);
    assert.deepEqual(disposable.emailAddresses.map((e) => e.emailAddress), [intent.email]);
    assert.deepEqual(disposable.privateMetadata.moderationDisposable, ownership(intent));
    assert.ok(Math.abs(disposable.createdAt - intent.createdAt) <= 10 * 60 * 1000);
    assert.ok(!moderators.includes(disposable.id));
    assert.ok(!(process.env.ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim()).includes(disposable.id));

    phase = "disposable profile creation";
    await pool.query("INSERT INTO user_profiles (user_id, username) VALUES ($1, $2)",
      [disposable.id, `Recovery ${intent.token}`]);
    const profileBefore = await profile(pool, disposable.id);
    assert.notEqual(profileBefore, null);
    // The environment is named at each call rather than kept here, so what
    // this hands to the recovery sweep stays readable to the check holding
    // this command to its declared settings.
    const options = {
      journal, users: clerk.users,
      deleteAccountRows: (id) => deleteDisposableRows(pool, id),
    };
    phase = "recent abandoned-run age guard";
    assert.equal(await recoverDisposables({ ...options, env: process.env }), 0);
    assert.equal((await clerk.users.getUser(disposable.id)).id, disposable.id);
    assert.equal(await profile(pool, disposable.id), profileBefore);
    assert.equal(journal.records()[0].id, undefined);

    phase = "current-run recovery";
    // Use the existing teardown exception for this verifier's own run. Never
    // backdate provider metadata or advance the recovery clock to bypass age.
    assert.equal(await recoverDisposables({ ...options, env: process.env, currentRun: intent.runId }), 1);
    phase = "Clerk and profile absence";
    await assert.rejects(clerk.users.getUser(disposable.id), (error) => error?.status === 404);
    assert.equal(await profile(pool, disposable.id), null);
    assert.equal(journal.records().length, 0);
    assert.equal(await recoverDisposables({ ...options, env: process.env, currentRun: intent.runId }), 0);
    passed = true;
  } catch {
    failed = true;
    console.error(`[moderation-recovery-live] ${phase} failed; credentials and provider details omitted`);
  } finally {
    if (journal && intent) {
      try {
        await recoverDisposables({
          journal, users: clerk.users, env: process.env, currentRun: intent.runId,
          deleteAccountRows: (id) => deleteDisposableRows(pool, id),
        });
        if (journal.records().length) throw Error();
      } catch {
        failed = true;
        console.error("[moderation-recovery-live] Cleanup incomplete; ownership journal retained for guarded retry");
      }
    }
    if (baseline) {
      try { assert.deepEqual(await snapshot(clerk, pool, moderators), baseline); }
      catch {
        failed = true;
        console.error("[moderation-recovery-live] Moderator preservation check failed; details omitted");
      }
    }
    await pool?.end().catch(() => { failed = true; });
  }
  if (failed) process.exitCode = 1;
  else if (passed) console.log("[moderation-recovery-live] PASS: interrupted create; persisted metadata; exact-email recovery; recent-run guard; Clerk user 404; matching profile absent; idempotent retry; 2 moderator account/profile snapshots unchanged");
}

// Every row a disposable account can own, in the same order the browser
// fixture removes them.
async function deleteDisposableRows(pool, id) {
  await pool.query("DELETE FROM user_profiles WHERE user_id = $1", [id]);
  await pool.query("DELETE FROM moderators WHERE user_id = $1", [id]);
  await pool.query("DELETE FROM moderation_actions WHERE target_user_id = $1 OR actor_user_id = $1", [id]);
}

async function profile(pool, id) {
  const result = await pool.query("SELECT row_to_json(p)::text AS snapshot FROM user_profiles p WHERE user_id = $1", [id]);
  assert.ok(result.rowCount <= 1);
  return result.rows[0]?.snapshot ?? null;
}

async function snapshot(clerk, pool, ids) {
  return Promise.all(ids.map(async (id) => ({
    account: JSON.stringify(await clerk.users.getUser(id)),
    profile: await profile(pool, id),
  })));
}