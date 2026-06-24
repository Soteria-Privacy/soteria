import { pino } from "pino";
import { config } from "./config.js";

// Defense-in-depth: even if something logs a raw request, strip every field that
// could carry a client IP or identifying header. Disabled only when LOG_IP=true.
const ipRedactPaths = [
  "req.remoteAddress",
  "req.remotePort",
  "remoteAddress",
  "remotePort",
  'req.headers["x-forwarded-for"]',
  'req.headers["x-real-ip"]',
  "req.headers.forwarded",
  "req.headers.via",
  "req.headers.authorization",
  'req.headers["x-api-key"]',
  "req.headers.cookie",
];

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: config.LOG_IP ? [] : { paths: ipRedactPaths, remove: true },
  transport: config.isProd
    ? undefined
    : { target: "pino-pretty", options: { colorize: true } },
});
