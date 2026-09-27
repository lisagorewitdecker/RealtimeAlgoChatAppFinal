import { createClerkClient } from "@clerk/backend";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { db, messagesTable, pool, roomKeyEnvelopesTable, roomsTable, userProfilesTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { io as createSocket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import {
  browserTestWaiver,
  LAUNCH_SMOKE_SUITE,
} from "@workspace/browser-test-requirements";

// A run missing any of these settings has already been stopped by the
// config's globalSetup, before this file was loaded. The one way past it is
// the deliberate waiver, declared here at file scope so the case below is
// marked skipped as it is collected -- before a browser is launched or any
// disposable account is created -- and the run's own list still names the
// check it left out.
const waiver = browserTestWaiver(LAUNCH_SMOKE_SUITE);
test.skip(waiver.waived, waiver.reason);

const chatUrl = process.env["E2E_CHAT_URL"]!;
const apiUrl = process.env["E2E_API_URL"]!;
const publishableKey = process.env["CLERK_PUBLISHABLE_KEY"]!;
const secretKey = process.env["CLERK_SECRET_KEY"]!;
// Read at file scope, so it has to survive a waived run collecting this file
// with nothing configured; the cases that use it never run in that run.
const expectedApiHost = apiUrl ? new URL(apiUrl).host : "";

type DisposableUser = {
  id: string;
  email: string;
  password: string;
  token: string;
  username: string;
};

type SmokeRun = {
  clerkClient: ReturnType<typeof createClerkClient>;
  contexts: BrowserContext[];
  createdUserIds: string[];
  roomName: string;
  roomId: string;
  user?: DisposableUser;
  stage: string;
};

let activeRun: SmokeRun | undefined;

type ApiTraffic = {
  profile: boolean;
  sandbox: boolean;
  socket: boolean;
};

function watchApiTraffic(page: Page): ApiTraffic {
  const traffic: ApiTraffic = {
    profile: false,
    sandbox: false,
    socket: false,
  };
  const inspect = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl);
      if (url.host !== expectedApiHost) return;
      if (url.pathname === "/api/profile") traffic.profile = true;
      if (url.pathname === "/api/rooms/sandbox") traffic.sandbox = true;
      if (url.pathname.startsWith("/api/socket.io")) traffic.socket = true;
    } catch {
      // Ignore non-URL browser events; only routed API traffic is relevant.
    }
  };

  page.on("request", (request) => inspect(request.url()));
  page.on("websocket", (webSocket) => inspect(webSocket.url()));
  return traffic;
}

async function createSignedInPage(
  browser: Browser,
  user: DisposableUser,
  contexts: BrowserContext[],
  onPageCreated: (page: Page) => void,
): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  await setupClerkTestingToken({ context });
  const page = await context.newPage();
  onPageCreated(page);
  await page.goto(chatUrl);
  await page.getByPlaceholder("Email address").fill(user.email);
  await page.getByPlaceholder("Password").fill(user.password);
  await page.getByText("Sign in", { exact: true }).click();

  const verificationCode = page.getByPlaceholder("6-digit code");
  const setupName = page.getByPlaceholder("How should your team know you?");
  const roomList = page.getByTestId("new-room-button");
  await Promise.race([
    verificationCode.waitFor({ state: "visible" }),
    setupName.waitFor({ state: "visible" }),
    roomList.waitFor({ state: "visible" }),
  ]);
  if (await verificationCode.isVisible()) {
    await verificationCode.fill("424242");
    await page.getByText("Verify", { exact: true }).click();
    await Promise.race([
      setupName.waitFor({ state: "visible" }),
      roomList.waitFor({ state: "visible" }),
    ]);
  }
  if (await setupName.isVisible()) {
    await setupName.fill(user.username);
    await page.getByText("Enter workspace", { exact: true }).click();
  }
  await roomList.waitFor({ state: "visible" });
  return page;
}

function roomJoinButton(page: Page, roomName: string, onlineCount: number) {
  const escapedName = roomName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("button", {
    name: new RegExp(`^Join ${escapedName}, ${onlineCount} online$`),
  });
}

function waitForEvent(
  socket: ReturnType<typeof createSocket>,
  event: string,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error("socket event timeout"));
    }, timeoutMs);
    const onEvent = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.once(event, onEvent);
  });
}

async function closeServerRoom(roomId: string, token: string): Promise<void> {
  const socket = createSocket(apiUrl, {
    path: "/api/socket.io",
    transports: ["websocket", "polling"],
    reconnection: false,
    auth: { token },
  });
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", () => reject(new Error("socket connect failed")));
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("socket connect timeout")), 10_000),
      ),
    ]);

    const joined = waitForEvent(socket, "room-joined");
    socket.emit("join-room", { roomId, createIfMissing: false });
    await joined;

    const closed = waitForEvent(socket, "room-closed");
    socket.emit("close-room", { roomId });
    await closed;
  } finally {
    socket.disconnect();
  }
}

