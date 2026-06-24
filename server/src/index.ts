import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";
import { buildDeps } from "./deps.js";
import { closePool } from "./db/client.js";

const app = createApp(buildDeps());

// Bind to HOST (127.0.0.1 by default) so the service is reachable only via the
// Tor onion, never directly from the public internet.
const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(`soteria server listening on http://${config.HOST}:${config.PORT}`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
