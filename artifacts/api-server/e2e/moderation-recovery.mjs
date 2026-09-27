import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";

export const MIN_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const namespace = "chat-moderation-disposable-v1";

export function assertDevelopment(env) {
  if (env.NODE_ENV === "production" || env.REPLIT_DEPLOYMENT === "1" ||
      !env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
      !env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
      !env.E2E_MODERATOR_EMAIL?.trim() || !env.E2E_MODERATOR_EMAIL_2?.trim()) {
    throw Error("Moderation recovery requires development keys and both moderator exclusions");
  }
}

// This journal contains ownership evidence, not passwords, tokens or key values.
// Keep it on persistent workspace storage so SIGKILL cannot discard the intent.
export class RecoveryJournal {
  constructor(directory = resolve(".local/moderation-recovery")) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  save(record) {
    const path = join(this.directory, `${record.token}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  }
  records() {
    return readdirSync(this.directory).filter((name) => /^[0-9a-f-]+\.json$/.test(name))
      .map((name) => JSON.parse(readFileSync(join(this.directory, name), "utf8")));
  }
  remove(record) {
    try { unlinkSync(join(this.directory, `${record.token}.json`)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function newIntent(runId, role, now = Date.now()) {
  if (!uuid.test(runId) || !["target", "non-moderator"].includes(role)) throw Error("Invalid disposable ownership");
  const token = randomUUID();
  return {
    namespace, runId, token, role, createdAt: now,
    email: `moderation-${role}-${token.replaceAll("-", "").slice(0, 16)}+clerk_test@example.com`,
  };
}

export function ownership(record) {
  return { namespace, runId: record.runId, token: record.token, role: record.role, createdAt: record.createdAt };
}

function valid(record) {
  return record?.namespace === namespace && uuid.test(record.runId) && uuid.test(record.token) &&
    ["target", "non-moderator"].includes(record.role) && Number.isSafeInteger(record.createdAt) &&
    record.email === `moderation-${record.role}-${record.token.replaceAll("-", "").slice(0, 16)}+clerk_test@example.com` &&
    (record.id === undefined || /^user_[a-zA-Z0-9]+$/.test(record.id));
}

export async function recoverDisposables({ journal, users, deleteAccountRows, env, now = Date.now(), currentRun }) {
  assertDevelopment(env);
  const protectedEmails = [env.E2E_MODERATOR_EMAIL, env.E2E_MODERATOR_EMAIL_2].map((e) => e.trim().toLowerCase());
  const protectedIds = new Set((env.ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  // Resolve both explicitly, before deleting anything; a failed lookup aborts.
  for (const email of protectedEmails) {
    const result = await users.getUserList({ emailAddress: [email], limit: 100 });
    if (result.totalCount !== result.data.length || !result.data.length) throw Error("Moderator exclusions could not be resolved");
    for (const user of result.data) protectedIds.add(user.id);
  }
  let removed = 0;
  for (const record of journal.records()) {
    const age = now - record.createdAt;
    if (!valid(record) || age < 0 || age > MAX_AGE_MS ||
        (record.runId !== currentRun && age < MIN_AGE_MS) ||
        protectedIds.has(record.id) || protectedEmails.includes(record.email.toLowerCase())) continue;
    let user;
    if (record.id) {
      try { user = await users.getUser(record.id); }
      catch (error) { if (error?.status !== 404) throw error; }
    } else {
      const result = await users.getUserList({ emailAddress: [record.email], limit: 100 });
      if (result.totalCount !== result.data.length || result.data.length > 1) continue;
      user = result.data[0];
    }
    if (user) {
      const tag = user.privateMetadata?.moderationDisposable;
      if (protectedIds.has(user.id) ||
          user.emailAddresses.some((e) => protectedEmails.includes(e.emailAddress.toLowerCase())) ||
          user.emailAddresses.length !== 1 || user.emailAddresses[0].emailAddress !== record.email ||
          !tag || Object.entries(ownership(record)).some(([key, value]) => tag[key] !== value) ||
          Math.abs(user.createdAt - record.createdAt) > 10 * 60 * 1000) continue;
      // Persist proof before deletion: a crash after Clerk deletion must still
      // allow the matching DB rows to be removed on the next recovery.
      record.id = user.id;
      record.verified = true;
      journal.save(record);
      try { await users.deleteUser(user.id); }
      catch (error) { if (error?.status !== 404) throw error; }
    } else if (!record.id || record.verified !== true) {
      // Keep unknown creates: a delayed provider commit may become visible later.
      continue;
    }
    await deleteAccountRows(record.id);
    journal.remove(record);
    removed += 1;
  }
  return removed;
}