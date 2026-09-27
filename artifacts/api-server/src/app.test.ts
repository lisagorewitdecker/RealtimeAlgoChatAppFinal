import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAuth = vi.hoisted(() => vi.fn());
const mockAnthropicStream = vi.hoisted(() => vi.fn());
const mockKickRoomMember = vi.hoisted(() => vi.fn());
const mockKickRoomUser = vi.hoisted(() => vi.fn());
const mockDisconnectBannedUser = vi.hoisted(() => vi.fn());
const mockSetAccountBan = vi.hoisted(() => vi.fn());
const mockRecordModerationAction = vi.hoisted(() => vi.fn());
const mockVerifyWebhook = vi.hoisted(() => vi.fn());
const mockSyncModeratorProfileAfterIdentityChange = vi.hoisted(() => vi.fn());

vi.mock("@clerk/express", () => ({
  getAuth: mockGetAuth,
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  verifyToken: vi.fn(),
}));

// Signature verification itself is covered against the real Clerk verifier in
// app.clerkWebhookSignature.test.ts; this suite mocks it to exercise the
// routing, raw-body, and secret-selection behaviour around it.
vi.mock("@clerk/express/webhooks", () => ({
  verifyWebhook: mockVerifyWebhook,
}));

// The routes this suite drives through the real app read and write rows,
// so the rows live in memory rather than behind a query that answers
// nothing: a ban is checked by reading the ban that was stored, and the
// admin room list is built from real members and messages. The drizzle
// operators go with it, since the stand-in reads the conditions they
// build.
vi.mock("@workspace/db", async () => {
  const { createInMemoryDatabaseModule } = await import(
    "./testing/databaseDouble.js"
  );
  return createInMemoryDatabaseModule();
});

vi.mock("drizzle-orm", async () => {
  const { createDrizzleOperatorModule } = await import(
    "./testing/databaseDouble.js"
  );
  return createDrizzleOperatorModule();
});

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { stream: mockAnthropicStream } },
}));

vi.mock("./socket", () => ({
  closeRoom: vi.fn(),
  disconnectBannedUser: mockDisconnectBannedUser,
  getRooms: vi.fn(),
  kickRoomMember: mockKickRoomMember,
  kickRoomUser: mockKickRoomUser,
}));

vi.mock("./lib/accountAccess", () => ({
  getAccountAccess: vi.fn(),
  isAdmin: vi.fn(),
  isConfiguredAdmin: vi.fn(),
  setAccountBan: mockSetAccountBan,
}));

vi.mock("./lib/accountProfile", () => ({
  getAccountProfile: vi.fn(),
  normalizeProfileAvatar: vi.fn(),
  normalizeProfileUsername: vi.fn(),
  searchAccounts: vi.fn(),
  syncUserPublicKey: vi.fn(),
  syncModeratorProfileAfterIdentityChange:
    mockSyncModeratorProfileAfterIdentityChange,
  updateAccountProfile: vi.fn(),
}));

vi.mock("./lib/moderationHistory", () => ({
  buildModerationActionRecord: vi.fn(),
  listModerationActions: vi.fn(),
  recordModerationAction: mockRecordModerationAction,
}));

vi.mock("./lib/roomAccess", () => ({
  createRoomAccessCapability: vi.fn(),
  verifyRoomAccessCapability: vi.fn(),
}));

import {
  db,
  messagesTable,
  roomBansTable,
  roomMembersTable,
  roomsTable,
} from "@workspace/db";
import app from "./app.js";
import {
  getAccountAccess,
  isAdmin,
  setAccountBan,
} from "./lib/accountAccess.js";
import { getAccountProfile } from "./lib/accountProfile.js";
import {
  listModerationActions,
  recordModerationAction,
} from "./lib/moderationHistory.js";
import { createRoomAccessCapability } from "./lib/roomAccess.js";
import {
  disconnectBannedUser,
  getRooms,
  kickRoomMember,
  kickRoomUser,
} from "./socket.js";

let server: Server;
let baseUrl: string;
const originalAdminUserIds = process.env["ADMIN_USER_IDS"];
const originalClerkWebhookSecret = process.env["CLERK_WEBHOOK_SIGNING_SECRET"];
// Generated locally in Clerk/Svix's format: the route now shape-checks the
// configured value before verifying, so a placeholder string would be
// rejected as a misconfiguration before the (mocked) verifier is reached.
const testClerkWebhookSecret = `whsec_${randomBytes(24).toString("base64")}`;

beforeAll(async () => {
  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server");
  }
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
  if (originalAdminUserIds === undefined) {
    delete process.env["ADMIN_USER_IDS"];
  } else {
    process.env["ADMIN_USER_IDS"] = originalAdminUserIds;
  }
  if (originalClerkWebhookSecret === undefined) {
    delete process.env["CLERK_WEBHOOK_SIGNING_SECRET"];
  } else {
    process.env["CLERK_WEBHOOK_SIGNING_SECRET"] = originalClerkWebhookSecret;
  }
});

