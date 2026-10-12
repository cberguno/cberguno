import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db.js";
import { recoverInterruptedRuns } from "./runtime.js";

const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
const recovered = await recoverInterruptedRuns(db);
if (recovered) console.warn(`marked ${recovered} interrupted run(s) as failed`);

const app = await buildApp(db, cfg, { logger: true });
await app.listen({ port: cfg.PORT, host: cfg.HOST });

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