async function deleteClerkUserWithRetry(
  clerkClient: ReturnType<typeof createClerkClient>,
  userId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await clerkClient.users.deleteUser(userId);
      return;
    } catch {
      if (attempt === 4) throw new Error("Clerk account cleanup failed");
      await new Promise((resolve) =>
        setTimeout(resolve, 1_000 * 2 ** attempt),
      );
    }
  }
}

async function closeContextWithinTimeout(context: BrowserContext): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("context close timeout")), 10_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test.afterAll(async () => {
  await pool.end();
});

test.afterEach(async ({}, testInfo) => {
  const run = activeRun;
  activeRun = undefined;
  if (!run) return;

  let cleanupFailed = false;
  const contextResults = await Promise.allSettled(
    run.contexts.map(closeContextWithinTimeout),
  );
  if (contextResults.some((result) => result.status === "rejected")) {
    cleanupFailed = true;
  }

  let discoveredRoomIds: string[] = [];
  try {
    const rows = await db
      .select({ id: roomsTable.id })
      .from(roomsTable)
      .where(eq(roomsTable.name, run.roomName))
      .limit(5);
    discoveredRoomIds = rows.map((row) => row.id);
  } catch {
    cleanupFailed = true;
  }
  const roomIds = new Set([
    ...discoveredRoomIds,
    ...(run.roomId ? [run.roomId] : []),
  ]);

  if (run.user) {
    for (const id of roomIds) {
      try {
        await closeServerRoom(id, run.user.token);
      } catch {
        cleanupFailed = true;
      }
    }
  }

  try {
    const roomCondition = run.roomId
      ? or(eq(roomsTable.id, run.roomId), eq(roomsTable.name, run.roomName))
      : eq(roomsTable.name, run.roomName);
    await db.delete(roomsTable).where(roomCondition);
    if (run.createdUserIds.length > 0) {
      await db
        .delete(userProfilesTable)
        .where(eq(userProfilesTable.userId, run.createdUserIds[0]!));
    }
  } catch {
    cleanupFailed = true;
  }

  for (const userId of run.createdUserIds) {
    try {
      await deleteClerkUserWithRetry(run.clerkClient, userId);
    } catch {
      cleanupFailed = true;
    }
  }

  if (testInfo.status === "timedOut") {
    throw new Error(
      `[launch-smoke] ${run.stage} timed out${cleanupFailed ? "; disposable data cleanup also failed" : ""}.`,
    );
  }
  if (cleanupFailed) {
    throw new Error(
      `[launch-smoke] Disposable data cleanup failed${testInfo.status === "failed" ? ` after ${run.stage}` : ""}.`,
    );
  }
});

