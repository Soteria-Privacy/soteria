import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler, notFound } from "./middleware/error.js";
import type { Repositories } from "./repositories/types.js";
import type { SolanaService } from "./services/solana.js";
import { healthRoutes } from "./routes/health.js";
import { announcementRoutes } from "./routes/announcements.js";
import { setRoutes } from "./routes/sets.js";
import { groupRoutes } from "./routes/groups.js";
import { relayRoutes } from "./routes/relay.js";
import { poolRoutes } from "./routes/pool.js";
import { confidentialRoutes } from "./routes/confidential.js";

export interface AppDeps {
  repos: Repositories;
  solana: SolanaService | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Behind a Tor onion there is no real client IP and forwarded headers are
  // attacker-controlled, so by default we don't trust them.
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  // Request logging with no client-identifying metadata: a request serializer
  // that emits only method + url (no remoteAddress, no headers), and request
  // ids generated server-side so a client can't supply a correlatable one.
  let reqCounter = 0;
  app.use(
    pinoHttp({
      logger,
      genReqId: () => `r${(reqCounter = (reqCounter + 1) >>> 0)}`,
      serializers: config.LOG_IP
        ? undefined
        : {
            req: (req: { method?: string; url?: string }) => ({
              method: req.method,
              url: req.url,
            }),
          },
    })
  );

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      // Over Tor every request arrives from 127.0.0.1, so per-IP limiting is
      // meaningless and would also mean reading a client IP. Use one shared
      // bucket; rely on the onion service's proof-of-work for DoS defense
      // (HiddenServicePoWDefensesEnabled in deploy/tor/torrc).
      keyGenerator: config.LOG_IP ? undefined : () => "shared",
      validate: config.LOG_IP ? undefined : { trustProxy: false, xForwardedForHeader: false },
    })
  );

  app.use(healthRoutes(deps));
  app.use(announcementRoutes(deps));
  app.use(setRoutes(deps));
  app.use(groupRoutes(deps));
  app.use(relayRoutes(deps));
  app.use(confidentialRoutes(deps));
  app.use(poolRoutes(deps));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
