import { createClerkClient } from "@clerk/backend";
import { MODERATION_TIMEOUT_COMMAND, requireCommandSettings } from "@workspace/browser-test-requirements";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requireFromDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Pool } = requireFromDb("pg");
// What this cannot run without is stated once, as MODERATION_TIMEOUT_COMMAND
// in lib/browser-test-requirements/src/index.ts, beside the settings of the
// Playwright run started below and held to both by
// `pnpm run check:command-requirements`. A run missing one is named here,
// before anything is created.
if (!requireCommandSettings(MODERATION_TIMEOUT_COMMAND)) {
  process.exitCode = 1;
} else if (!process.env.CLERK_SECRET_KEY.startsWith("sk_test_") ||
           !process.env.CLERK_PUBLISHABLE_KEY.startsWith("pk_test_")) {
  console.error("[moderation-timeout] Clerk development keys are required");
  process.exitCode = 1;
} else {
  await run();
}

async function run() {
  let phase = "preflight";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  });
  let directory;
  let moderatorIds = [];
  let ids = [];
  let failure;
  try {
    const emails = [
      process.env.E2E_MODERATOR_EMAIL.trim(),
      process.env.E2E_MODERATOR_EMAIL_2.trim(),
    ];
    // Written out rather than built from the loop's index: a name assembled
    // while this runs is a setting nothing can see it reads.
    const passwords = [
      process.env.E2E_MODERATOR_PASSWORD,
      process.env.E2E_MODERATOR_PASSWORD_2,
    ];
    if (emails[0].toLowerCase() === emails[1].toLowerCase()) throw Error("Moderator accounts must be distinct");
    const snapshots = [];
    const accountSnapshots = [];
    // All external prerequisites are checked before the first disposable create.
    for (let i = 0; i < 2; i++) {
      phase = `moderator ${i + 1} lookup`;
      const response = await clerk.users.getUserList({ emailAddress: [emails[i]] });
      const matches = response.data.filter((user) =>
        user.emailAddresses.some((address) =>
          address.id === user.primaryEmailAddressId &&
          address.emailAddress.toLowerCase() === emails[i].toLowerCase()));
      if (matches.length !== 1) throw Error("Configured moderator not found");
      phase = `moderator ${i + 1} password validation`;
      await clerk.users.verifyPassword({ userId: matches[0].id, password: passwords[i] });
      moderatorIds.push(matches[0].id);
      phase = `moderator ${i + 1} account baseline`;
      const account = await clerk.users.getUser(matches[0].id);
      if (!account.emailAddresses.some((address) =>
        address.id === account.primaryEmailAddressId &&
        address.emailAddress.toLowerCase() === emails[i].toLowerCase())) {
        throw Error("Moderator primary email mismatch");
      }
      accountSnapshots.push(JSON.stringify(account));
      phase = `moderator ${i + 1} profile baseline`;
      const result = await pool.query("SELECT row_to_json(p)::text AS snapshot FROM user_profiles p WHERE user_id = $1", [matches[0].id]);
      if (result.rowCount > 1) throw Error("Unexpected duplicate moderator profile");
      snapshots.push(result.rowCount === 1 ? result.rows[0].snapshot : null);
    }
    if (moderatorIds[0] === moderatorIds[1]) throw Error("Moderator accounts must be distinct");

    phase = "playwright";
    directory = await mkdtemp(join(tmpdir(), "moderation-timeout-"));
    const record = join(directory, "ids");
    const report = join(directory, "report.json");
    const child = await new Promise((resolve, reject) => {
      const proc = spawn(
        process.execPath,
        [join(process.cwd(), "node_modules/@playwright/test/cli.js"), "test", "--config", "e2e/playwright.moderation-timeout.config.ts"],
        {
          cwd: process.cwd(),
          // The whole environment goes to the run, because what that run
          // reads is read in this child process. What it cannot start
          // without is MODERATION_TIMEOUT_SUITE's own list, which the
          // declaration above names as the run it starts, so those settings
          // are required -- and refused -- here rather than in here.
          env: {
            ...process.env,
            MODERATION_TIMEOUT_RECORD: record,
            MODERATION_TIMEOUT_REPORT: report,
            PLAYWRIGHT_BROWSERS_PATH: join(directory, "unused-browsers"),
          },
          stdio: "ignore",
        },
      );
      const timer = setTimeout(() => proc.kill("SIGKILL"), 120_000);
      proc.on("error", (error) => { clearTimeout(timer); reject(error); });
      proc.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });

    // Never print raw reporter content (it can contain provider details).
    phase = "disposable ID record";
    let recordContents;
    try {
      recordContents = await readFile(record, "utf8");
    } catch {
      phase = "Playwright did not create disposable ID record";
      try {
        const diagnostic = JSON.parse(await readFile(report, "utf8"));
        const stats = diagnostic.stats ?? {};
        console.error(`[moderation-timeout] Playwright counts: expected=${Number(stats.expected ?? -1)}, unexpected=${Number(stats.unexpected ?? -1)}, skipped=${Number(stats.skipped ?? -1)}; child exit=${child.code === null ? "signal" : Number(child.code)}`);
        console.error(`[moderation-timeout] Clerk creation failure: ${JSON.stringify(diagnostic).includes("Disposable moderation account creation failed")}`);
      } catch {
        console.error("[moderation-timeout] No Playwright JSON report");
      }
      throw Error("ID record unavailable");
    }
    const lines = recordContents.trim().split("\n");
    // Retain each valid recorded ID even if a later line is malformed, so a
    // failed assertion can still trigger strictly scoped fallback cleanup.
    for (const line of lines) {
      const match = /^(target|non-moderator):(user_[A-Za-z0-9_-]+)$/.exec(line);
      if (match && !moderatorIds.includes(match[2])) ids.push(match[2]);
    }
    phase = "disposable ID record completeness";
    if (lines.length !== 3 ||
        !/^non-moderator:user_[A-Za-z0-9_-]+$/.test(lines[0]) ||
        !/^target:user_[A-Za-z0-9_-]+$/.test(lines[1]) ||
        lines[2] !== "ready" || ids.length !== 2 ||
        new Set(ids).size !== 2) {
      console.error(`[moderation-timeout] Recorded disposable IDs: ${ids.length}; ready marker: ${lines.includes("ready")}`);
      try {
        const diagnostic = JSON.parse(await readFile(report, "utf8"));
        const text = JSON.stringify(diagnostic);
        const category = text.includes("Disposable moderation account creation failed") ? "Clerk creation"
          : text.includes("Moderation cleanup failed") ? "fixture cleanup"
          : text.includes("Test timeout of") ? "test timeout"
          : text.includes("duplicate key value") ? "database conflict"
          : "other Playwright failure";
        console.error(`[moderation-timeout] Failure category: ${category}`);
        console.error(`[moderation-timeout] Duration (ms): ${Number(diagnostic.stats?.duration ?? -1)}`);
      } catch {
        console.error("[moderation-timeout] No Playwright JSON report");
      }
      throw Error("Expected two recorded disposable IDs");
    }
    phase = "Playwright reporter file";
    const json = JSON.parse(await readFile(report, "utf8"));
    const tests = json.suites?.flatMap(function walk(suite) {
      return [...(suite.specs ?? []).flatMap((spec) => spec.tests ?? []), ...(suite.suites ?? []).flatMap(walk)];
    }) ?? [];
    phase = "Playwright timeout result";
    if (child.code !== 1 || child.signal || tests.length !== 1 ||
        json.stats?.expected !== 0 || json.stats?.unexpected !== 1 ||
        json.stats?.skipped !== 0 || json.stats?.flaky !== 0 ||
        tests[0].status !== "unexpected" ||
        tests[0].results?.length !== 1 || tests[0].results[0].status !== "timedOut") {
      throw Error("Playwright did not report exactly one real timed-out test");
    }
    phase = "disposable cleanup verification";
    await verifyGone(clerk, pool, ids);
    phase = "moderator preservation verification";
    await verifyModerators(clerk, pool, moderatorIds, snapshots, accountSnapshots);
    console.log(`[moderation-timeout] 1 actual timeout; 2 Clerk users 404; 2 profiles absent; 2 moderator accounts unchanged; ${snapshots.filter(Boolean).length} existing moderator profile(s) unchanged`);
  } catch {
    failure = Error(`[moderation-timeout] ${phase} failed; credentials and provider details omitted`);
  } finally {
    if (failure && ids.length) {
      // Fallback is restricted to IDs explicitly recorded as disposable and
      // never includes either moderator ID, even on malformed test output.
      const disposable = [...new Set(ids)].filter((id) => !moderatorIds.includes(id));
      try {
        for (const id of disposable) {
          await retry(async () => {
            try { await clerk.users.deleteUser(id); }
            catch (error) { if (error?.status !== 404) throw error; }
          });
        }
        await pool.query("DELETE FROM user_profiles WHERE user_id = ANY($1::text[])", [disposable]);
        await verifyGone(clerk, pool, disposable);
      } catch {
        console.error("[moderation-timeout] Fallback cleanup failed; provider details omitted");
      }
    }
    await pool.end().catch(() => { failure = Error("[moderation-timeout] Database close failed"); });
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  if (failure) {
    console.error(failure.message);
    process.exitCode = 1;
  }
}

