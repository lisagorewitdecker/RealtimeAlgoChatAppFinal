import { createClerkClient } from "@clerk/backend";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { db, moderationActionsTable, roomsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import {
  browserTestWaiver,
  MODERATION_SUITE,
} from "@workspace/browser-test-requirements";
import {
  withClerkRetry,
  type DisposableUser,
} from "./moderation-accounts.fixture";
import {
  test,
  type AdministratorLogin,
  type ModerationAccounts,
} from "./moderation.fixture";

const chatUrl = process.env["E2E_CHAT_URL"];
const apiUrl = process.env["E2E_API_URL"];
const publishableKey = process.env["CLERK_PUBLISHABLE_KEY"];
const secretKey = process.env["CLERK_SECRET_KEY"];

type ModeratorCredentials = {
  label: string;
  email: string | undefined;
  password: string | undefined;
  /** Only used if this administrator has never named themselves here. */
  username: string;
};

// Both pairs are required of any run that reaches this file; the requirement
// module lists their variable names and stops the run where one is missing.
const moderatorCredentials: ModeratorCredentials[] = [
  {
    label: "configured administrator 1",
    email: process.env["E2E_MODERATOR_EMAIL"]?.trim(),
    password: process.env["E2E_MODERATOR_PASSWORD"],
    username: "Primary moderator",
  },
  {
    label: "configured administrator 2",
    email: process.env["E2E_MODERATOR_EMAIL_2"]?.trim(),
    password: process.env["E2E_MODERATOR_PASSWORD_2"],
    // Telling one administrator's actions from another's needs two names.
    username: "Secondary moderator",
  },
];

// A run missing any of these settings has already been stopped by the
// config's globalSetup, before this file was loaded. The one way past it is
// the deliberate waiver, declared here at file scope so every case below is
// marked skipped as it is collected -- before a browser is launched or any
// disposable account is created -- and the run's own list still names the
// checks it left out.
//
// This must stay a skip of the whole file rather than a guard inside each
// case: a misconfigured run is meant to fail, and only a run that asked to
// be waived gets past the step above.
const waiver = browserTestWaiver(MODERATION_SUITE);
test.skip(waiver.waived, waiver.reason);

/**
 * The details the fixture signs one configured administrator in with. The
 * session behind it is established once for the whole run, so a case asking
 * for it again costs the identity provider nothing.
 */
function administratorLogin(moderator: ModeratorCredentials): AdministratorLogin {
  return {
    email: moderator.email!,
    password: moderator.password!,
    username: moderator.username,
  };
}

async function openProfile(page: Page) {
  const profileTab = page.getByRole("tab", { name: "Profile", exact: true });
  if (await profileTab.count()) {
    await profileTab.click();
  } else {
    await page.getByText("Profile", { exact: true }).first().click();
  }
}

/**
 * How long to give an open profile screen to notice that its account's
 * moderator access has changed. The screen re-reads the role periodically
 * while it is in view; this allows for several of those checks so a slow
 * preview does not fail the run.
 */
const ROLE_CHANGE_TIMEOUT_MS = 60_000;
/** A short-lived bearer token for an account, minted through Clerk. */
async function sessionToken(
  client: ReturnType<typeof createClerkClient>,
  userId: string,
  label: string,
): Promise<string> {
  const session = await withClerkRetry(`create ${label} session`, () =>
    client.sessions.createSession({ userId }),
  );
  const token = await withClerkRetry(`mint ${label} token`, () =>
    client.sessions.getToken(session.id, undefined, 300),
  );
  return token.jwt;
}

// Requested with `fetch` rather than Playwright's request fixture, which
// would keep the bearer token in its failure log.
async function moderationSearchStatus(
  jwt: string,
  query: string,
): Promise<number> {
  const response = await fetch(
    `${apiUrl}/api/moderation/search?query=${encodeURIComponent(query)}`,
    {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  return response.status;
}

/** What the account's own next request is told about its moderator role. */
async function profileReportsAdmin(jwt: string): Promise<boolean> {
  const response = await fetch(`${apiUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(15_000),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { isAdmin?: boolean };
  return body.isAdmin === true;
}

async function verifyModerator(
  browser: Browser,
  moderator: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  const clerkClient = createClerkClient({ publishableKey, secretKey });
  try {
    const target = await accounts.create("target");
    const nonModerator = await accounts.create("non-moderator");
    const targetEmail = target.email;

    const nonModeratorToken = await sessionToken(
      clerkClient,
      nonModerator.id,
      "non-moderator",
    );

    const moderatorPage = await accounts.administrator(
      browser,
      administratorLogin(moderator),
    );
    await openProfile(moderatorPage.page);
    await expect(
      moderatorPage.page.getByTestId("moderation-panel"),
    ).toBeVisible();

    await moderatorPage.page
      .getByTestId("moderation-search-input")
      .fill(targetEmail);
    await moderatorPage.page.getByTestId("moderation-search-button").click();
    const targetResult = moderatorPage.page.getByTestId(
      `moderation-search-result-${target.id}`,
    );
    await expect(targetResult).toBeVisible();
    await targetResult.click();
    await expect(
      moderatorPage.page.getByTestId("moderation-selected-account"),
    ).toBeVisible();
    // The tint is the only sighted cue for the account now staged. React
    // Native's own selected state never reaches the page, so in a browser
    // the choice has to be an attribute of its own, inside a group that
    // says these rows are one set of choices rather than loose buttons.
    await expect(
      moderatorPage.page.getByTestId("moderation-search-results"),
    ).toHaveAttribute("role", "radiogroup");
    await expect(targetResult).toHaveAttribute("role", "radio");
    await expect(targetResult).toHaveAttribute("aria-checked", "true");

    await moderatorPage.page.getByTestId("ban-account-button").click();
    await expect(
      moderatorPage.page.getByTestId("moderation-feedback"),
    ).toContainText("is banned");
    await expect(targetResult).toContainText("Banned");

    await moderatorPage.page.getByTestId("restore-account-button").click();
    await expect(
      moderatorPage.page.getByTestId("moderation-feedback"),
    ).toContainText("has been restored");
    await expect(targetResult).not.toContainText("Banned");

    // Staging an account is a keyboard path as much as a pointer one, and
    // off the button role the space bar stops counting as a press unless
    // the row answers it itself. A second search proves the attribute
    // follows the pick rather than sitting true on whatever is listed.
    await moderatorPage.page
      .getByTestId("moderation-search-input")
      .fill(nonModerator.email);
    await moderatorPage.page.getByTestId("moderation-search-button").click();
    const keyboardResult = moderatorPage.page.getByTestId(
      `moderation-search-result-${nonModerator.id}`,
    );
    await expect(keyboardResult).toBeVisible();
    await expect(keyboardResult).toHaveAttribute("aria-checked", "false");
    await keyboardResult.press(" ");
    await expect(keyboardResult).toHaveAttribute("aria-checked", "true");
    await expect(
      moderatorPage.page.getByTestId("moderation-user-id"),
    ).toHaveValue(nonModerator.id);

    const nonModeratorPage = await accounts.signIn(browser, nonModerator);
    await openProfile(nonModeratorPage.page);
    await expect(
      nonModeratorPage.page.getByTestId("moderation-panel"),
    ).toHaveCount(0);

    expect(await moderationSearchStatus(nonModeratorToken, targetEmail)).toBe(
      403,
    );

    // Keep bearer tokens out of Playwright's request-step failure logs.
    const banResponse = await fetch(
      `${apiUrl}/api/moderation/ban`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nonModeratorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: target.id }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    expect(banResponse.status).toBe(403);
  } catch {
    throw new Error("Moderation verification failed; credentials and provider details omitted");
  }
}

/**
 * Waits for the history request the panel makes for one exact filter set, so
 * an assertion cannot pass against the results of the previous query that is
 * still on screen while the new one is in flight.
 */
function historyResponse(page: Page, search: string) {
  return page.waitForResponse(
    (response) =>
      response.url().split("?")[0]?.endsWith("/api/moderation/history") === true &&
      new URL(response.url()).search === search,
    { timeout: 30_000 },
  );
}

/** The rendered history rows, excluding the filter links inside them. */
function historyEntries(page: Page): Locator {
  return page
    .getByTestId("moderation-history-list")
    .getByTestId(/^moderation-history-entry-\d+$/);
}
/**
 * A privilege change is recorded in the same transaction as the change
 * itself, but that record is only useful if it reaches the list an
 * administrator reads. This checks the rendered entries for the account
 * whose access just changed: filtered to that account, and in the
 * unfiltered list the panel opens with.
 */
async function verifyModeratorHistoryEntries(
  page: Page,
  administratorUserId: string,
  targetUserId: string,
): Promise<void> {
  const historyList = page.getByTestId("moderation-history-list");
  const entries = historyList.getByTestId(/^moderation-history-entry-\d+$/);

  const filtered = historyResponse(
    page,
    `?${new URLSearchParams({ targetUserId }).toString()}`,
  );
  await page.getByTestId("moderation-history-target-filter").fill(targetUserId);
  await page.getByTestId("moderation-history-filter-apply").click();
  expect((await filtered).status()).toBe(200);

  await expect(entries).toHaveCount(2);
  const grantEntry = entries.filter({ hasText: "granted moderator access to" });
  const revokeEntry = entries.filter({
    hasText: "removed moderator access from",
  });
  await expect(grantEntry).toHaveCount(1);
  await expect(revokeEntry).toHaveCount(1);

  // Each entry has to name the administrator who made that change. The
  // expected name is read from the administrator's own row in the panel's
  // moderator list, so it comes from the account rather than from this test.
  const administratorRow = page.getByTestId(
    `moderator-row-${administratorUserId}`,
  );
  await expect(administratorRow).toBeVisible();
  for (const entry of [grantEntry, revokeEntry]) {
    const actorName = (
      await entry.getByTestId(/-filter-actor$/).innerText()
    ).trim();
    expect(actorName).not.toBe("");
    await expect(administratorRow).toContainText(actorName);
  }

  // Filtering is not the only way the panel is read, so the same two entries
  // have to be in the unfiltered list as well.
  const entryIds = await entries.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-testid") ?? ""),
  );
  expect(entryIds.filter(Boolean)).toHaveLength(2);

  const unfiltered = historyResponse(page, "");
  await page.getByTestId("moderation-history-filter-clear").click();
  expect((await unfiltered).status()).toBe(200);
  for (const entryId of entryIds) {
    await expect(historyList.getByTestId(entryId)).toBeVisible();
  }
}

/**
 * The server answers a history request with at most 50 rows, so an account
 * needs more than that before "Load more" has anything to reach. Seeding the
 * extra rows keeps the run short: the actions themselves are covered
 * elsewhere, and what is under test here is the paging around them.
 */
const MODERATION_HISTORY_PAGE_SIZE = 50;
const SEEDED_ACTIONS = 58;
/** How often a second account's row is placed between the filtered ones. */
const SEEDED_OTHER_ACCOUNT_EVERY = 5;

/**
 * Writes more than one page of history for `target`, with rows for `other`
 * interleaved between them. The interleaving is what makes the account
 * filter observable on the second page: those rows sit inside the filtered
 * account's id range, so a follow-up request that dropped the filter would
 * pull them in.
 *
 * Returns each account's row ids, newest first -- the same order the panel
 * lists them in.
 */
async function seedModerationHistory(
  actorUserId: string,
  target: DisposableUser,
  other: DisposableUser,
): Promise<{ targetIds: number[]; otherIds: number[] }> {
  const oldest = Date.now() - (SEEDED_ACTIONS + 1) * 60_000;
  const row = (account: DisposableUser, index: number) => ({
    action: index % 2 === 0 ? "ban" : "restore",
    actorUserId,
    actorUsername: "Moderation paging check",
    targetUserId: account.id,
    targetUsername: account.username,
    targetEmail: account.email,
    createdAt: new Date(oldest + index * 60_000),
  });

  const rows: (typeof moderationActionsTable.$inferInsert)[] = [];
  for (let index = 0; index < SEEDED_ACTIONS; index += 1) {
    if (index > 0 && index % SEEDED_OTHER_ACCOUNT_EVERY === 0) {
      rows.push(row(other, index));
    }
    rows.push(row(target, index));
  }

  const inserted = await db
    .insert(moderationActionsTable)
    .values(rows)
    .returning({
      id: moderationActionsTable.id,
      targetUserId: moderationActionsTable.targetUserId,
    });
  const idsFor = (userId: string) =>
    inserted
      .filter((entry) => entry.targetUserId === userId)
      .map((entry) => entry.id)
      .sort((first, second) => second - first);

  return { targetIds: idsFor(target.id), otherIds: idsFor(other.id) };
}

/** The history row ids the panel is showing, in the order it shows them. */
async function renderedHistoryIds(page: Page): Promise<number[]> {
  return page
    .getByTestId("moderation-history-list")
    .getByTestId(/^moderation-history-entry-\d+$/)
    .evaluateAll((rows) =>
      rows.map((row) =>
        Number(
          (row.getAttribute("data-testid") ?? "").replace(
            "moderation-history-entry-",
            "",
          ),
        ),
      ),
    );
}

/** Where the moderation log is scrolled to, and what it can reach. */
type HistoryScrollPosition = {
  /** How far the log has been scrolled from its top. */
  offset: number;
  /**
   * The offset the newest entry begins at. The log's rows are the profile
   * screen's own list items and the rest of the screen sits above them, so
   * the newest entry has gone off the top once the offset clears that block.
   */
  newestEntryOffset: number;
  /** The furthest down the log can be scrolled. */
  maxOffset: number;
};

/**
 * A phone-sized screen, the size this product is used at. The control that
 * offers the newest entries back is placed against the tab bar, and a phone
 * leaves it far less room than a desktop-sized browser window does: the
 * screen above the log is taller than the whole viewport and the list keeps
 * only a few rows on screen at a time.
 */
const PHONE_VIEWPORT = { width: 402, height: 874 };

/**
 * Checks a floating control is where a finger would find it: drawn inside
 * the screen, clear of the tab bar that floats over every tab screen, and
 * the top-most thing at the point it would be tapped.
 *
 * The bar is measured rather than assumed, because the control's offset is
 * the screen's own tab bar clearance: a clearance that stops matching the
 * bar, or is counted from the wrong edge, leaves the control underneath it.
 * Both checks are needed. The bar's backdrop takes no pointer events, so a
 * control drawn behind it can still answer a tap it is invisible to; and a
 * layer that does take them would leave a control that looks offered and
 * does nothing.
 */
async function expectTappableClearOfTabBar(
  page: Page,
  control: Locator,
  label: string,
): Promise<void> {
  const viewport = page.viewportSize();
  const box = await control.boundingBox();
  const tabBar = await page.getByRole("tablist").boundingBox();
  expect(viewport, "the browser should have a known screen size").not.toBeNull();
  expect(box, `${label} should have a visible bounding box`).not.toBeNull();
  expect(tabBar, "the tab bar should have a visible bounding box").not.toBeNull();
  if (!viewport || !box || !tabBar) return;

  expect(box.x, `${label} starts outside the left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} starts outside the top edge`).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${label} extends past the right edge`,
  ).toBeLessThanOrEqual(viewport.width);
  expect(
    box.y + box.height,
    `${label} extends past the bottom edge`,
  ).toBeLessThanOrEqual(viewport.height);
  expect(
    box.y + box.height,
    `${label} reaches into the tab bar`,
  ).toBeLessThanOrEqual(tabBar.y);

  const reachable = await control.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return hit !== null && node.contains(hit);
  });
  expect(reachable, `${label} is covered where it is drawn`).toBe(true);
}

