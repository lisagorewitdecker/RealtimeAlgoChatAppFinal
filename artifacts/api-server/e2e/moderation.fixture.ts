import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type {
  Browser,
  BrowserContext,
  Page,
  ViewportSize,
} from "@playwright/test";
import {
  test as accounts,
  withClerkRetry,
  type DisposableAccounts,
  type DisposableUser,
  type ProviderClient,
} from "./moderation-accounts.fixture";

/**
 * The signed-in pages the moderation cases drive the app through, on top of
 * the disposable accounts `moderation-accounts.fixture.ts` provides.
 *
 * This is the only module here that reads the app's URL, and it is kept
 * separate for that reason: the timeout cleanup regression uses the accounts
 * fixture alone and opens no page, so a run of it goes without nothing. The
 * check holding a suite's declared settings to what its cases read follows
 * every module a spec imports whatever the scope of the read, so a spec that
 * reached this file would have to declare `E2E_CHAT_URL` optional and then
 * announce a gap on every run.
 */

const chatUrl = process.env["E2E_CHAT_URL"];

/** One of the suite's configured administrator accounts. */
export type AdministratorLogin = {
  email: string;
  password: string;
  /** Only used if this account has never completed first-run setup. */
  username: string;
};

export type SignedInPage = {
  context: BrowserContext;
  page: Page;
  userId: string;
};

/** How one case wants its page opened, where the default will not do. */
export type PageOptions = {
  /**
   * The size of screen to open the app on. Left out, the page gets the
   * project's own size; a case checking something the product's phone-sized
   * screen decides asks for that size instead.
   */
  viewport?: ViewportSize;
};

export type ModerationAccounts = DisposableAccounts & {
  /**
   * A signed-in page for one configured administrator. The provider work
   * behind that session happens once for the whole worker; each case gets
   * its own browser context, restored from it and closed with the case.
   */
  administrator: (
    browser: Browser,
    login: AdministratorLogin,
    options?: PageOptions,
  ) => Promise<SignedInPage>;
  /** A signed-in page for a disposable account the fixture created. */
  signIn: (browser: Browser, user: DisposableUser) => Promise<SignedInPage>;
};

type SessionStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type AdministratorSession = {
  userId: string;
  storageState: SessionStorageState;
};

/**
 * Each configured administrator's established session, shared by every case
 * in this worker. The account lookup, the password check and the ticket
 * sign-in behind one are the suite's most repeated provider calls, and a
 * development instance rate-limits bursts -- a throttled call surfaces as an
 * empty account search or a missing history row rather than as an
 * authentication error -- so that work is paid for once per worker instead of
 * once per case.
 */
export type AdministratorSessions = {
  /** Resolves one administrator's session, establishing it on first ask. */
  of: (
    browser: Browser,
    login: AdministratorLogin,
  ) => Promise<AdministratorSession>;
};

/** A browser context with the app open, signed in or not. */
async function openApp(
  browser: Browser,
  register: (context: BrowserContext) => void,
  options: PageOptions & { storageState?: SessionStorageState } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  if (!chatUrl) throw new Error("E2E_CHAT_URL is required to open the app");
  const context = await browser.newContext({
    ...(options.storageState ? { storageState: options.storageState } : {}),
    ...(options.viewport ? { viewport: options.viewport } : {}),
  });
  register(context);
  await setupClerkTestingToken({ context });
  const page = await context.newPage();
  await page.goto(chatUrl);
  return { context, page };
}

/**
 * Waits for the room list, completing first-run setup on the way if this
 * account has never chosen a display name.
 */
async function reachRoomList(page: Page, username: string): Promise<void> {
  const setupName = page.getByPlaceholder("How should your team know you?");
  const roomList = page.getByTestId("new-room-button");
  await Promise.race([
    setupName.waitFor({ state: "visible", timeout: 30_000 }),
    roomList.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  if (await setupName.isVisible()) {
    await setupName.fill(username);
    await page.getByText("Enter workspace", { exact: true }).click();
  }
  await roomList.waitFor({ state: "visible" });
}

/** Signs one known account into an open page with a short-lived ticket. */
async function signInWithTicket(
  client: ProviderClient,
  page: Page,
  userId: string,
): Promise<void> {
  const ticket = await withClerkRetry("create sign-in ticket", () =>
    client.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 }),
  );
  try {
    await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: ticket.token } });
  } catch {
    await withClerkRetry("revoke sign-in ticket", () =>
      client.signInTokens.revokeSignInToken(ticket.id),
    );
    throw new Error("Could not establish the moderation test browser session");
  }
}