test("signed-in launch journey works through Expo, API, realtime, encryption, and assistant", async ({
  browser,
}) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const email = `launch-smoke-${suffix}+clerk_test@example.com`;
  const password = `E2e-${suffix}-Launch!9`;
  const username = `Launch ${suffix}`;
  const roomName = `Launch smoke ${suffix}`;
  const privateMessage = `private launch payload ${randomUUID()}`;
  const assistantPrompt =
    "Reply with this exact phrase and no other text: LAUNCH SMOKE CHECK PASSED";
  const clerkClient = createClerkClient({ publishableKey, secretKey });
  const run: SmokeRun = {
    clerkClient,
    contexts: [],
    createdUserIds: [],
    roomName,
    roomId: "",
    stage: "create disposable account",
  };
  activeRun = run;
  let user: DisposableUser | undefined;
  let roomId = "";

  try {
    const created = await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      firstName: "Launch",
      lastName: "Smoke",
      skipLegalChecks: true,
      privateMetadata: { purpose: "launch-smoke-e2e" },
    });
    run.createdUserIds.push(created.id);
    const session = await clerkClient.sessions.createSession({
      userId: created.id,
    });
    const token = await clerkClient.sessions.getToken(session.id, undefined, 300);
    user = { id: created.id, email, password, token: token.jwt, username };
    run.user = user;

    run.stage = "profile load";
    let traffic: ApiTraffic | undefined;
    const page = await createSignedInPage(browser, user, run.contexts, (createdPage) => {
      traffic = watchApiTraffic(createdPage);
    });
    run.stage = "profile greeting";
    await expect(page.getByText(/^Hi,\s+\S/)).toBeVisible();
    run.stage = "routed profile request";
    if (!traffic?.profile) throw new Error("profile did not use routed API");

    run.stage = "room create and realtime join";
    await page.getByTestId("new-room-button").click();
    await page.getByLabel("Room name").fill(roomName);
    await Promise.all([
      page.waitForURL(/\/room\/[^/?#]+/),
      page.getByTestId("room-submit-button").click(),
    ]);
    roomId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").filter(Boolean).at(-1) ?? "",
    );
    run.roomId = roomId;
    if (!roomId) throw new Error("room id missing");
    await expect(page.getByTestId("room-participant-count")).toHaveText("1 person");
    if (!traffic?.socket) throw new Error("realtime socket missed routed API");

    run.stage = "room-key creation";
    await expect
      .poll(
        async () => {
          const keyEnvelope = await db
            .select({ userId: roomKeyEnvelopesTable.userId })
            .from(roomKeyEnvelopesTable)
            .where(
              and(
                eq(roomKeyEnvelopesTable.roomId, roomId),
                eq(roomKeyEnvelopesTable.userId, created.id),
              ),
            )
            .limit(1);
          return keyEnvelope.length === 1;
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    run.stage = "encrypted message exchange";
    await page.getByPlaceholder("Message…").fill(privateMessage);
    await page.getByTestId("room-send-button").click();
    await expect(page.getByText(privateMessage, { exact: true })).toBeVisible();
    const storedMessage = await db
      .select({
        ciphertext: messagesTable.ciphertext,
        nonce: messagesTable.nonce,
      })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.roomId, roomId),
          eq(messagesTable.userId, user.id),
          eq(messagesTable.type, "text"),
        ),
      )
      .limit(1);
    if (
      !storedMessage[0]?.ciphertext ||
      !storedMessage[0].nonce ||
      storedMessage[0].ciphertext === privateMessage
    ) {
      throw new Error("message was not stored as ciphertext");
    }

    run.stage = "sandbox realtime join";
    await page.getByTestId("room-sandbox-button").click();
    const assistantFrame = page.frameLocator("iframe");
    await expect(assistantFrame.locator("#assistant-send")).toBeVisible();
    if (!traffic?.sandbox) throw new Error("sandbox did not use routed API");
    await expect(assistantFrame.locator("#sync-badge")).toHaveText("Synced");
    run.stage = "assistant response";
    await assistantFrame.locator("#assistant-input").fill(assistantPrompt);
    await assistantFrame.locator("#assistant-send").click();
    const assistantStatus = assistantFrame.locator("#assistant-status");
    const assistantOutput = assistantFrame.locator("#assistant-output");
    let assistantOutcome = "pending";
    await expect
      .poll(
        async () => {
          const status = (await assistantStatus.textContent())?.trim();
          if (status === "Response complete.") assistantOutcome = "complete";
          else if (status === "Thinking…" || !status) assistantOutcome = "pending";
          else if (status.startsWith("Rate limited.")) assistantOutcome = "rate limited";
          else if (status.startsWith("The coding assistant is unavailable."))
            assistantOutcome = "unavailable";
          else if (status.startsWith("Secure connection failed."))
            assistantOutcome = "connection failed";
          else if (status.startsWith("Join the sandbox room"))
            assistantOutcome = "request rejected";
          else assistantOutcome = "unexpected status";
          return assistantOutcome;
        },
        { timeout: 90_000 },
      )
      .not.toBe("pending");
    if (assistantOutcome !== "complete") {
      run.stage = `assistant ${assistantOutcome}`;
      throw new Error("assistant did not complete");
    }
    await expect
      .poll(
        async () => {
          const output = (await assistantOutput.textContent()) ?? "";
          const response = output.split("Assistant:").slice(1).join("Assistant:");
          return response.includes("LAUNCH SMOKE CHECK PASSED");
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    run.stage = "return from sandbox";
    await page.getByTestId("sandbox-back-button").click();
    await expect(page.getByTestId("room-back-button")).toBeVisible();
    run.stage = "leave room";
    await page.getByTestId("room-back-button").click();
    run.stage = "room list refresh after leaving";
    const offlineRoom = roomJoinButton(page, roomName, 0);
    await expect(offlineRoom).toBeVisible();
    run.stage = "rejoin room";
    await Promise.all([
      page.waitForURL(new RegExp(`/room/${roomId}(?:\\?|$)`)),
      offlineRoom.click(),
    ]);
    await expect(page.getByTestId("room-participant-count")).toHaveText("1 person");
    run.stage = "decrypt message after rejoin";
    await expect(page.getByText(privateMessage, { exact: true })).toBeVisible();
  } catch {
    throw new Error(
      `[launch-smoke] ${run.stage} failed. Credentials and private test content were omitted.`,
    );
  }
});