/**
 * Drives the control that offers the newest entries back, on whatever size
 * of screen the given page has: it must stay away while the newest entry is
 * still reachable, appear once that entry has gone off the top, be tappable
 * where it is drawn, and put that entry back on screen when used.
 */
async function verifyJumpToNewest(
  page: Page,
  newestEntryId: number,
): Promise<void> {
  const jumpToNewest = page.getByTestId("moderation-history-jump-newest");
  const atTop = await historyScroll(page, 0);
  expect(atTop.newestEntryOffset).toBeGreaterThan(0);
  // The newest entry is the first thing under the rest of the screen, so
  // from the top there is nothing to come back to.
  await expect(jumpToNewest).toHaveCount(0);

  // Part way down what sits above the log, with the newest entry still
  // below it: a control offered here would be offered for nothing.
  const aboveNewest = await historyScroll(
    page,
    Math.floor(atTop.newestEntryOffset / 2),
  );
  expect(aboveNewest.offset).toBeLessThan(aboveNewest.newestEntryOffset);
  await expect(jumpToNewest).toHaveCount(0);

  // The bottom of the log is where an administrator ends up after reading
  // through the pages they loaded.
  const scrolledPast = await historyScroll(page, atTop.maxOffset);
  expect(scrolledPast.offset).toBeGreaterThan(scrolledPast.newestEntryOffset);
  await expect(jumpToNewest).toBeVisible();
  await expectTappableClearOfTabBar(
    page,
    jumpToNewest,
    "the way back to the newest entries",
  );

  // A control nothing can reach would otherwise hold the whole case's
  // budget open, since an obstructed click has no deadline of its own.
  await jumpToNewest.click({ timeout: 15_000 });
  // Back to the newest entry itself, rather than to the top of the profile
  // screen or to wherever the log happened to be -- and the newest entry
  // being on screen again is what takes the control away.
  await expect(
    page.getByTestId(`moderation-history-entry-${newestEntryId}`),
  ).toBeInViewport({ timeout: 15_000 });
  await expect(jumpToNewest).toHaveCount(0);
  // The control scrolls the log smoothly, so where it left it is read once
  // that has landed rather than part way through it.
  await expect
    .poll(
      async () => {
        const settling = await historyScroll(page);
        return Math.abs(settling.offset - settling.newestEntryOffset);
      },
      { timeout: 15_000 },
    )
    .toBeLessThanOrEqual(2);
  const afterJump = await historyScroll(page);
  expect(afterJump.offset).toBeLessThanOrEqual(afterJump.newestEntryOffset);
  expect(afterJump.offset).toBeGreaterThanOrEqual(
    afterJump.newestEntryOffset - 2,
  );
}

