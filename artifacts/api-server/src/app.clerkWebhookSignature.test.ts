import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

// This suite deliberately does NOT mock "@clerk/express/webhooks": it posts
// payloads signed with a locally generated secret through Clerk's real
// verifier, so a change to the body-parser order, the express.raw
// content-type match, or the webhook mount path in app.ts fails here instead
// of in production. No Clerk network access and no real signing secret are
// involved.

const mockSyncModeratorProfileAfterIdentityChange = vi.hoisted(() => vi.fn());

vi.mock("@clerk/express", () => ({
  clerkClient: { users: {} },
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
  verifyToken: vi.fn(),
}));

// Verifying a signature reads no stored state, so this suite gives the app
// a database it cannot query: a route that started reaching for one on the
// way to the webhook fails here instead of quietly finding nothing.
vi.mock("@workspace/db", async () => {
  const { createUnreachableDatabaseModule } = await import(
    "./testing/databaseDouble.js"
  );
  return createUnreachableDatabaseModule();
});

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { stream: vi.fn() } },
}));

vi.mock("./socket", () => ({
  closeRoom: vi.fn(),
  disconnectBannedUser: vi.fn(),
  getRooms: vi.fn(),
  kickRoomMember: vi.fn(),
  kickRoomUser: vi.fn(),
}));

vi.mock("./lib/accountProfile", () => ({
  getAccountProfile: vi.fn(),
  getAccountSnapshot: vi.fn(),
  normalizeAccountSearchQuery: vi.fn(),
  normalizeProfileAvatar: vi.fn(),
  normalizeProfileUsername: vi.fn(),
  searchAccounts: vi.fn(),
  syncUserPublicKey: vi.fn(),
  syncModeratorProfileAfterIdentityChange:
    mockSyncModeratorProfileAfterIdentityChange,
  updateAccountProfile: vi.fn(),
}));

import app from "./app.js";
// Follow the same constants the app mounts with: renaming the API prefix or
// the route segment keeps this end-to-end signature check pointed at the
// real endpoint, so it still fails if the raw-body parser drifts off it.
import { CLERK_WEBHOOK_ROUTE } from "./routes/clerkWebhook.js";
import { API_MOUNT_PATH } from "./routes/index.js";

let server: Server;
let baseUrl: string;
const originalClerkWebhookSecret = process.env["CLERK_WEBHOOK_SIGNING_SECRET"];
// A throwaway secret in Clerk's own format, so the suite never depends on a
// real signing secret being present in the environment.
const signingSecret = `whsec_${randomBytes(24).toString("base64")}`;

/**
 * Signs webhook content exactly as Clerk/Svix deliveries do: HMAC-SHA256 over
 * `<svix-id>.<svix-timestamp>.<raw body>` keyed by the base64-decoded secret.
 */
function signWebhookContent(
  webhookId: string,
  timestamp: number,
  rawBody: string,
): string {
  const key = Buffer.from(signingSecret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key)
    .update(`${webhookId}.${timestamp}.${rawBody}`)
    .digest("base64");
  return `v1,${signature}`;
}

const webhookId = "msg_local_signature_check";
// Signed bytes, not a signed object: the indentation here is only preserved
// if the raw request body reaches the verifier untouched. Re-serializing the
// parsed JSON would change these bytes and invalidate the signature.
const rawBody = `{
  "type": "user.updated",
  "object": "event",
  "data": { "id": "user-ada" }
}`;
let timestamp: number;

async function postSignedWebhook(rawBody: string, signature: string) {
  return fetch(`${baseUrl}${API_MOUNT_PATH}${CLERK_WEBHOOK_ROUTE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": webhookId,
      "svix-timestamp": String(timestamp),
      "svix-signature": signature,
    },
    body: rawBody,
  });
}

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
  if (originalClerkWebhookSecret === undefined) {
    delete process.env["CLERK_WEBHOOK_SIGNING_SECRET"];
  } else {
    process.env["CLERK_WEBHOOK_SIGNING_SECRET"] = originalClerkWebhookSecret;
  }
});

beforeEach(() => {
  mockSyncModeratorProfileAfterIdentityChange
    .mockReset()
    .mockResolvedValue(undefined);
  process.env["CLERK_WEBHOOK_SIGNING_SECRET"] = signingSecret;
  // Deliveries are only accepted inside Svix's timestamp tolerance.
  timestamp = Math.floor(Date.now() / 1000);
});

it("accepts a genuinely signed Clerk delivery through the real verifier", async () => {
  const response = await postSignedWebhook(
    rawBody,
    signWebhookContent(webhookId, timestamp, rawBody),
  );

  expect(
    response.status,
    "a valid signature must survive app.ts's body-parser chain and mount path",
  ).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  expect(mockSyncModeratorProfileAfterIdentityChange).toHaveBeenCalledWith(
    "user-ada",
  );
});

it("rejects a Clerk delivery whose signature was tampered with", async () => {
  const validSignature = signWebhookContent(webhookId, timestamp, rawBody);
  const signatureBytes = Buffer.from(
    validSignature.slice("v1,".length),
    "base64",
  );
  signatureBytes[0] ^= 0xff;
  const tamperedSignature = `v1,${signatureBytes.toString("base64")}`;

  const response = await postSignedWebhook(rawBody, tamperedSignature);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Invalid webhook signature.",
  });
  expect(mockSyncModeratorProfileAfterIdentityChange).not.toHaveBeenCalled();
});
