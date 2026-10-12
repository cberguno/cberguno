import { createDb, migrate } from "./db.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const db = createDb(url);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
await db.end();