/**
 * An installation that has been moderated for a while has more history than
 * one page. This drives the panel past that boundary for one account: the
 * next page has to append the older rows to the ones already read, keep the
 * applied account filter, and stop offering more once it has arrived. A
 * failed attempt in between must leave the button usable, otherwise the only
 * way back to the older entries would be to reload the panel.
 *
 * Those pages then put the newest entries a long scroll above wherever the
 * reader has got to, so the same case carries on into the control that
 * offers them back: it must stay out of the way until the newest entry has
 * gone off the top, and put that entry back on screen when it is used. That
 * control is checked twice over, on a desktop-sized browser window and on a
 * phone-sized screen, because where it is drawn -- and what it ends up
 * underneath -- depends on the size of the screen it is on.
 */
async function verifyHistoryPaging(
  browser: Browser,
  moderator: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  let stage = "disposable account creation";
  try {
    const [target, other] = await Promise.all([
      accounts.create("target"),
      accounts.create("non-moderator"),
    ]);

    stage = "the moderator's panel";
    const { page, userId } = await accounts.administrator(
      browser,
      administratorLogin(moderator),
    );
    await openProfile(page);
    await expect(page.getByTestId("moderation-panel")).toBeVisible();

    stage = "seeding more than one page of history";
    const { targetIds, otherIds } = await seedModerationHistory(
      userId,
      target,
      other,
    );
    const firstPageIds = targetIds.slice(0, MODERATION_HISTORY_PAGE_SIZE);
    const cursor = firstPageIds[firstPageIds.length - 1]!;
    // Without rows of another account below the cursor, a lost filter on the
    // follow-up request would look the same as a kept one.
    expect(otherIds.some((id) => id < cursor)).toBe(true);

    stage = "the first page for the filtered account";
    const entries = page
      .getByTestId("moderation-history-list")
      .getByTestId(/^moderation-history-entry-\d+$/);
    const firstPage = historyResponse(
      page,
      `?${new URLSearchParams({ targetUserId: target.id }).toString()}`,
    );
    await page.getByTestId("moderation-history-target-filter").fill(target.id);
    await page.getByTestId("moderation-history-filter-apply").click();
    expect((await firstPage).status()).toBe(200);
    await expect(entries).toHaveCount(MODERATION_HISTORY_PAGE_SIZE);
    expect(await renderedHistoryIds(page)).toEqual(firstPageIds);

    stage = "a failed attempt at the next page";
    const nextPageRequest = (url: URL) =>
      url.pathname.endsWith("/api/moderation/history") &&
      url.searchParams.has("cursor");
    const failNextPage = (route: Route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": new URL(chatUrl!).origin },
        body: JSON.stringify({ error: "Moderation history is unavailable." }),
      });
    await page.route(nextPageRequest, failNextPage);
    const loadMore = page.getByTestId("moderation-history-load-more");
    await loadMore.click();
    await expect(page.getByTestId("moderation-history-error")).toBeVisible();
    // The page already read stays put, and the button is offered again
    // rather than left in its loading state.
    expect(await renderedHistoryIds(page)).toEqual(firstPageIds);
    await expect(loadMore).toHaveText("Load more");
    await page.unroute(nextPageRequest, failNextPage);

    stage = "the next page for the filtered account";
    const nextPage = historyResponse(
      page,
      `?${new URLSearchParams({
        cursor: String(cursor),
        targetUserId: target.id,
      }).toString()}`,
    );
    await loadMore.click();
    expect((await nextPage).status()).toBe(200);
    await expect(entries).toHaveCount(SEEDED_ACTIONS);
    // Every row of the filtered account, newest first: the first page kept
    // its place, the older rows were added after it, none twice, and no row
    // of the account that was filtered out.
    expect(await renderedHistoryIds(page)).toEqual(targetIds);

    stage = "the end of the filtered account's history";
    await expect(loadMore).toHaveCount(0);

    stage = "the way back to the newest entries";
    const newestEntryId = targetIds[0]!;
    await verifyJumpToNewest(page, newestEntryId);

    stage = "the same log on a phone-sized screen";
    // Everything above was read in a desktop-sized browser window, where the
    // screen above the log is a fraction of what it is on a phone and the
    // control sits nowhere near the tab bar. The product is a phone app, so
    // the same log is read again at a phone's size, on its own page.
    const phone = await accounts.administrator(
      browser,
      administratorLogin(moderator),
      { viewport: PHONE_VIEWPORT },
    );
    // A page that quietly came up at the project's own size would repeat
    // the checks above and report them as a phone's.
    expect(phone.page.viewportSize()).toEqual(PHONE_VIEWPORT);
    await openProfile(phone.page);
    await expect(phone.page.getByTestId("moderation-panel")).toBeVisible();
    await applyHistoryFilters(phone.page, { targetUserId: target.id });
    // The row the jump has to come back to is there to begin with. A phone
    // shows a handful of rows at a time, so the count the desktop page was
    // held to says nothing here: what the list keeps rendered off screen is
    // its own business.
    await expect(
      phone.page.getByTestId(`moderation-history-entry-${newestEntryId}`),
    ).toBeVisible();

    stage = "the way back to the newest entries on a phone-sized screen";
    await verifyJumpToNewest(phone.page, newestEntryId);
  } catch {
    throw new Error(
      `Moderation history paging verification failed at ${stage}; credentials and provider details omitted`,
    );
  }
}

/**
 * Granting moderator access from the panel has to make the granted account a
 * moderator everywhere else: on its own next request, and in its own copy of
 * the app. Revoking it has to take both away again. Route tests cover the
 * permission check in isolation, so this runs the whole path against the
 * running server with real Clerk sessions.
 */
async function verifyModeratorLifecycle(
  browser: Browser,
  moderator: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  const clerkClient = createClerkClient({ publishableKey, secretKey });
  let stage = "disposable account creation";
  try {
    const candidate = await accounts.create("target");

    stage = "the account's role before the grant";
    expect(
      await profileReportsAdmin(
        await sessionToken(clerkClient, candidate.id, "moderator candidate"),
      ),
    ).toBe(false);

    stage = "the moderator's panel";
    const moderatorPage = await accounts.administrator(
      browser,
      administratorLogin(moderator),
    );
    await openProfile(moderatorPage.page);
    await expect(
      moderatorPage.page.getByTestId("moderation-panel"),
    ).toBeVisible();

    stage = "granting moderator access";
    await moderatorPage.page
      .getByTestId("moderation-search-input")
      .fill(candidate.email);
    await moderatorPage.page.getByTestId("moderation-search-button").click();
    const candidateResult = moderatorPage.page.getByTestId(
      `moderation-search-result-${candidate.id}`,
    );
    await expect(candidateResult).toBeVisible();
    await candidateResult.click();
    await expect(
      moderatorPage.page.getByTestId("moderation-selected-account"),
    ).toBeVisible();
    await moderatorPage.page.getByTestId("grant-moderator-button").click();
    await expect(
      moderatorPage.page.getByTestId("moderator-feedback"),
    ).toContainText("can now moderate");
    await expect(
      moderatorPage.page.getByTestId(`moderator-row-${candidate.id}`),
    ).toBeVisible();

    stage = "the granted account's next requests";
    const grantedToken = await sessionToken(
      clerkClient,
      candidate.id,
      "granted moderator",
    );
    expect(await profileReportsAdmin(grantedToken)).toBe(true);
    expect(await moderationSearchStatus(grantedToken, candidate.email)).toBe(
      200,
    );

    stage = "the granted account's own moderation panel";
    const candidatePage = await accounts.signIn(browser, candidate);
    await openProfile(candidatePage.page);
    await expect(
      candidatePage.page.getByTestId("moderation-panel"),
    ).toBeVisible();

    stage = "revoking moderator access";
    await moderatorPage.page
      .getByTestId(`revoke-moderator-${candidate.id}`)
      .click();
    await expect(
      moderatorPage.page.getByTestId("moderator-feedback"),
    ).toContainText("can no longer moderate");
    await expect(
      moderatorPage.page.getByTestId(`moderator-row-${candidate.id}`),
    ).toHaveCount(0);

    stage = "the revoked account's next requests";
    const revokedToken = await sessionToken(
      clerkClient,
      candidate.id,
      "revoked moderator",
    );
    expect(await profileReportsAdmin(revokedToken)).toBe(false);
    expect(await moderationSearchStatus(revokedToken, candidate.email)).toBe(
      403,
    );

    stage = "the revoked account's own moderation panel";
    // Nothing touches this page: no reload, no tab switch, no button press.
    // The panel has to go on its own while the member sits in front of it,
    // and the profile screen around it has to stay up.
    await expect(candidatePage.page.getByTestId("moderation-panel")).toHaveCount(
      0,
      { timeout: ROLE_CHANGE_TIMEOUT_MS },
    );
    await expect(
      candidatePage.page.getByTestId("current-profile-avatar"),
    ).toBeVisible();

    stage = "the moderation history for both privilege changes";
    await verifyModeratorHistoryEntries(
      moderatorPage.page,
      moderatorPage.userId,
      candidate.id,
    );
  } catch {
    // The stage name says where this stopped without naming accounts.
    throw new Error(
      `Moderator lifecycle verification failed at ${stage}; credentials and provider details omitted`,
    );
  }
}

/** Finds one account through the panel's search and selects it. */
async function selectAccount(
  page: Page,
  account: Pick<DisposableUser, "id" | "email">,
): Promise<void> {
  await page.getByTestId("moderation-search-input").fill(account.email);
  await page.getByTestId("moderation-search-button").click();
  const result = page.getByTestId(`moderation-search-result-${account.id}`);
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByTestId("moderation-selected-account")).toBeVisible();
}

