import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PLATFORM_MASTER_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  WEB_DIST: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  WORKER_EMBEDDED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  WORKER_LEASE_MS: z.coerce.number().int().min(1000).default(60000),
  WORKER_POLL_MS: z.coerce.number().int().min(50).default(500),
  TOOL_ALLOW_PRIVATE_HOSTS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Bootstrap: creates the first admin if the users table is empty.
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return parsed.data;
}
