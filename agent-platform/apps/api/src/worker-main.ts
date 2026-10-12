import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db.js";
import { Worker } from "./worker.js";

const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
await migrate(db); // advisory-locked; safe alongside the API
const worker = new Worker(
  { db, masterKey: cfg.PLATFORM_MASTER_KEY },
  { concurrency: cfg.WORKER_CONCURRENCY, leaseMs: cfg.WORKER_LEASE_MS, pollMs: cfg.WORKER_POLL_MS },
);
worker.start();
console.log(`worker ${worker.id} started`);
const stop = async () => { await worker.stop(); await db.end(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