/** Bans or restores whichever account the panel currently has selected. */
async function moderateSelectedAccount(
  page: Page,
  action: "ban" | "restore",
): Promise<void> {
  await page
    .getByTestId(action === "ban" ? "ban-account-button" : "restore-account-button")
    .click();
  await expect(page.getByTestId("moderation-feedback")).toContainText(
    action === "ban" ? "is banned" : "has been restored",
  );
}

/** The test id of the single row a locator must have narrowed down to. */
async function historyEntryId(entry: Locator): Promise<string> {
  await expect(entry).toHaveCount(1);
  const entryId = await entry.getAttribute("data-testid");
  if (!entryId) throw new Error("A moderation history row has no test id");
  return entryId;
}

/**
 * Types one exact filter set into the panel, applies it, and returns once
 * the server has answered that same query.
 */
async function applyHistoryFilters(
  page: Page,
  filters: { targetUserId?: string; actorUserId?: string },
): Promise<void> {
  // Built in the order the panel adds them, so the awaited query string
  // matches the request character for character.
  const params = new URLSearchParams();
  if (filters.targetUserId) params.set("targetUserId", filters.targetUserId);
  if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
  const query = params.toString();
  const applied = historyResponse(page, query ? `?${query}` : "");
  await page
    .getByTestId("moderation-history-target-filter")
    .fill(filters.targetUserId ?? "");
  await page
    .getByTestId("moderation-history-actor-filter")
    .fill(filters.actorUserId ?? "");
  await page.getByTestId("moderation-history-filter-apply").click();
  expect((await applied).status()).toBe(200);
}

/**
 * A history row named by where it sits in the set being checked.
 *
 * Nothing said about a failure in the history log may name a row: its test
 * ID is an account's own id, and the administrator's name beside it is an
 * account's too. A position says which row a check stopped on without
 * carrying either, and says the same thing on a run whose accounts are
 * different ones.
 */
function historyRowPosition(index: number, count: number): string {
  return `row ${index + 1} of ${count}`;
}

/**
 * The name the panel shows for the administrator behind one history row.
 * It is recorded with the action from that administrator's own account, so
 * it is the name they are known by here rather than one this test supplies.
 */
async function historyActorName(list: Locator, entryId: string): Promise<string> {
  const name = (await list.getByTestId(`${entryId}-filter-actor`).innerText()).trim();
  expect(name).not.toBe("");
  return name;
}
/**
 * The administrator filter answers "what did this administrator change?",
 * which is the question asked when one administrator's decisions are
 * reviewed. This drives all three ways into it -- typing an administrator
 * ID, choosing an administrator by name from the picker, and tapping an
 * administrator's name on a history row -- across actions taken by two
 * different administrators, and checks that the account filter still
 * narrows the result alongside it.
 *
 * Two disposable accounts are used: one only the first administrator acts
 * on, and one both act on. That way a filter wired to the target instead of
 * the actor, sent under the wrong parameter, or dropped altogether produces
 * a list this can tell apart from the correct one.
 */
async function verifyHistoryActorFilter(
  browser: Browser,
  primary: ModeratorCredentials,
  secondary: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  let stage = "disposable account creation";
  try {
    const soleTarget = await accounts.create("target");
    const sharedTarget = await accounts.create("target");

    stage = "the first administrator's panel";
    const primaryPage = await accounts.administrator(
      browser,
      administratorLogin(primary),
    );
    await openProfile(primaryPage.page);
    await expect(primaryPage.page.getByTestId("moderation-panel")).toBeVisible();

    stage = "the first administrator's actions";
    await selectAccount(primaryPage.page, soleTarget);
    await moderateSelectedAccount(primaryPage.page, "ban");
    await moderateSelectedAccount(primaryPage.page, "restore");
    await selectAccount(primaryPage.page, sharedTarget);
    await moderateSelectedAccount(primaryPage.page, "ban");

    stage = "the second administrator's panel";
    const secondaryPage = await accounts.administrator(
      browser,
      administratorLogin(secondary),
    );
    await openProfile(secondaryPage.page);
    await expect(
      secondaryPage.page.getByTestId("moderation-panel"),
    ).toBeVisible();
    // Both configured administrators have to be separate accounts, or
    // nothing below could tell one administrator's actions from another's.
    expect(secondaryPage.userId).not.toBe(primaryPage.userId);

    stage = "the second administrator's action";
    await selectAccount(secondaryPage.page, sharedTarget);
    await moderateSelectedAccount(secondaryPage.page, "restore");

    const list = primaryPage.page.getByTestId("moderation-history-list");
    /**
     * Checks one filtered list against the rows it has to show and the rows
     * it has to have dropped, in the order they are given.
     *
     * Three of the stages below check a whole set of rows this way, so a
     * stop inside one of them would otherwise say only which filter was
     * being applied -- leaving which row, and which way it went wrong, to
     * be found by instrumenting this again and re-running it against the
     * previews. Each row therefore names itself as it is checked, by where
     * it sits in the set and by whether it had to be on the list; never by
     * the row, whose test ID is an account's id.
     *
     * The order within a set is the caller's to decide: the panel keeps the
     * previous result until the new one arrives, so rows the filter has to
     * add come before rows it has to drop wherever the list this replaces
     * held them.
     */
    const expectFilteredRows = async (
      rows: readonly { entryId: string; shown: boolean }[],
    ): Promise<void> => {
      const filter = stage;
      for (const [index, row] of rows.entries()) {
        stage = `${filter}: ${historyRowPosition(index, rows.length)}, which had to be ${
          row.shown ? "on the list" : "gone from it"
        }`;
        const entry = list.getByTestId(row.entryId);
        if (row.shown) await expect(entry).toBeVisible();
        else await expect(entry).toHaveCount(0);
      }
      // Whatever follows the set belongs to the stage, not to its last row.
      stage = filter;
    };

    stage = "locating this run's history entries";
    await applyHistoryFilters(primaryPage.page, {
      targetUserId: soleTarget.id,
    });
    await expect(historyEntries(primaryPage.page)).toHaveCount(2);
    const soleEntryIds = (
      await historyEntries(primaryPage.page).evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-testid") ?? ""),
      )
    ).filter(Boolean);
    expect(soleEntryIds).toHaveLength(2);

    await applyHistoryFilters(primaryPage.page, {
      targetUserId: sharedTarget.id,
    });
    await expect(historyEntries(primaryPage.page)).toHaveCount(2);
    // The two administrators took different actions on the shared account,
    // so each row is identified by its action rather than by a display name
    // the two accounts could share.
    const sharedBanId = await historyEntryId(
      historyEntries(primaryPage.page).filter({ hasText: " banned " }),
    );
    const sharedRestoreId = await historyEntryId(
      historyEntries(primaryPage.page).filter({ hasText: " restored " }),
    );
    // A list still showing the previous filter's rows would repeat its ids.
    expect(soleEntryIds).not.toContain(sharedBanId);
    expect(soleEntryIds).not.toContain(sharedRestoreId);

    stage = "the names the two administrators are known by";
    const primaryName = await historyActorName(list, sharedBanId);
    const secondaryName = await historyActorName(list, sharedRestoreId);
    // The picker lists administrators by name, so these two have to be
    // distinguishable by name for anything below to mean much. An account
    // the identity provider returns no name for is shown by its id
    // instead, which is what an administrator would be picking blind.
    expect(secondaryName).not.toBe(secondaryPage.userId);
    expect(secondaryName).not.toBe(primaryName);

    stage = "the typed administrator filter";
    await applyHistoryFilters(primaryPage.page, {
      actorUserId: primaryPage.userId,
    });
    // Check the rows this filter has to add before the row it has to drop:
    // that row was on screen a moment ago, and the panel keeps the previous
    // result until the new one arrives, so the order keeps an absence check
    // from passing against the old list.
    await expectFilteredRows([
      ...soleEntryIds.map((entryId) => ({ entryId, shown: true })),
      { entryId: sharedBanId, shown: true },
      { entryId: sharedRestoreId, shown: false },
    ]);

    stage = "the administrator and account filters together";
    await applyHistoryFilters(primaryPage.page, {
      targetUserId: sharedTarget.id,
      actorUserId: primaryPage.userId,
    });
    // Exactly one of this run's four actions matches both filters. The
    // count also settles the list before the checks below, because the
    // administrator-filtered list it replaces held more than one row.
    await expect(historyEntries(primaryPage.page)).toHaveCount(1);
    await expectFilteredRows([
      { entryId: sharedBanId, shown: true },
      // Dropped for the account filter, and for the administrator filter.
      ...soleEntryIds.map((entryId) => ({ entryId, shown: false })),
      { entryId: sharedRestoreId, shown: false },
    ]);

    stage = "choosing the other administrator by name from the picker";
    // The picker has to reach the same administrator filter the typed field
    // does and leave the account filter alone, so the one action the first
    // administrator took on this account gives way to the one the second
    // took on it. Picking the administrator who is *not* signed in is what
    // a picker wired to the reader's own account could not survive.
    await pickHistoryActorByName(primaryPage.page, secondaryName, {
      userId: secondaryPage.userId,
      search: `?${new URLSearchParams({
        targetUserId: sharedTarget.id,
        actorUserId: secondaryPage.userId,
      }).toString()}`,
    });
    // Again the added row first: the row this replaces was on screen while
    // the new query was in flight.
    await expect(list.getByTestId(sharedRestoreId)).toBeVisible();
    await expect(list.getByTestId(sharedBanId)).toHaveCount(0);
    await expect(historyEntries(primaryPage.page)).toHaveCount(1);
    // The choice lands in the field the typed path reads, and the panel
    // names the picked administrator back instead of showing the id it
    // filtered by -- an administrator reviewing decisions has to be able to
    // see whose they are looking at.
    await expect(
      primaryPage.page.getByTestId("moderation-history-actor-filter"),
    ).toHaveValue(secondaryPage.userId);
    await expect(
      primaryPage.page.getByTestId("moderation-history-actor-picker-label"),
    ).toHaveText(`Admin: ${secondaryName}`);

    stage = "filtering from an administrator's name on a history row";
    const cleared = historyResponse(primaryPage.page, "");
    await primaryPage.page
      .getByTestId("moderation-history-filter-clear")
      .click();
    expect((await cleared).status()).toBe(200);
    // Tap the *other* administrator's name. A link that sent the row's
    // target, or whoever is signed in, would not survive that.
    await expect(list.getByTestId(sharedRestoreId)).toBeVisible();
    const tapped = historyResponse(
      primaryPage.page,
      `?${new URLSearchParams({ actorUserId: secondaryPage.userId }).toString()}`,
    );
    await list.getByTestId(`${sharedRestoreId}-filter-actor`).click();
    expect((await tapped).status()).toBe(200);
    await expect(
      primaryPage.page.getByTestId("moderation-history-actor-filter"),
    ).toHaveValue(secondaryPage.userId);
    // The first administrator's three actions leave the list -- checked
    // first, because they were all in the unfiltered list this replaces.
    await expectFilteredRows([
      ...soleEntryIds.map((entryId) => ({ entryId, shown: false })),
      { entryId: sharedBanId, shown: false },
      { entryId: sharedRestoreId, shown: true },
    ]);
  } catch {
    // The stage says where this stopped -- inside a set of rows, down to
    // the row's place in that set and the way it had to go -- without
    // naming accounts.
    throw new Error(
      `Moderation history administrator filter verification failed at ${stage}; credentials and provider details omitted`,
    );
  }
}

