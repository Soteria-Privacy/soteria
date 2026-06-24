import "dotenv/config";
import { z } from "zod";

// z.coerce.boolean treats any non-empty string (incl. "false") as true, so parse
// env booleans explicitly.
const envBool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined ? def : v === "true" || v === "1"),
    z.boolean()
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  DATABASE_URL: z.string().url().optional(),

  CORS_ORIGINS: z.string().default("*"),
  ADMIN_API_KEY: z.string().min(16).optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Network-metadata privacy. Defaults assume the service runs behind a Tor
  // onion (see scripts/onion.sh): there is no meaningful client IP, so we never
  // log one and never trust forwarded headers.
  LOG_IP: envBool(false),
  TRUST_PROXY: envBool(false),

  // Anonymity-set floor: refuse a withdrawal until the pool holds at least this
  // many deposits, so a user can't deanonymize themselves by withdrawing from a
  // pool that is effectively just their own deposit. 1 = no guard (dev only).
  POOL_MIN_ANONYMITY_SET: z.coerce.number().int().min(1).default(1),

  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  SOTERIA_PROGRAM_ID: z
    .string()
    .default("9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs"),
  RELAYER_SECRET_KEY: z.string().optional(),
  AUTHORITY_SECRET_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  corsOrigins: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(","),
  isProd: env.NODE_ENV === "production",
  capabilities: {
    database: Boolean(env.DATABASE_URL),
    adminAuth: Boolean(env.ADMIN_API_KEY),
    relayer: Boolean(env.RELAYER_SECRET_KEY),
    authority: Boolean(env.AUTHORITY_SECRET_KEY),
  },
};

export type Config = typeof config;
