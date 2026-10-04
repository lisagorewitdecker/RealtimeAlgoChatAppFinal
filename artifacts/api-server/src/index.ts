// Sentry must be initialized before anything else so it can capture errors
// thrown during startup (e.g. the PORT validation below).
import { Sentry } from "./lib/sentry";
import { createServer } from "node:http";
import { logger } from "./lib/logger";
import { reportServerConfigurationStatus } from "./lib/serverConfig";
import { registerShutdownHandlers } from "./lib/serverShutdown";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Checked before anything that consumes these settings is loaded: a missing
// or unusable value is reported once, loudly, instead of showing up later as
// a failing request nobody is watching for. Only a setting the API cannot
// serve anything without throws here; the rest degrade /api/healthz and
// startup continues.
reportServerConfigurationStatus();

// Imported after the checks above so a configuration fault is reported in
// the server's own words rather than as an error thrown from deep inside a
// dependency that a module-level import would reach first. The health
// monitor belongs in this group too: it remembers its alert cooldown in the
// database, so it reaches the same package the app and the socket setup do.
const { default: app } = await import("./app");
const { setupSocketIO } = await import("./socket");
const { startHealthMonitor } = await import("./lib/healthMonitor");

const httpServer = createServer(app);
const socketServer = setupSocketIO(httpServer);

httpServer.on("error", (err) => {
  Sentry.captureException(err);
  logger.error({ err }, "HTTP server error");
});

registerShutdownHandlers(process, socketServer);

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
  startHealthMonitor(port);
});