/**
 * Works the moderation log's administrator picker with the keyboard only:
 * opening it, stepping into and past the open list, choosing from it,
 * walking that list with the arrow keys, Home and End, picking from the
 * walk with Enter, backing out of it with Escape, and leaving it by moving
 * focus away.
 *
 * None of this can be checked without a browser. The picker names itself as
 * a control that opens a list of choices, which is what a screen reader
 * announces but also what decides the keys the browser handles by itself,
 * and whether an open list is left hanging over the filters below it is a
 * question about where focus went. How far a single Tab press carries is a
 * browser's arrangement too, and nothing else renders a tab order. The
 * walking keys are the same kind of question twice over: the browser has to
 * deliver them to the view the handling is attached to, and the row they
 * name has to be one that can take focus and stay on the screen once it
 * has.
 *
 * Every key pressed here is held to one more thing a browser alone can
 * show: the screen behind the picker stays where the reader left it. The
 * press that opens the list and the two that close it scroll a page by
 * default just as the walking keys do, and focus cannot report any of it,
 * so the screen itself is read across each of them.
 */
async function verifyHistoryActorPickerKeyboard(
  browser: Browser,
  moderator: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  let stage = "the administrator's panel";
  try {
    const { page } = await accounts.administrator(
      browser,
      administratorLogin(moderator),
    );
    await openProfile(page);
    await expect(page.getByTestId("moderation-panel")).toBeVisible();

    const toggle = page.getByTestId("moderation-history-actor-picker");
    const options = page.getByTestId("moderation-history-actor-options");
    await expect(toggle).toBeVisible();

    stage = "opening the picker from the keyboard";
    await openActorPickerFromKeyboard(page, toggle, options);

    stage = "stepping into and past the open list";
    // However many administrators are on it, the open list is one stop in
    // the tab order. The first Tab steps into it, landing on the option in
    // effect -- nothing is filtered yet, so that is the one keeping every
    // administrator in view.
    await page.keyboard.press("Tab");
    const enteredList = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        testID: active?.getAttribute("data-testid") ?? "",
        checked: active?.getAttribute("aria-checked") ?? "",
      };
    });
    expect(enteredList.testID).toBe("moderation-history-actor-option-any");
    expect(enteredList.checked).toBe("true");
    // The next press leaves the whole list rather than stopping on the
    // administrator below, which is the slow walk the arrow keys replaced.
    await page.keyboard.press("Tab");
    const stillOnARow = await page.evaluate(() =>
      (document.activeElement?.getAttribute("data-testid") ?? "").startsWith(
        "moderation-history-actor-option-",
      ),
    );
    expect(stillOnARow).toBe(false);
    // Focus is outside the picker now, which takes the open list with it.
    await expect(options).toBeHidden();

    stage = "choosing an administrator from the keyboard";
    await openActorPickerFromKeyboard(page, toggle, options);
    // Tab reaches the list and the arrow keys move within it, so one of
    // each lands on the first administrator below the option in effect.
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    const focusedOption = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        testID: active?.getAttribute("data-testid") ?? "",
        checked: active?.getAttribute("aria-checked") ?? "",
        // The row shows the administrator's email under their name, so the
        // name on its own is read from what the row is announced as.
        label: active?.getAttribute("aria-label") ?? "",
      };
    });
    expect(focusedOption.testID).toMatch(/^moderation-history-actor-option-/);
    // A choice out of a set has to say whether it is the one in effect, or
    // a screen reader reads the list without saying what is filtered by.
    expect(focusedOption.checked).toBe("false");
    const chosenUserId = focusedOption.testID.replace(
      "moderation-history-actor-option-",
      "",
    );
    const chosenName = /by admin (.+)$/.exec(focusedOption.label)?.[1] ?? "";
    expect(chosenName).not.toBe("");
    const picked = historyResponse(
      page,
      `?${new URLSearchParams({ actorUserId: chosenUserId }).toString()}`,
    );
    await page.keyboard.press("Space");
    expect((await picked).status()).toBe(200);
    await expect(options).toBeHidden();
    await expect(
      page.getByTestId("moderation-history-actor-picker-label"),
    ).toHaveText(`Admin: ${chosenName}`);

    stage = "walking the open list with the arrow keys";
    await openActorPickerFromKeyboard(page, toggle, options);
    // The walk is checked against the list the browser actually rendered,
    // in the order it rendered it, rather than against administrators named
    // here: the keys move between whatever rows are on screen.
    const optionIds = await options
      .getByTestId(/^moderation-history-actor-option-/)
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-testid") ?? ""),
      );
    // "Any administrator" and both configured administrators, at least. A
    // shorter list could not tell a step from a jump to the end, and the
    // administrator this walk picks below would be the one already chosen.
    expect(optionIds.length).toBeGreaterThanOrEqual(3);
    const lastOption = optionIds.length - 1;
    // The whole open list is brought into view before the walk, so nothing
    // in it has cause to be scrolled to afterwards: the screen behind it
    // that moves below moved because a key scrolled it.
    await options.scrollIntoViewIfNeeded();
    const restingOffset = await pickerScrollOffset(options);
    // Where focus is, as a position in the list read above, and -1 for
    // anywhere else. Read from the browser rather than from anything the
    // app draws: the row has to be the element the next key arrives at.
    // The position is what a failure below may say -- the row itself is
    // known by a test ID carrying an administrator's account id.
    const focusedPosition = async (): Promise<number> =>
      optionIds.indexOf(
        await page.evaluate(
          () => document.activeElement?.getAttribute("data-testid") ?? "",
        ),
      );
    const walk = [
      // Coming from the toggle, Down enters the list at its first row.
      { key: "ArrowDown", option: 0 },
      { key: "ArrowDown", option: 1 },
      { key: "ArrowUp", option: 0 },
      // The keys are for the list: a step off either end stays on that end
      // rather than wandering into the filters around it.
      { key: "ArrowUp", option: 0 },
      { key: "End", option: lastOption },
      { key: "ArrowDown", option: lastOption },
      { key: "Home", option: 0 },
      // And back to the last administrator, to pick below.
      { key: "End", option: lastOption },
    ];
    for (const [index, step] of walk.entries()) {
      const expected = optionIds[step.option]!;
      // Eight presses, and three separate rules held to each of them: a
      // failure naming the walk alone leaves the press it stopped on to be
      // found by instrumenting this again and re-running it against the
      // previews. So every press names itself, by its key and the place it
      // should land -- never by the row, whose id is an account's.
      const press = `walking the open list with the arrow keys, press ${
        index + 1
      } of ${walk.length} (${step.key}) expecting ${optionPosition(
        step.option,
        optionIds.length,
      )}`;
      stage = `${press}: focus did not reach that option`;
      await page.keyboard.press(step.key);
      try {
        await expect.poll(focusedPosition).toBe(step.option);
      } catch (missed) {
        // Where the press did land is the other half of the story: a key
        // that moved nothing reads differently from one that jumped to an
        // end, and neither is a row this may name.
        const landed = await focusedPosition();
        stage = `${press}: focus stopped ${
          landed < 0
            ? "outside the list"
            : `on ${optionPosition(landed, optionIds.length)}`
        }`;
        throw missed;
      }
      stage = `${press}: that option was not on the screen`;
      await expect(options.getByTestId(expected)).toBeInViewport();
      // Every one of these keys scrolls the screen behind the list by
      // default, which would carry the list being walked away under the
      // reader. Focus hides that on its own -- a browser scrolls whatever
      // it focuses back into view -- so the screen itself is read, on the
      // same terms as the presses that open and close the list: as the key
      // is answered, and again once the screen has stopped moving.
      stage = `${press}: the screen behind the list moved`;
      await expectPickerScreenUnmoved(options, restingOffset);
    }

    stage = "picking the walked-to administrator with Enter";
    const walkedTo = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        testID: active?.getAttribute("data-testid") ?? "",
        label: active?.getAttribute("aria-label") ?? "",
      };
    });
    const walkedUserId = walkedTo.testID.replace(
      "moderation-history-actor-option-",
      "",
    );
    const walkedName = /by admin (.+)$/.exec(walkedTo.label)?.[1] ?? "";
    expect(walkedName).not.toBe("");
    // The walk ended on an administrator other than the one chosen above,
    // so the query Enter runs is not the one already on screen.
    expect(walkedUserId).not.toBe(chosenUserId);
    const walked = historyResponse(
      page,
      `?${new URLSearchParams({ actorUserId: walkedUserId }).toString()}`,
    );
    await page.keyboard.press("Enter");
    expect((await walked).status()).toBe(200);
    await expect(options).toBeHidden();
    await expect(
      page.getByTestId("moderation-history-actor-picker-label"),
    ).toHaveText(`Admin: ${walkedName}`);

    stage = "backing out of the open picker";
    await openActorPickerFromKeyboard(page, toggle, options);
    const beforeEscape = await pickerScrollOffset(toggle);
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();
    // The row focus was on has just been removed, so focus has to be put
    // back on the toggle rather than left to fall to the top of the page.
    await expect(toggle).toBeFocused();
    // The key that closes the list is held to what the keys that walk it
    // are held to: the screen behind the picker stays where the reader
    // left it. Focus hides nothing here either -- a browser scrolls
    // whatever it focuses back into view, toggle included. The one
    // movement allowed is the pull-back closing the list can force on a
    // screen resting inside the room the list made.
    await expectPickerScreenUnmoved(toggle, beforeEscape, {
      closesTheList: true,
    });

    stage = "leaving the picker open behind the filters";
    // The tab stop before the toggle is brought into view first: focus
    // arriving there is entitled to scroll the screen if it is off it, and
    // that scroll is not the one being looked for.
    await page
      .getByTestId("moderation-history-actor-filter")
      .scrollIntoViewIfNeeded();
    await openActorPickerFromKeyboard(page, toggle, options);
    const beforeLeaving = await pickerScrollOffset(toggle);
    // Back past the toggle, out of the picker altogether: the list has to
    // close instead of staying open over the filter row below it.
    await page.keyboard.press("Shift+Tab");
    await expect(options).toBeHidden();
    await expectPickerScreenUnmoved(toggle, beforeLeaving, {
      closesTheList: true,
    });
  } catch {
    // The stage says where this stopped -- inside the walk, down to the
    // press and the rule it broke -- without naming accounts.
    throw new Error(
      `Moderation history administrator picker keyboard verification failed at ${stage}; credentials and provider details omitted`,
    );
  }
}