/**
 * Establishes one administrator's session: the account lookup, the password
 * check, and the ticket sign-in behind it are the suite's most repeated
 * provider calls, so the result is kept as browser state that later cases
 * restore without asking the provider anything.
 */
async function establishAdministratorSession(
  client: ProviderClient,
  browser: Browser,
  login: AdministratorLogin,
): Promise<AdministratorSession> {
  const matches = await withClerkRetry("administrator account lookup", () =>
    client.users.getUserList({ emailAddress: [login.email] }),
  );
  const identity = matches.data.find((candidate) =>
    candidate.emailAddresses.some(
      (email) =>
        email.id === candidate.primaryEmailAddressId &&
        email.emailAddress.toLowerCase() === login.email.toLowerCase() &&
        email.verification?.status === "verified",
    ),
  );
  if (!identity?.passwordEnabled) {
    throw new Error("Test account requires a verified primary email and password sign-in");
  }
  try {
    await withClerkRetry("administrator password check", () =>
      client.users.verifyPassword({ userId: identity.id, password: login.password }),
    );
  } catch {
    throw new Error("Clerk rejected the configured test account password");
  }
  const owned: BrowserContext[] = [];
  try {
    const { context, page } = await openApp(browser, (opened) => owned.push(opened));
    await signInWithTicket(client, page, identity.id);
    await reachRoomList(page, login.username);
    return { userId: identity.id, storageState: await context.storageState() };
  } finally {
    // The cases get contexts of their own; this one only carried the sign-in.
    await Promise.allSettled(owned.map((context) => context.close()));
  }
}

export const test = accounts.extend<
  { moderationAccounts: ModerationAccounts },
  { administratorSessions: AdministratorSessions }
>({
  administratorSessions: [async ({ moderationProvider }, use) => {
    const established = new Map<string, Promise<AdministratorSession>>();
    await use({
      of: (browser, login) => {
        const key = login.email.trim().toLowerCase();
        const existing = established.get(key);
        if (existing) return existing;
        // A failed attempt is not kept: a cold preview or a throttled
        // provider must not settle how every later case ends.
        const attempt = establishAdministratorSession(
          moderationProvider.client(),
          browser,
          login,
        ).catch((error: unknown) => {
          established.delete(key);
          throw error;
        });
        established.set(key, attempt);
        return attempt;
      },
    });
  }, { scope: "worker" }],
  moderationAccounts: [async (
    { disposableAccounts, administratorSessions, moderationProvider },
    use,
  ) => {
    const contexts: BrowserContext[] = [];
    let closing = false;
    const administrator: ModerationAccounts["administrator"] = async (
      browser,
      login,
      options = {},
    ) => {
      if (closing) throw new Error("Moderation account fixture is closing");
      const session = await administratorSessions.of(browser, login);
      const { context, page } = await openApp(
        browser,
        (opened) => contexts.push(opened),
        { ...options, storageState: session.storageState },
      );
      await reachRoomList(page, login.username);
      return { context, page, userId: session.userId };
    };
    const signIn: ModerationAccounts["signIn"] = async (browser, user) => {
      if (closing) throw new Error("Moderation account fixture is closing");
      const { context, page } = await openApp(browser, (opened) =>
        contexts.push(opened),
      );
      // This account was just created here, so its id, verified email, and
      // password need no second trip to the provider to confirm.
      await signInWithTicket(moderationProvider.client(), page, user.id);
      await reachRoomList(page, user.username);
      return { context, page, userId: user.id };
    };
    try {
      await use({ create: disposableAccounts.create, administrator, signIn });
    } finally {
      closing = true;
      // These pages close before the accounts they are signed in to go: this
      // fixture is built on the one deleting those, so it is torn down first.
      const closed = await Promise.allSettled(
        contexts.map((context) => context.close()),
      );
      if (closed.some((result) => result.status === "rejected")) {
        throw new Error("Moderation cleanup failed: a browser context this case opened did not close");
      }
    }
  }, { timeout: 90_000 }],
});