beforeEach(async () => {
  // A mounted protected route must reach the auth boundary, not a 404, without
  // contacting Clerk, the database, or any downstream service.
  mockGetAuth.mockReset().mockReturnValue({ userId: null });
  for (const table of [
    messagesTable,
    roomBansTable,
    roomMembersTable,
    roomsTable,
  ]) {
    await db.delete(table);
  }
  mockAnthropicStream.mockReset().mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Smoke-test assistant reply." },
      };
    },
  });
  vi.mocked(getAccountAccess).mockReset().mockResolvedValue({ allowed: true });
  vi.mocked(getAccountProfile).mockReset().mockResolvedValue({
    username: "Ada",
    avatarEmoji: "👩‍💻",
  });
  vi.mocked(isAdmin).mockReset().mockResolvedValue(false);
  vi.mocked(createRoomAccessCapability)
    .mockReset()
    .mockReturnValue("smoke-capability");
  vi.mocked(listModerationActions).mockReset().mockResolvedValue({
    entries: [],
    nextCursor: null,
  });
  vi.mocked(recordModerationAction).mockReset().mockResolvedValue(undefined);
  vi.mocked(setAccountBan).mockReset().mockResolvedValue(undefined);
  vi.mocked(kickRoomMember).mockReset();
  vi.mocked(kickRoomUser).mockReset().mockResolvedValue(undefined);
  vi.mocked(disconnectBannedUser).mockReset();
  vi.mocked(getRooms).mockReset().mockResolvedValue([]);
  mockVerifyWebhook.mockReset().mockResolvedValue({
    type: "user.updated",
    data: { id: "user-ada" },
  });
  mockSyncModeratorProfileAfterIdentityChange.mockReset().mockResolvedValue(
    undefined,
  );
  process.env["ADMIN_USER_IDS"] = "user-ada";
  process.env["CLERK_WEBHOOK_SIGNING_SECRET"] = testClerkWebhookSecret;
});

const protectedClientRoutes = [
  ["GET", "/api/profile"],
  ["PUT", "/api/profile"],
  ["GET", "/api/rooms"],
  ["GET", "/api/rooms/call?roomId=room-42"],
  ["GET", "/api/rooms/sandbox?roomId=room-42"],
  ["POST", "/api/ai/code-assist"],
  ["GET", "/api/moderation/search?query=ada"],
  ["GET", "/api/moderation/history"],
  ["POST", "/api/moderation/room-42/kick"],
  ["POST", "/api/moderation/room-42/ban"],
  ["POST", "/api/moderation/ban"],
  ["DELETE", "/api/moderation/ban/user-ben"],
  ["GET", "/api/admin/rooms"],
  ["PATCH", "/api/admin/rooms/room-42/close"],
  ["DELETE", "/api/admin/rooms/room-42"],
] as const;

