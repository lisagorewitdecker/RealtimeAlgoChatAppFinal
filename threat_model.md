# Threat Model

## Project Overview

DevStudio ("Realtime DevAlgoChatApp") is a real-time developer collaboration app:
end-to-end-encrypted chat rooms, WebRTC calls, a shared code sandbox, moderation,
and an AI coding assistant (Anthropic Claude).

- **API:** Express 5 + Socket.IO (`artifacts/api-server`), TypeScript, esbuild CJS bundle.
- **Client:** Expo / React Native / React Native Web (`artifacts/chat-app`).
- **Canvas:** Vite component preview sandbox (`artifacts/mockup-sandbox`) — dev-only design tool.
- **Auth:** Clerk (session tokens verified server-side via `@clerk/backend`/`@clerk/express`).
- **DB:** PostgreSQL + Drizzle ORM (`lib/db`).
- **Deployment:** Replit Autoscale, public visibility, primary URL
  `https://realtime-algo-chat-app.replit.app`.

## Assets

- **User accounts & sessions** — Clerk identities, session tokens, admin/moderator status.
- **Room content** — chat messages (E2E encrypted ciphertext + nonce), sandbox code state,
  room key envelopes (per-user encrypted room keys), participant lists.
- **Application secrets** — `SESSION_SECRET` (HMAC key for room-access capabilities),
  `CLERK_SECRET_KEY`, Anthropic integration credentials, `DATABASE_URL`, `SENTRY_DSN`.
- **Moderation state** — account bans, room bans, kick cooldowns, moderation audit history.
- **AI capacity/cost** — Anthropic Claude usage billed per token.

## Trust Boundaries

- **Client → API (HTTP)** — every `/api/*` request; client is untrusted. Auth via Clerk
  Bearer token (`requireAuth` / `requireAuthorizedUser`).
- **Client → API (Socket.IO)** — handshake authenticated by either a Clerk session token
  or an HMAC-signed room-access capability (`lib/roomAccess.ts`); origin checked via
  `allowRequest`.
- **API → PostgreSQL** — all queries via Drizzle (parameterized).
- **API → Clerk / Anthropic** — server-to-server with secret keys.
- **User → Admin/Moderator** — privilege determined server-side by the `ADMIN_USER_IDS` env var
  (bootstrap list) OR a row in the `moderators` table granted by an existing moderator
  through `routes/moderation.ts`; every grant and revoke is written to moderation history.
  A verified primary email matching the hardcoded moderator list (`lib/profileIdentity.ts`)
  is used for profile identity only, not for privilege.
- **Public rooms** — active rooms are listed to any authorized user and joinable by any
  authorized user by design; room confidentiality is *not* a per-room access boundary
  (E2E keys are distributed to any joiner).

## Scan Anchors

- Production entry points: `artifacts/api-server/src/app.ts`, `routes/index.ts`
  (mounted at `/api`: `health`, `/ai`, `/admin`, `/profile`, `/rooms`, `/moderation`),
  and `socket.ts` (Socket.IO at `/api/socket.io`).
- Auth/authorization core: `middlewares/requireAuth.ts`, `lib/requireAccountAccess.ts`,
  `lib/accountAccess.ts`, `lib/roomAccess.ts`, `lib/profileIdentity.ts`,
  `routes/admin.ts` (`requireAdmin`).
- Highest-risk surfaces: AI endpoints (`routes/ai.ts`, socket `assistant-request`,
  `lib/sandboxAssistant.ts`), moderation (`routes/moderation.ts`), room lifecycle
  (`socket.ts` join/close/kick/ban, key-envelope distribution).
- `routes/crypto.ts` and `routes/vendor.ts` exist but are NOT mounted in `routes/index.ts`
  (dead code); `socket-client.js` is served directly from `app.ts`.
- Dev-only / usually ignore unless proven reachable: `artifacts/mockup-sandbox`
  (Vite design canvas, `/__mockup`).
- Client-side admin gating (`EXPO_PUBLIC_ADMIN_USER_IDS` in the Expo app) is UI-only and
  is NOT a security control; server enforces admin independently.

## Threat Categories

### Spoofing / Improper Authentication

Socket handshakes and HTTP requests are authenticated with Clerk. Room-access capabilities
are HMAC-SHA256 signed with `SESSION_SECRET`, are short-lived (2 min TTL), verified with a
timing-safe comparison, and bind userId/roomId/purpose. Guarantee: every sensitive endpoint
must establish a trusted subject server-side before returning data or performing actions,
and admin/moderator status must never be derived from client input.

### Elevation of Privilege

Admin actions (`/api/admin/*`, `/api/moderation/*` global ban/search/history) must be gated
by `isAdmin` server-side (env allowlist or verified moderator email). Room moderation (kick/
ban/close) must verify the actor is room creator or admin. The hardcoded moderator email list
in `lib/profileIdentity.ts` grants admin purely by verified primary email — it must remain
tightly controlled and should ideally move to configuration/secret rather than source.

### Information Disclosure

Rooms are intentionally public/open; there is no cross-room confidentiality boundary. Message
bodies are E2E encrypted. Moderation search/history (which expose emails) are admin-only.
Guarantee: no secrets in client bundles (only publishable Clerk key is exposed, which is
correct); error responses must not leak internals.

### Denial of Service / Cost Abuse

AI (Anthropic) calls are expensive. The Socket.IO assistant path enforces `purpose === sandbox`,
a per-user cooldown, single-in-flight, and a timeout. The HTTP `/api/ai/code-assist` route does
NOT rate-limit and does not re-check account access (ban/verified). No global HTTP rate limiter
exists. Guarantee: authenticated cost-bearing endpoints should be throttled and should honor
account bans.