async function retry(operation) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (![429, 500, 502, 503, 504].includes(error?.status) || attempt === 3) throw Error("Provider cleanup failed");
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
}

async function verifyGone(clerk, pool, ids) {
  for (const id of ids) {
    try { await clerk.users.getUser(id); }
    catch (error) {
      if (error?.status === 404) continue;
      throw Error("Disposable Clerk lookup failed");
    }
    throw Error("Disposable Clerk account remains");
  }
  const rows = await pool.query("SELECT user_id FROM user_profiles WHERE user_id = ANY($1::text[])", [ids]);
  if (rows.rowCount !== 0) throw Error("Disposable profiles remain");
}

async function verifyModerators(clerk, pool, ids, snapshots, accountSnapshots) {
  for (let i = 0; i < ids.length; i++) {
    const account = await clerk.users.getUser(ids[i]);
    if (JSON.stringify(account) !== accountSnapshots[i]) throw Error("Moderator account changed");
    const rows = await pool.query("SELECT row_to_json(p)::text AS snapshot FROM user_profiles p WHERE user_id = $1", [ids[i]]);
    const snapshot = rows.rowCount === 0 ? null : rows.rows[0].snapshot;
    if (rows.rowCount > 1 || snapshot !== snapshots[i]) throw Error("Moderator profile changed");
  }
}