describe("production API router", () => {
  it.each(protectedClientRoutes)(
    "mounts %s %s before authentication and dependencies run",
    async (method, path) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body:
          method === "PUT" || method === "POST"
            ? JSON.stringify({ messages: [{ role: "user", content: "hello" }] })
            : undefined,
      });

      expect(
        response.status,
        `${method} ${path} returned 404: the client route is missing from app.ts`,
      ).not.toBe(404);
      expect(response.status).toBe(401);
      expect(mockGetAuth).toHaveBeenCalled();
    },
  );

  describe("signed-in requests through the production app", () => {
    beforeEach(() => {
      mockGetAuth.mockReturnValue({ userId: "user-ada" });
    });

    it("returns the authenticated profile response", async () => {
      const response = await fetch(`${baseUrl}/api/profile`);

      expect(
        response.status,
        "a missing mount must remain distinguishable from auth or handler failures",
      ).toBe(200);
      expect(await response.json()).toEqual({
        profile: { username: "Ada", avatarEmoji: "👩‍💻" },
        isAdmin: false,
      });
    });

    it("returns room data and a call document with a signed-in capability", async () => {
      const roomsResponse = await fetch(`${baseUrl}/api/rooms`);
      expect(roomsResponse.status).toBe(200);
      expect(await roomsResponse.json()).toEqual({ rooms: [] });

      const callResponse = await fetch(`${baseUrl}/api/rooms/call?roomId=room-42`);
      const callDocument = await callResponse.text();
      expect(callResponse.status).toBe(200);
      expect(callResponse.headers.get("content-type")).toContain("text/html");
      expect(callDocument).toContain("room-42");
      expect(callDocument).toContain("smoke-capability");
    });

    it("completes an assistant request and returns its streamed response", async () => {
      const response = await fetch(`${baseUrl}/api/ai/code-assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Say hello." }],
        }),
      });
      const stream = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(stream).toContain("Smoke-test assistant reply.");
      expect(stream).toContain('"done":true');
    });

    it("returns moderation history for an authenticated administrator", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      const response = await fetch(`${baseUrl}/api/moderation/history`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ actions: [], nextCursor: null });
    });

    it("completes a signed-in room kick through the production router", async () => {
      vi.mocked(kickRoomMember).mockResolvedValue("ok");
      const response = await fetch(`${baseUrl}/api/moderation/room-42/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-ben" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(kickRoomMember).toHaveBeenCalledWith(
        "room-42",
        "user-ada",
        "user-ben",
      );
    });

    it("persists a signed-in room ban and kicks the target through the production router", async () => {
      // The route bans on behalf of the room's creator, so the room has
      // to be one this account really created.
      await db
        .insert(roomsTable)
        .values({ id: "room-42", name: "Room 42", createdBy: "user-ada" });

      const response = await fetch(`${baseUrl}/api/moderation/room-42/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "user-ben",
          reason: "Repeated disruption",
        }),
      });
      const body = (await response.json()) as { expiresAt?: unknown };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ ok: true, isPermanent: false });
      expect(body.expiresAt).toEqual(expect.any(String));
      // The ban is in the table the next join reads, not merely reported.
      const storedBans = await db
        .select({
          roomId: roomBansTable.roomId,
          userId: roomBansTable.userId,
          bannedBy: roomBansTable.bannedBy,
          isPermanent: roomBansTable.isPermanent,
          reason: roomBansTable.reason,
        })
        .from(roomBansTable);
      expect(storedBans).toEqual([
        {
          roomId: "room-42",
          userId: "user-ben",
          bannedBy: "user-ada",
          isPermanent: false,
          reason: "Repeated disruption",
        },
      ]);
      expect(kickRoomUser).toHaveBeenCalledWith("room-42", "user-ben", true);
    });

    it("returns success for account ban and restore through the production router", async () => {
      vi.mocked(isAdmin).mockImplementation(
        async (userId) => userId === "user-ada",
      );
      const banResponse = await fetch(`${baseUrl}/api/moderation/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-ben" }),
      });
      const restoreResponse = await fetch(
        `${baseUrl}/api/moderation/ban/user-ben`,
        { method: "DELETE" },
      );

      expect(banResponse.status).toBe(200);
      expect(await banResponse.json()).toEqual({ ok: true });
      expect(restoreResponse.status).toBe(200);
      expect(await restoreResponse.json()).toEqual({ ok: true });
      expect(setAccountBan).toHaveBeenNthCalledWith(1, "user-ben", true);
      expect(setAccountBan).toHaveBeenNthCalledWith(2, "user-ben", false);
      expect(disconnectBannedUser).toHaveBeenCalledWith("user-ben");
      expect(recordModerationAction).toHaveBeenCalledWith(
        "ban",
        "user-ada",
        "user-ben",
      );
      expect(recordModerationAction).toHaveBeenCalledWith(
        "restore",
        "user-ada",
        "user-ben",
      );
    });

    it("distinguishes a missing route from auth and downstream failures", async () => {
      const missingRouteResponse = await fetch(
        `${baseUrl}/api/moderation/not-a-route`,
      );
      expect(missingRouteResponse.status).toBe(404);

      mockGetAuth.mockReturnValue({ userId: null });
      const unauthorizedResponse = await fetch(
        `${baseUrl}/api/moderation/room-42/kick`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      expect(unauthorizedResponse.status).toBe(401);

      mockGetAuth.mockReturnValue({ userId: "user-ada" });
      vi.mocked(kickRoomMember).mockRejectedValue(new Error("socket unavailable"));
      const downstreamFailureResponse = await fetch(
        `${baseUrl}/api/moderation/room-42/kick`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "user-ben" }),
        },
      );
      expect(downstreamFailureResponse.status).toBe(500);
      expect(await downstreamFailureResponse.json()).toEqual({
        error: "Internal server error",
      });
    });

    it("returns admin room data through the database boundary", async () => {
      // Room administration goes through the same moderator check as the
      // moderation panel, so a database-granted moderator reaches it too.
      vi.mocked(isAdmin).mockResolvedValue(true);
      await db.insert(roomsTable).values([
        {
          id: "room-42",
          name: "Room 42",
          createdBy: "user-ada",
          createdAt: new Date(1_000),
        },
        {
          id: "room-99",
          name: "Room 99",
          createdBy: "user-ben",
          createdAt: new Date(2_000),
        },
      ]);
      await db.insert(roomMembersTable).values([
        { roomId: "room-42", userId: "user-ada" },
        { roomId: "room-42", userId: "user-ben" },
        { roomId: "room-99", userId: "user-ben" },
      ]);
      await db.insert(messagesTable).values([
        {
          id: "message-1",
          roomId: "room-42",
          userId: "user-ada",
          username: "Ada",
          type: "text",
          timestampMs: 1_700_000_000_000,
        },
        {
          id: "message-2",
          roomId: "room-42",
          userId: "user-ben",
          username: "Ben",
          type: "text",
          timestampMs: 1_700_000_005_000,
          // Deleted after the others, so a listing that ignored deletion
          // would report this as the room's last activity.
          deletedAt: new Date(),
        },
      ]);
      const reads = vi.spyOn(db, "select");

      const response = await fetch(`${baseUrl}/api/admin/rooms`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        rooms: [
          {
            id: "room-42",
            name: "Room 42",
            createdBy: "user-ada",
            createdAt: 1_000,
            isActive: true,
            memberCount: 2,
            lastActivityAt: 1_700_000_000_000,
          },
          {
            id: "room-99",
            name: "Room 99",
            createdBy: "user-ben",
            createdAt: 2_000,
            isActive: true,
            memberCount: 1,
            lastActivityAt: null,
          },
        ],
      });
      // Three reads for any number of rooms: the counts and the last
      // activity are gathered in one query each, not per room.
      expect(reads).toHaveBeenCalledTimes(3);
      reads.mockRestore();
    });
  });

  it("keeps the socket client vendor path mounted by app.ts", async () => {
    const response = await fetch(`${baseUrl}/api/socket-client.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/javascript",
    );
  });

  it("routes signed Clerk updates using the original raw request body", async () => {
    const rawBody = '{ "type": "user.updated",  "data": { "id": "user-ada" } }';
    mockVerifyWebhook.mockImplementation(async (req: { body: unknown }) => {
      expect(Buffer.isBuffer(req.body)).toBe(true);
      expect((req.body as Buffer).toString("utf8")).toBe(rawBody);
      return { type: "user.updated", data: { id: "user-ada" } };
    });

    const response = await fetch(`${baseUrl}/api/webhooks/clerk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mockSyncModeratorProfileAfterIdentityChange).toHaveBeenCalledWith(
      "user-ada",
    );
  });

  it("rejects Clerk webhook requests that fail signature verification", async () => {
    mockVerifyWebhook.mockRejectedValue(new Error("invalid signature"));

    const response = await fetch(`${baseUrl}/api/webhooks/clerk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(400);
    expect(mockSyncModeratorProfileAfterIdentityChange).not.toHaveBeenCalled();
  });

  it("fails closed when the environment-specific webhook secret is missing", async () => {
    delete process.env["CLERK_WEBHOOK_SIGNING_SECRET"];

    const response = await fetch(`${baseUrl}/api/webhooks/clerk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(503);
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
    expect(mockSyncModeratorProfileAfterIdentityChange).not.toHaveBeenCalled();
  });

  it("fails closed when the configured secret is not a usable Svix secret", async () => {
    // The endpoint id sits directly above the signing secret in the Svix
    // portal and is the value most often copied by mistake. Before this
    // check it reached the verifier and every delivery came back 400,
    // which looks like a sender problem rather than a configuration one.
    process.env["CLERK_WEBHOOK_SIGNING_SECRET"] =
      "ep_2pLm9QdVn3XcTbA7yRkWfZs4HgJ";

    const response = await fetch(`${baseUrl}/api/webhooks/clerk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(503);
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
    expect(mockSyncModeratorProfileAfterIdentityChange).not.toHaveBeenCalled();
  });

  it("does not use the development signing key for production webhooks", async () => {
    const previousNodeEnv = process.env["NODE_ENV"];
    const previousProductionSecret =
      process.env["CLERK_WEBHOOK_SIGNING_SECRET_PRODUCTION"];
    process.env["NODE_ENV"] = "production";
    process.env["CLERK_WEBHOOK_SIGNING_SECRET"] = testClerkWebhookSecret;
    delete process.env["CLERK_WEBHOOK_SIGNING_SECRET_PRODUCTION"];

    const response = await fetch(`${baseUrl}/api/webhooks/clerk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (previousNodeEnv === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = previousNodeEnv;
    }
    if (previousProductionSecret === undefined) {
      delete process.env["CLERK_WEBHOOK_SIGNING_SECRET_PRODUCTION"];
    } else {
      process.env["CLERK_WEBHOOK_SIGNING_SECRET_PRODUCTION"] =
        previousProductionSecret;
    }

    expect(response.status).toBe(503);
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
    expect(mockSyncModeratorProfileAfterIdentityChange).not.toHaveBeenCalled();
  });
});