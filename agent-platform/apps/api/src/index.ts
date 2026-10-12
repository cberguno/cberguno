import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db.js";
import { recoverInterruptedRuns } from "./runtime.js";
import { Worker } from "./worker.js";

const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
const recovered = await recoverInterruptedRuns(db);
if (recovered) console.warn(`marked ${recovered} interrupted run(s) as failed`);

const app = await buildApp(db, cfg, { logger: true });
await app.listen({ port: cfg.PORT, host: cfg.HOST });

// Embedded worker: missions run in this process by default. Set WORKER_EMBEDDED=false and run worker-main.ts separately to scale out.
const worker = cfg.WORKER_EMBEDDED
  ? new Worker({ db, masterKey: cfg.PLATFORM_MASTER_KEY, allowPrivateHosts: cfg.TOOL_ALLOW_PRIVATE_HOSTS }, { concurrency: cfg.WORKER_CONCURRENCY, leaseMs: cfg.WORKER_LEASE_MS, pollMs: cfg.WORKER_POLL_MS })
  : null;
worker?.start();

const shutdown = async () => {
  await worker?.stop();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