/**
 * A row of the open picker, named by where it sits in the list.
 *
 * Nothing said about a failure in the picker may name an administrator: a
 * row is known here by a test ID which is the account's own id, and the
 * name beside it is an account's too. A position says which press went
 * wrong without carrying either.
 */
function optionPosition(index: number, count: number): string {
  return `option ${index + 1} of ${count}`;
}

/**
 * Opens the picker with the space bar, and requires the screen behind it
 * to be where it was before the press.
 *
 * The space bar presses whatever is focused. A control naming itself as
 * something other than a button loses that unless the picker answers the
 * key itself -- and answering it includes taking the key away from the
 * browser, which would otherwise scroll the screen by a page, exactly as
 * the keys that walk the open list do. The list would then be drawn over a
 * log that had jumped out from under the reader as it opened.
 *
 * Focus can show none of that: it is on the toggle before the press and
 * still there afterwards, and a browser scrolls whatever it focuses back
 * into view. So the screen behind the picker is read across the press, and
 * it has to have somewhere left to scroll to for that reading to mean
 * anything.
 */
async function openActorPickerFromKeyboard(
  page: Page,
  toggle: Locator,
  options: Locator,
): Promise<void> {
  await toggle.focus();
  await expect(toggle).toBeFocused();
  // Read once focus has landed: bringing the toggle into view is the
  // browser's doing, not the press's.
  const before = await pickerScroll(toggle);
  await page.keyboard.press("Space");
  await expect(options).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // The browser scrolls after the app has answered the key, so the room a
  // dropped suppression would scroll into is the room left below the list
  // the app has just drawn. None of it, and this press could not have
  // moved anything for the reading below to catch.
  expect((await pickerScroll(toggle)).roomBelow).toBeGreaterThan(0);
  await expectPickerScreenUnmoved(toggle, before.offset);
}
/** How far the screen behind the picker has been scrolled. */
async function pickerScrollOffset(insidePicker: Locator): Promise<number> {
  return (await pickerScroll(insidePicker)).offset;
}
/**
 * Dismisses the moderation log's administrator picker the ordinary way --
 * by clicking away from it -- and then chooses from it with the same
 * pointer.
 *
 * Neither half can be checked without a browser. The panel's own wording
 * takes no focus, so a click on it leaves the picker nothing to read about
 * where focus went: closing the list rests on the press itself reaching the
 * screen around the picker, which means react-native-web has to hand a
 * plain view the browser's `pointerdown`. Choosing a row rests on the same
 * press arriving at the picker first and being recognised as its own, or
 * the row would be taken away before the click that lands on it.
 */
async function verifyHistoryActorPickerPointer(
  browser: Browser,
  moderator: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  let stage = "the administrator's panel";
  try {
    const { page } = await accounts.administrator(
      browser,
      administratorLogin(moderator),
    );
    await openProfile(page);
    await expect(page.getByTestId("moderation-panel")).toBeVisible();

    const toggle = page.getByTestId("moderation-history-actor-picker");
    const options = page.getByTestId("moderation-history-actor-options");
    await expect(toggle).toBeVisible();

    stage = "clicking away from the open picker";
    await toggle.click();
    await expect(options).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The line describing what the log records sits above the filters and
    // takes no focus, which is exactly the click that used to leave the
    // list hanging over the filter row below it.
    await page.getByTestId("moderation-history-scope").click();
    await expect(options).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    stage = "choosing an administrator with the pointer";
    await toggle.click();
    await expect(options).toBeVisible();
    // The rows are read from the open list rather than assumed: the first
    // one keeps every administrator in view, so the choice is made from
    // the ones that name an administrator.
    const optionIds = (
      await options
        .getByTestId(/^moderation-history-actor-option-/)
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-testid") ?? ""),
        )
    ).filter((id) => id && id !== "moderation-history-actor-option-any");
    expect(optionIds.length).toBeGreaterThan(0);
    const optionId = optionIds[0]!;
    const option = options.getByTestId(optionId);
    const chosenUserId = optionId.replace(
      "moderation-history-actor-option-",
      "",
    );
    // The row shows the administrator's email under their name, so the
    // name on its own is read from what the row is announced as.
    const rowLabel = (await option.getAttribute("aria-label")) ?? "";
    const chosenName = /by admin (.+)$/.exec(rowLabel)?.[1] ?? "";
    expect(chosenName).not.toBe("");

    const picked = historyResponse(
      page,
      `?${new URLSearchParams({ actorUserId: chosenUserId }).toString()}`,
    );
    await option.click();
    // A dismissal that swallowed this press would leave the query unmade,
    // the field below empty, and the closed picker still naming nobody.
    expect((await picked).status()).toBe(200);
    await expect(options).toBeHidden();
    await expect(
      page.getByTestId("moderation-history-actor-picker-label"),
    ).toHaveText(`Admin: ${chosenName}`);
    await expect(
      page.getByTestId("moderation-history-actor-filter"),
    ).toHaveValue(chosenUserId);
  } catch {
    // The stage name says where this stopped without naming accounts.
    throw new Error(
      `Moderation history administrator picker pointer verification failed at ${stage}; credentials and provider details omitted`,
    );
  }
}

/**
 * How long a role change pushed down the chat connection may take to reach
 * the room a member is sitting in.
 *
 * The app also re-reads the role on a timer while a screen that gates on it
 * is in view, but that interval is minutes long, so a change that only
 * arrived through that safety net could not land inside this window.
 */
const PUSHED_ROLE_CHANGE_TIMEOUT_MS = 30_000;

/**
 * Counts the role re-reads one page makes from this call onwards. A pushed
 * change carries the new role with it, so the controls have to follow it
 * without the app asking the server anything.
 */
function countRoleReads(page: Page): () => number {
  let reads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().split("?")[0]?.endsWith("/api/profile")
    ) {
      reads += 1;
    }
  });
  return () => reads;
}

/**
 * A second tab in a session that is already signed in. Nothing is typed: the
 * context holds the session, so the app opens straight on the room list.
 */
async function openSignedInTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(chatUrl!);
  await page
    .getByTestId("new-room-button")
    .waitFor({ state: "visible", timeout: 30_000 });
  return page;
}

