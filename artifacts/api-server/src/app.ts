import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import pinoHttp from "pino-http";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import router, { API_MOUNT_PATH } from "./routes";
import { CLERK_WEBHOOK_ROUTE } from "./routes/clerkWebhook";
import { logger } from "./lib/logger";
import { isAllowedOrigin } from "./lib/origins";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { Sentry } from "./lib/sentry";

const app: Express = express();
const require = createRequire(import.meta.url);
const socketClientScript = join(
  dirname(require.resolve("socket.io")),
  "..",
  "client-dist",
  "socket.io.js",
);
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(
  clerkMiddleware((req) => {
    const host = getClerkProxyHost(req);
    return process.env["NODE_ENV"] === "production" && host
      ? { proxyUrl: `https://${host}${CLERK_PROXY_PATH}` }
      : {};
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
  }),
);
// Keep the exact signed request bytes available to Clerk's webhook verifier.
// Both halves of the path come from the same constants the route is mounted
// with, so neither the API prefix nor the route segment can drift away from
// the parser and hand the verifier a re-serialized body.
app.use(
  `${API_MOUNT_PATH}${CLERK_WEBHOOK_ROUTE}`,
  express.raw({ type: "application/json" }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "ready",
    api: API_MOUNT_PATH,
    healthCheck: `${API_MOUNT_PATH}/healthz`,
  });
});
app.get(`${API_MOUNT_PATH}/socket-client.js`, (_req, res) => {
  res
    .type("application/javascript")
    .sendFile(socketClientScript, { dotfiles: "allow" });
});
app.use(API_MOUNT_PATH, router);

// Forward unhandled route errors to Sentry (grouped, searchable issues)
// before falling back to a generic JSON response.
Sentry.setupExpressErrorHandler(app);

app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Capture explicitly rather than relying solely on
    // setupExpressErrorHandler's auto-instrumentation, which is unreliable
    // in a bundled (single-file) build where import-in-the-middle has
    // nothing separate to hook.
    Sentry.captureException(err);
    logger.error({ err }, "Unhandled request error");
    if (res.headersSent) {
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
