import { createClerkClient } from "@clerk/backend";
import { test as base } from "@playwright/test";
import {
  db,
  moderationActionsTable,
  moderatorsTable,
  userProfilesTable,
} from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { assertDevelopment, newIntent, ownership, RecoveryJournal, recoverDisposables } from "./moderation-recovery.mjs";

/**
 * Everything a moderation case needs that is not a browser page: the provider
 * client, the disposable accounts a case creates, and the sweep that removes
 * the ones an earlier run abandoned. `moderation.fixture.ts` builds the
 * signed-in pages on top of this.
 *
 * The split is what keeps the settings notice worth reading. The timeout
 * cleanup regression creates accounts and never opens the app, so the app's
 * URL is nothing that run goes without -- but the check holding each suite's
 * declared settings to what its cases read follows every module a spec
 * imports, at any scope, so while the page helpers sat in the one fixture
 * that suite had to declare `E2E_CHAT_URL` optional, and every run of it
 * printed a gap that was not a gap. Moving the read inside a function would
 * not have changed that; the helpers reading it have to live in a module that
 * spec does not import.
 */

const publishableKey = process.env["CLERK_PUBLISHABLE_KEY"];
const secretKey = process.env["CLERK_SECRET_KEY"];

export type DisposableUser = {
  id: string;
  email: string;
  password: string;
  username: string;
};

/** The accounts one case creates, and which go when that case ends. */
export type DisposableAccounts = {
  create: (role: "target" | "non-moderator") => Promise<DisposableUser>;
};

export type ProviderClient = ReturnType<typeof createClerkClient>;

/**
 * What every case in this worker shares: the provider client, and the
 * recovery journal with its one sweep for runs an earlier worker abandoned.
 * A development instance rate-limits bursts, and a throttled call surfaces as
 * an empty account search or a missing history row rather than as an
 * authentication error, so this work is paid for once per worker instead of
 * once per case.
 */
export type ModerationProvider = {
  client: () => ProviderClient;
  journal: () => RecoveryJournal;
  /** Resolves once abandoned runs have been swept, sweeping on first call. */
  recovered: () => Promise<unknown>;
};

export function clerkErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export async function withClerkRetry<T>(
  phase: string,
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const status = clerkErrorStatus(error);
      if (![429, 500, 502, 503, 504].includes(status ?? 0) || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
  // SDK errors can contain request bodies, passwords, and sign-in tokens.
  throw new Error(`[moderation-e2e] ${phase} failed; provider details omitted`);
}

/** Every row one of this suite's disposable accounts can leave behind. */
async function deleteAccountRows(id: string): Promise<void> {
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, id));
  // A run that fails between granting and revoking moderator access
  // would otherwise leave the grant behind after its account is gone.
  await db.delete(moderatorsTable).where(eq(moderatorsTable.userId, id));
  // History rows naming this disposable account: the entries its own
  // ban/restore and privilege changes wrote, and the rows a paging
  // check seeded for it.
  await db
    .delete(moderationActionsTable)
    .where(
      or(
        eq(moderationActionsTable.targetUserId, id),
        eq(moderationActionsTable.actorUserId, id),
      ),
    );
}

function recoverDisposableAccounts(
  provider: ModerationProvider,
  currentRun?: string,
): Promise<number> {
  return recoverDisposables({
    journal: provider.journal(),
    users: provider.client().users,
    env: process.env,
    currentRun,
    deleteAccountRows,
  });
}

export const test = base.extend<
  { disposableAccounts: DisposableAccounts },
  { moderationProvider: ModerationProvider }
>({
  moderationProvider: [async ({}, use) => {
    let client: ProviderClient | undefined;
    let journal: RecoveryJournal | undefined;
    let recovery: Promise<unknown> | undefined;
    const provider: ModerationProvider = {
      client: () => {
        assertDevelopment(process.env);
        return (client ??= createClerkClient({ secretKey, publishableKey }));
      },
      journal: () => (journal ??= new RecoveryJournal()),
      recovered: () => (recovery ??= recoverDisposableAccounts(provider)),
    };
    await use(provider);
  }, { scope: "worker" }],
  disposableAccounts: [async ({ moderationProvider }, use) => {
    const runId = crypto.randomUUID();
    let created = false;
    const pending = new Set<Promise<DisposableUser>>();
    let closing = false;
    const create: DisposableAccounts["create"] = (role) => {
      if (closing) throw new Error("Moderation account fixture is closing");
      const client = moderationProvider.client();
      const journal = moderationProvider.journal();
      created = true;
      const intent = newIntent(runId, role);
      const email = intent.email;
      const password = `E2e-${crypto.randomUUID()}!9`;
      const username = `Moderation ${role} ${intent.token.slice(0, 8)}`;
      // Do not retry non-idempotent creates: a lost response could create an
      // untracked duplicate. Register the returned ID before any further await.
      const creation = moderationProvider.recovered().then(() => {
        journal.save(intent);
        return client.users.createUser({
        emailAddress: [email],
        password,
        firstName: username,
        lastName: "E2E",
        skipLegalChecks: true,
        privateMetadata: { purpose: `moderation-e2e-${role}`, moderationDisposable: ownership(intent) },
      });
      }).then((user) => {
        intent.id = user.id;
        journal.save(intent);
        return { id: user.id, email, password, username };
      }).catch(() => {
        throw new Error("Disposable moderation account creation failed; provider details omitted");
      });
      pending.add(creation);
      // Attach both handlers so failures never become unhandled rejections.
      void creation.then(() => pending.delete(creation), () => pending.delete(creation));
      return creation;
    };
    try {
      await use({ create });
    } finally {
      closing = true;
      // A test can time out while createUser is still in flight.
      await Promise.allSettled([...pending]);
      // Any page signed in to these accounts is already closed: the fixture
      // opening those is built on this one, so it is torn down first.
      const removals: Promise<unknown>[] = created
        ? [
            withClerkRetry("recover disposable accounts", () =>
              recoverDisposableAccounts(moderationProvider, runId),
            ),
          ]
        : [];
      const deleted = await Promise.allSettled(removals);
      if (deleted.some((result) => result.status === "rejected")) {
        throw new Error("Moderation cleanup failed; provider details omitted");
      }
    }
  }, { timeout: 90_000 }],
});