/** Creates a room from the room list and returns the id it opened at. */
async function createRoom(page: Page, roomName: string): Promise<string> {
  await page.getByTestId("new-room-button").click();
  await page.getByTestId("room-name-input").fill(roomName);
  await Promise.all([
    page.waitForURL(/\/room\/[^/?#]+/),
    page.getByTestId("room-submit-button").click(),
  ]);
  const roomId = decodeURIComponent(
    new URL(page.url()).pathname.split("/").filter(Boolean).at(-1) ?? "",
  );
  expect(roomId).not.toBe("");
  return roomId;
}

/** The room list's entry for one room, whoever is in it. */
function roomJoinButton(page: Page, roomName: string): Locator {
  const escapedName = roomName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("button", {
    name: new RegExp(`^Join ${escapedName}, \\d+ online$`),
  });
}

/** The control for banning somebody else from the open room. */
function roomBanControl(page: Page): Locator {
  return page.getByRole("button", { name: /^Ban .+ from this room$/ });
}

/**
 * A grant or a revocation is pushed to the affected account over the chat
 * connection, and every screen reads the role from there. Each side of that
 * has its own test -- the server picking who to tell, the app applying what
 * it is told -- and both would still pass if the event or its payload field
 * were renamed on one side only. This drives the two halves together in a
 * browser: a member sits in a room while an administrator changes the role
 * from another session, and the in-room ban controls have to follow.
 *
 * The member is not the room's creator, because a creator can moderate their
 * own room whatever their account-wide role is. The administrator keeps the
 * room open in a second tab: the ban control is only offered for somebody
 * else in the room, and the panel that changes the role lives on the profile
 * screen the administrator's first tab already has open.
 */
async function verifyLiveRoomModeratorControls(
  browser: Browser,
  moderator: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  const roomName = `Live role ${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  let roomId = "";
  let stage = "disposable account creation";
  let failure: unknown;
  try {
    const member = await accounts.create("target");

    stage = "the administrator's panel";
    const administrator = await accounts.administrator(
      browser,
      administratorLogin(moderator),
    );
    await openProfile(administrator.page);
    await expect(administrator.page.getByTestId("moderation-panel")).toBeVisible();

    stage = "a room for the member to sit in";
    const roomHost = await openSignedInTab(administrator.context);
    roomId = await createRoom(roomHost, roomName);
    await expect(roomHost.getByTestId("room-participant-count")).toHaveText(
      "1 person",
    );

    stage = "the member joining the room";
    const memberSession = await accounts.signIn(browser, member);
    const memberPage = memberSession.page;
    const joinRoom = roomJoinButton(memberPage, roomName);
    await expect(joinRoom).toBeVisible();
    await joinRoom.click();
    await expect(memberPage.getByTestId("room-participant-count")).toHaveText(
      "2 people",
    );
    await memberPage.getByTestId("room-users-button").click();
    // The member list is open, somebody else is in it, and this account
    // cannot ban them: everything below is about the role alone.
    const memberList = memberPage.getByText("ONLINE", { exact: true });
    await expect(memberList).toBeVisible();
    const banControl = roomBanControl(memberPage);
    await expect(banControl).toHaveCount(0);
    const roleReads = countRoleReads(memberPage);

    stage = "granting moderator access while the member sits in the room";
    const readsBeforeGrant = roleReads();
    await selectAccount(administrator.page, member);
    await administrator.page.getByTestId("grant-moderator-button").click();
    await expect(
      administrator.page.getByTestId("moderator-feedback"),
    ).toContainText("can now moderate");
    await expect(
      administrator.page.getByTestId(`moderator-row-${member.id}`),
    ).toBeVisible();

    stage = "the controls arriving in the open room";
    // Nothing touches the member's page: no reload, no tab switch, no button
    // press. The controls have to arrive where the member is standing.
    await expect(banControl).toBeVisible({
      timeout: PUSHED_ROLE_CHANGE_TIMEOUT_MS,
    });
    // The notification carried the new role, so the app had no reason to ask
    // the server for it -- and a reload would have closed the member list.
    expect(roleReads()).toBe(readsBeforeGrant);
    await expect(memberList).toBeVisible();
    await expect(memberPage.getByTestId("room-composer")).toBeVisible();

    stage = "revoking moderator access while the member sits in the room";
    const readsBeforeRevoke = roleReads();
    await administrator.page
      .getByTestId(`revoke-moderator-${member.id}`)
      .click();
    await expect(
      administrator.page.getByTestId("moderator-feedback"),
    ).toContainText("can no longer moderate");

    stage = "the controls leaving the open room";
    await expect(banControl).toHaveCount(0, {
      timeout: PUSHED_ROLE_CHANGE_TIMEOUT_MS,
    });
    expect(roleReads()).toBe(readsBeforeRevoke);
    // The controls went, not the room, and not the list they were in: an
    // absent control in a closed list or an emptied room proves nothing.
    await expect(memberList).toBeVisible();
    await expect(memberPage.getByTestId("room-participant-count")).toHaveText(
      "2 people",
    );
    await expect(memberPage.getByTestId("room-composer")).toBeVisible();
  } catch {
    // The stage name says where this stopped without naming accounts.
    failure = new Error(
      `In-room moderator control verification failed at ${stage}; credentials and provider details omitted`,
    );
  }

  // The fixture owns the disposable account; the room this case opened is its
  // own. Its membership, message, and key rows go with it through the
  // schema's cascades.
  const [removal] = await Promise.allSettled([
    db
      .delete(roomsTable)
      .where(or(eq(roomsTable.id, roomId), eq(roomsTable.name, roomName))),
  ]);
  if (removal?.status === "rejected") {
    const cleanupFailure = new Error("Removing this case's room failed");
    throw failure
      ? new AggregateError(
          [failure, cleanupFailure],
          "In-room moderator control verification and cleanup both failed",
        )
      : cleanupFailure;
  }
  if (failure) throw failure;
}

/**
 * How long the app is given to reach an address a control sends it to. Long
 * enough for a preview that is still waking up, short enough that a control
 * that goes nowhere is reported rather than sat on.
 */
const ADDRESS_TIMEOUT_MS = 30_000;

for (const moderator of moderatorCredentials) {
  test(`${moderator.label} can manage an account while a non-moderator is denied`, async ({
    browser,
    moderationAccounts,
  }) => {
    test.setTimeout(180_000);

    await verifyModerator(browser, moderator, moderationAccounts);
  });
}

// One administrator is enough here: this covers the grant path itself, not
// each configured account's ability to reach the panel.
const grantingModerator = moderatorCredentials[0]!;
// Telling one administrator's actions from another's needs both.
const secondModerator = moderatorCredentials[1]!;

test("a granted moderator can moderate until the access is revoked", async ({
  browser,
  moderationAccounts,
}) => {
  test.setTimeout(240_000);

  await verifyModeratorLifecycle(browser, grantingModerator, moderationAccounts);
});

test("a member in a room sees the moderator controls change without reloading", async ({
  browser,
  moderationAccounts,
}) => {
  test.setTimeout(240_000);

  await verifyLiveRoomModeratorControls(
    browser,
    grantingModerator,
    moderationAccounts,
  );
});

test("moderation history older than the first page stays reachable", async ({
  browser,
  moderationAccounts,
}) => {
  test.setTimeout(240_000);

  await verifyHistoryPaging(browser, grantingModerator, moderationAccounts);
});

test("the history filter for an administrator lists that administrator's actions only", async ({
  browser,
  moderationAccounts,
}) => {
  test.setTimeout(240_000);

  await verifyHistoryActorFilter(
    browser,
    grantingModerator,
    secondModerator,
    moderationAccounts,
  );
});

test("the administrator picker can be opened, used and dismissed from the keyboard", async ({
  browser,
  moderationAccounts,
}) => {
  test.setTimeout(240_000);

  await verifyHistoryActorPickerKeyboard(
    browser,
    grantingModerator,
    moderationAccounts,
  );
});

test("the administrator picker closes when a click lands outside it", async ({
  browser,
  moderationAccounts,
}) => {
  test.setTimeout(240_000);

  await verifyHistoryActorPickerPointer(
    browser,
    grantingModerator,
    moderationAccounts,
  );
});

test("the room manager opens from the profile and is dismissed back to it", async ({
  browser,
  moderationAccounts,
}) => {
  test.setTimeout(180_000);

  await verifyRoomManagerNavigation(
    browser,
    grantingModerator,
    moderationAccounts,
  );
});

/**
 * Chooses an administrator from the history panel's picker by the name it
 * shows them under, and returns once the server has answered the query that
 * choice makes.
 *
 * The option is found by its name and only then checked against the id it
 * carries, so a picker row labelled with one administrator while wired to
 * another fails here instead of quietly filtering by the wrong account.
 */
async function pickHistoryActorByName(
  page: Page,
  name: string,
  expected: { userId: string; search: string },
): Promise<void> {
  await page.getByTestId("moderation-history-actor-picker").click();
  const option = page
    .getByTestId("moderation-history-actor-options")
    .getByTestId(/^moderation-history-actor-option-/)
    .filter({ has: page.getByText(name, { exact: true }) });
  await expect(option).toBeVisible();
  expect(await option.getAttribute("data-testid")).toBe(
    `moderation-history-actor-option-${expected.userId}`,
  );
  const picked = historyResponse(page, expected.search);
  await option.click();
  expect((await picked).status()).toBe(200);
}

/**
 * Reads the moderation log's scroll position, first moving it to `offset`
 * when one is given.
 *
 * The element that scrolls is found from the list rather than assumed: the
 * rows belong to the profile screen's list, so the scrolling element is the
 * list itself or one of its ancestors.
 */
async function historyScroll(
  page: Page,
  offset?: number,
): Promise<HistoryScrollPosition> {
  const position = await page
    .getByTestId("moderation-history-list")
    .evaluate((list, requested: number | null) => {
      let scroller: HTMLElement | null = list as HTMLElement;
      while (
        scroller &&
        !(
          /^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY) &&
          scroller.scrollHeight > scroller.clientHeight
        )
      ) {
        scroller = scroller.parentElement;
      }
      if (!scroller) return null;
      const above = scroller.querySelector(
        '[data-testid="profile-content-header"]',
      );
      if (!above) return null;
      if (requested !== null) {
        // The scrolling element carries a `scrollTo` of the app framework's
        // own, which takes a different argument and animates, so the
        // browser's own is called directly and instantly: the position read
        // back below is then the one that was asked for rather than one part
        // way through an animation.
        const scrollTo = Element.prototype.scrollTo as (
          this: Element,
          options: ScrollToOptions,
        ) => void;
        scrollTo.call(scroller, { top: requested, behavior: "instant" });
      }
      return {
        offset: scroller.scrollTop,
        newestEntryOffset: above.getBoundingClientRect().height,
        maxOffset: scroller.scrollHeight - scroller.clientHeight,
      };
    }, offset ?? null);
  if (!position) {
    throw new Error("The moderation log has nothing that scrolls");
  }
  return position;
}

/**
 * Requires the screen behind the picker to be where the reader left it,
 * both as the key is answered and once the browser has finished whatever
 * scrolling it began.
 *
 * Both readings are taken because a browser animates the scroll a key asks
 * for. One taken the instant the key is answered catches a few pixels of a
 * scroll that ends hundreds away, which is a difference but one read off a
 * race with an animation; one taken after it has stopped moving is the
 * whole of it, but would forgive a screen jerked away and put back. So the
 * reading is repeated until it settles, and the first and the last both
 * have to be the offset the screen was left at.
 *
 * A key that closes the open list is read with the one allowance below,
 * asked for by `closesTheList`; every other key is held to the offset
 * itself.
 */
async function expectPickerScreenUnmoved(
  insidePicker: Locator,
  restingOffset: number,
  { closesTheList = false }: { closesTheList?: boolean } = {},
): Promise<void> {
  const expectHeld = (reading: PickerScreenScroll): void => {
    if (closesTheList && pickerScreenPulledBack(reading, restingOffset)) return;
    expect(reading.offset).toBe(restingOffset);
  };
  let reading = await pickerScroll(insidePicker);
  expectHeld(reading);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await insidePicker.page().waitForTimeout(100);
    const next = await pickerScroll(insidePicker);
    if (next.offset === reading.offset) break;
    reading = next;
  }
  expectHeld(reading);
}

/**
 * Whether a reading is a pull-back the browser had no choice about.
 *
 * Closing the list takes its rows out of the panel that scrolls, so the
 * panel gets shorter by their height. A screen resting inside the room
 * they made is then past the end of what is left, and the browser has to
 * pull it back to that end. That is a scroll nothing did wrong, and the
 * rule above would report it as the log jumping away. The administrators
 * configured today cannot produce one -- their open list fits, and the log
 * rests where the closed panel can still hold it -- but a taller list or a
 * shorter window can.
 *
 * That alone is forgiven, and only for the keys that close the list: the
 * screen has to have ended above where it was left with nothing below it
 * left to scroll to, which is as far back as the browser had to pull it
 * and no further. A pull-back past that end, or any movement at all while
 * the end is still below where the screen was left, is a scroll something
 * could have declined and still fails. The one thing this cannot tell
 * apart is a screen scrolled away that ends at that same end, which the
 * browser would have held there too.
 *
 * The room left below is read to the nearest pixel: a browser reports the
 * panel's height and its own rounded to one while the offset itself keeps
 * its fraction, so a screen held at the end can report a fraction of a
 * pixel of room either way.
 */
function pickerScreenPulledBack(
  reading: PickerScreenScroll,
  restingOffset: number,
): boolean {
  return reading.offset < restingOffset && Math.abs(reading.roomBelow) <= 1;
}

/**
 * Reads the screen behind the picker.
 *
 * The element that scrolls is found from the picker rather than assumed:
 * the history filters are drawn above the log's rows, inside the view that
 * scrolls them both. Any part of the picker finds it -- the toggle, which
 * is there whether the list is open or not, or the open list itself.
 *
 * Where nothing behind the picker scrolls, both numbers come back as -1:
 * an offset that cannot change makes every check below pass without having
 * been asked anything, so the opener above fails on the room instead.
 */
async function pickerScroll(
  insidePicker: Locator,
): Promise<PickerScreenScroll> {
  return insidePicker.evaluate((element) => {
    let scroller: HTMLElement | null = element as HTMLElement;
    while (
      scroller &&
      !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return { offset: -1, roomBelow: -1 };
    return {
      offset: scroller.scrollTop,
      roomBelow:
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
    };
  });
}

/** The screen behind the picker, as the keys pressed on it could move it. */
type PickerScreenScroll = {
  /** How far it has been scrolled, or -1 where nothing there scrolls. */
  offset: number;
  /** How much further a key's default scroll could carry it, or -1. */
  roomBelow: number;
};

/**
 * The room manager is the one administrator's screen with no tab of its own:
 * it is opened by a control on the profile, over that screen, and is
 * dismissed back to it. Both ends of that are the router's, and the
 * rendering test covering the control mocks the router away -- it ends at
 * the address the press asks for. A route the root stack no longer holds, a
 * screen that opens with nothing to dismiss it, and a way back that lands on
 * another tab each leave that test green while stranding the administrator
 * who pressed the control, so the trip is made here in a browser.
 *
 * Nothing is created, banned or granted along the way: this reads the
 * administrator the suite already signs in, and the room manager only lists
 * rooms that are already there.
 */
async function verifyRoomManagerNavigation(
  browser: Browser,
  moderator: ModeratorCredentials,
  accounts: ModerationAccounts,
): Promise<void> {
  let stage = "the administrator's profile";
  try {
    const { page } = await accounts.administrator(
      browser,
      administratorLogin(moderator),
    );
    await openProfile(page);
    // Which screen the app is showing is its address, not what is in the
    // page: both tab screens stay in it, controls and all, whichever one is
    // in front. So the profile is waited for by address before the way back
    // is taken from it -- a tab press that stopped navigating would
    // otherwise record the room list's address as the one to come back to,
    // and coming back to the room list would pass.
    await page.waitForURL((url) => url.pathname.endsWith("/profile"), {
      timeout: ADDRESS_TIMEOUT_MS,
    });
    // Where the app stands as the control is pressed, to hold the way back
    // to this exact address rather than to any profile screen.
    const profileAddress = page.url();
    const openRoomManager = page.getByTestId("open-room-manager-button");
    await expect(openRoomManager).toBeVisible();

    stage = "opening the room manager";
    await openRoomManager.click();
    const roomManagerTitle = page.getByText("Room Manager", { exact: true });
    await expect(roomManagerTitle).toBeVisible();
    // The address is the router's own answer: a screen drawn without the
    // route behind it would still be a screen, but not one the app navigated
    // to and can navigate back out of.
    //
    // Both waits below are given a bound of their own. A page's wait for an
    // address runs to the case's whole timeout by default, so a way in or
    // out that never arrives would spend minutes before reporting the
    // address it was left at.
    await page.waitForURL((url) => url.pathname.endsWith("/admin-rooms"), {
      timeout: ADDRESS_TIMEOUT_MS,
    });
    // Opened, and then done opening: the list it went for has arrived or
    // failed, so the way back is pressed on a screen at rest rather than on
    // one still loading. Either outcome is the room manager -- whether the
    // rooms themselves load is not what this case is about.
    await expect(
      page
        .getByLabel("Room list", { exact: true })
        .or(page.getByTestId("admin-rooms-error-state")),
    ).toBeVisible();

    stage = "dismissing the room manager";
    const goBack = page.getByRole("button", { name: "Go back", exact: true });
    await expect(goBack).toBeVisible();
    await goBack.click();
    await expect(roomManagerTitle).toBeHidden();

    stage = "the screen the room manager was opened from";
    // Not merely off the manager: back at the exact address the control was
    // pressed from. Each tab has an address of its own -- the app opens on
    // the room list's -- so a way back that lands on the app's default
    // screen rather than the one it was opened over fails here.
    await page.waitForURL((url) => url.href === profileAddress, {
      timeout: ADDRESS_TIMEOUT_MS,
    });
    // The two tab screens are both in the page whichever is showing, so the
    // address is what tells them apart. What the profile screen is read for
    // is that it came back whole: the control that opened the manager is
    // there to be pressed again.
    await expect(page.getByTestId("profile-screen")).toBeVisible();
    await expect(openRoomManager).toBeVisible();
  } catch {
    // The stage name says where this stopped without naming accounts.
    throw new Error(
      `Room manager navigation verification failed at ${stage}; credentials and provider details omitted`,
    );
  }
}
