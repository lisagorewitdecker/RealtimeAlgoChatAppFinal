import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { RecoveryJournal, newIntent, ownership, recoverDisposables, MIN_AGE_MS, MAX_AGE_MS } from "./moderation-recovery.mjs";

const env = {
  CLERK_SECRET_KEY: "sk_test_fake", CLERK_PUBLISHABLE_KEY: "pk_test_fake",
  E2E_MODERATOR_EMAIL: "mod1@example.com", E2E_MODERATOR_EMAIL_2: "mod2@example.com",
  ADMIN_USER_IDS: "user_admin",
};
const now = Date.now();
function harness(t) {
  const directory = mkdtempSync(join(tmpdir(), "moderation-recovery-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const journal = new RecoveryJournal(directory);
  const accounts = new Map();
  const profiles = new Set(["user_mod1", "user_mod2", "user_admin"]);
  const deleted = [];
  for (const [id, email] of [["user_mod1", env.E2E_MODERATOR_EMAIL], ["user_mod2", env.E2E_MODERATOR_EMAIL_2]]) {
    accounts.set(id, { id, emailAddresses: [{ emailAddress: email }] });
  }
  const users = {
    async getUserList({ emailAddress }) {
      const data = [...accounts.values()].filter((u) => u.emailAddresses.some((e) => emailAddress.includes(e.emailAddress)));
      return { data, totalCount: data.length };
    },
    async getUser(id) {
      if (!accounts.has(id)) throw { status: 404 };
      return accounts.get(id);
    },
    async deleteUser(id) { deleted.push(id); accounts.delete(id); },
  };
  function add(age = MIN_AGE_MS + 1) {
    const record = newIntent(randomUUID(), "target", now - age);
    const id = `user_${randomUUID().replaceAll("-", "")}`;
    const user = { id, createdAt: record.createdAt, emailAddresses: [{ emailAddress: record.email }], privateMetadata: { moderationDisposable: ownership(record) } };
    journal.save(record);
    accounts.set(id, user);
    profiles.add(id);
    return { record, user, id };
  }
  const options = { journal, users, env, now, deleteAccountRows: async (id) => { profiles.delete(id); } };
  return { directory, journal, accounts, profiles, deleted, users, add, options };
}

test("lost create response is recovered from persisted intent and exact metadata", async (t) => {
  const h = harness(t);
  const { id } = h.add();
  assert.equal(await recoverDisposables(h.options), 1);
  assert.deepEqual(h.deleted, [id]);
  assert.equal(h.profiles.has(id), false);
  assert.equal(h.journal.records().length, 0);
  assert.deepEqual([...h.profiles], ["user_mod1", "user_mod2", "user_admin"]);
  assert.equal(await recoverDisposables(h.options), 0);
});

test("worker SIGKILL leaves its pre-create intent recoverable in a fresh process", async (t) => {
  const h = harness(t);
  const { record, id } = h.add();
  h.journal.remove(record);
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { RecoveryJournal } from ${JSON.stringify(new URL("./moderation-recovery.mjs", import.meta.url).href)};
    new RecoveryJournal(process.argv[1]).save(JSON.parse(process.argv[2]));
    process.stdout.write("ready");
    setInterval(() => {}, 1000);
  `, h.directory, JSON.stringify(record)], { stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => child.kill("SIGKILL"));
  await once(child.stdout, "data");
  const exit = once(child, "exit");
  child.kill("SIGKILL");
  assert.equal((await exit)[1], "SIGKILL");
  assert.equal(await recoverDisposables({ ...h.options, journal: new RecoveryJournal(h.directory) }), 1);
  assert.equal(h.profiles.has(id), false);
});

test("DB failure after Clerk deletion retains verified ID for a later retry", async (t) => {
  const h = harness(t);
  const { id } = h.add();
  await assert.rejects(recoverDisposables({ ...h.options, deleteAccountRows: async () => { throw Error("DB unavailable"); } }));
  assert.equal(h.accounts.has(id), false);
  assert.equal(h.journal.records()[0].verified, true);
  assert.equal(await recoverDisposables(h.options), 1);
  assert.equal(h.profiles.has(id), false);
});

test("age window protects recent, future and excessively old runs; current teardown is immediate", async (t) => {
  const h = harness(t);
  const recent = h.add(0);
  h.add(-1); h.add(MAX_AGE_MS + 1);
  assert.equal(await recoverDisposables(h.options), 0);
  assert.equal(await recoverDisposables({ ...h.options, currentRun: recent.record.runId }), 1);
  assert.deepEqual(h.deleted, [recent.id]);
});

test("missing/forged ownership, lookalike emails, extra emails and altered creation times are not proof", async (t) => {
  const h = harness(t);
  const a = h.add(); a.user.privateMetadata = {};
  const b = h.add(); b.user.privateMetadata.moderationDisposable.runId = randomUUID();
  const c = h.add(); c.user.emailAddresses[0].emailAddress = `lookalike-${c.record.email}`;
  const d = h.add(); d.user.emailAddresses.push({ emailAddress: "real@example.com" });
  const e = h.add(); e.user.createdAt -= 60 * 60 * 1000;
  assert.equal(await recoverDisposables(h.options), 0);
  assert.equal(h.deleted.length, 0);
});

test("moderator IDs, secondary moderator email and configured admins are never deleted", async (t) => {
  const h = harness(t);
  for (const id of ["user_mod1", "user_mod2", "user_admin"]) {
    const disposable = h.add();
    h.accounts.delete(disposable.id);
    disposable.user.id = id;
    // Even valid ownership on an excluded ID cannot authorize deletion.
    disposable.record.id = id;
    h.journal.save(disposable.record);
    if (id !== "user_admin") disposable.user.emailAddresses.push({ emailAddress: id === "user_mod1" ? env.E2E_MODERATOR_EMAIL : env.E2E_MODERATOR_EMAIL_2 });
    h.accounts.set(id, disposable.user);
  }
  assert.equal(await recoverDisposables(h.options), 0);
  assert.equal(h.deleted.length, 0);
  for (const id of ["user_mod1", "user_mod2", "user_admin"]) assert.ok(h.profiles.has(id));
});

test("production, live keys and missing/unresolvable moderators fail closed", async (t) => {
  const h = harness(t); h.add();
  for (const override of [{ NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" }, { CLERK_SECRET_KEY: "sk_live_fake" }, { CLERK_PUBLISHABLE_KEY: "pk_live_fake" }, { E2E_MODERATOR_EMAIL_2: "" }, { E2E_MODERATOR_EMAIL: "missing@example.com" }]) {
    await assert.rejects(recoverDisposables({ ...h.options, env: { ...env, ...override } }));
  }
  assert.equal(h.deleted.length, 0);
});

test("provider deletion errors retain journal and profile; unproven missing users cannot delete profiles", async (t) => {
  const h = harness(t);
  const { record, id } = h.add();
  h.users.deleteUser = async () => { throw { status: 503 }; };
  await assert.rejects(recoverDisposables(h.options));
  assert.ok(h.profiles.has(id));
  assert.equal(h.journal.records().length, 1);
  record.id = id;
  h.journal.save(record); // no verified evidence
  h.accounts.delete(id);
  assert.equal(await recoverDisposables(h.options), 0);
  assert.ok(h.profiles.has(id));
});