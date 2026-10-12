import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { claimTask, completeWith, reapExpired } from "../src/queue.js";
import { plan, rig } from "./rig.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let r: Awaited<ReturnType<typeof rig>> | undefined;
const kids: ChildProcess[] = [];
afterEach(async () => {
  kids.splice(0).forEach((k) => k.kill("SIGKILL"));
  await r?.stop();
  r = undefined;
});

function spawnWorker(dbUrl: string, masterKey: string, leaseMs: number) {
  // a single node process (not the tsx wrapper, which forks a child): SIGKILL must hit the real worker
  const k = spawn(process.execPath, ["--import", "tsx", "src/worker-main.ts"], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl, PLATFORM_MASTER_KEY: masterKey, JWT_SECRET: "j".repeat(40), WORKER_LEASE_MS: String(leaseMs), WORKER_POLL_MS: "50", WORKER_CONCURRENCY: "4" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  kids.push(k);
  return new Promise<ChildProcess>((resolve, reject) => {
    k.stdout!.on("data", (d) => String(d).includes("started") && resolve(k));
    k.on("exit", (c) => reject(new Error(`worker exited early (${c})`)));
  });
}

const TASKS = ["a", "b", "c", "d"].map((k, i) => ({ key: k, title: `T-${k}`, assignee: i % 2 ? "Flights" : "Hotels", input: `unit-${k}` }));

describe("durability", () => {
  it("a worker process killed with SIGKILL mid-mission: another worker finishes it, completed work is not redone", async () => {
    // Task 'c' is slow; kill the first worker while it is in flight. Others finish quickly.
    r = await rig(({ user }) => {
      if (user.includes("Combine")) return "FINAL";
      if (user.includes("Your task: T-c")) return { status: 200, delayMs: 2500, body: { choices: [{ message: { content: "slow result" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
      return "quick result";
    });
    const w1 = await spawnWorker(r.fx.url, r.t.cfg.PLATFORM_MASTER_KEY, 1500);
    const id = await r.create({ plan: { tasks: TASKS }, options: { max_tasks: 10 } });

    // wait until the slow task is genuinely running and the quick ones are done
    for (let i = 0; i < 200; i++) {
      const m = await r.get(id);
      const s = Object.fromEntries(m.tasks.map((t: any) => [t.key, t.status]));
      if (s.c === "running" && s.a === "done" && s.b === "done" && s.d === "done") break;
      await new Promise((x) => setTimeout(x, 25));
    }
    const before = await r.get(id);
    expect(before.tasks.find((t: any) => t.key === "c").status).toBe("running");
    const doneBefore = before.tasks.filter((t: any) => t.status === "done").map((t: any) => t.key);
    expect(doneBefore).toEqual(expect.arrayContaining(["a", "b", "d"]));

    w1.kill("SIGKILL"); // no graceful shutdown: the lease is simply abandoned
    await new Promise((x) => setTimeout(x, 100));
    expect((await r.get(id)).tasks.find((t: any) => t.key === "c").status).toBe("running"); // still "running": nobody knows it died yet

    await spawnWorker(r.fx.url, r.t.cfg.PLATFORM_MASTER_KEY, 1500); // lease expires ~1.5s later; reaper requeues it
    const m = await r.waitFor(id, ["succeeded"], 20000);
    expect(m.output).toBe("FINAL");
    const c = m.tasks.find((t: any) => t.key === "c");
    expect(c.attempt).toBe(2); // the killed attempt counted
    // completed tasks were executed exactly once; only the interrupted one was re-run
    const ran = (k: string) => r!.v.calls.filter((x) => x.user.includes(`Your task: T-${k}\n`));
    for (const k of ["a", "b", "d"]) expect(ran(k)).toHaveLength(1);
    expect(ran("c")).toHaveLength(2);
    // usage is only recorded for completed calls; the killed call left no usage row
    const usage = await r.fx.db.query("SELECT count(*)::int n FROM usage_events WHERE task_id = (SELECT id FROM tasks WHERE mission_id=$1 AND key='c')", [id]);
    expect(usage.rows[0].n).toBe(1);
  }, 40000);

  it("fencing: a worker that lost its lease cannot write results after another worker took over", async () => {
    r = await rig(() => "x");
    const id = await r.create({ plan: { tasks: [TASKS[0]!] }, options: { max_tasks: 5 } });
    const t1 = (await claimTask(r.fx.db, "zombie", 100))!;
    expect(t1.key).toBe("a");
    await new Promise((x) => setTimeout(x, 150));
    expect(await reapExpired(r.fx.db)).toBe(1);
    const t2 = (await claimTask(r.fx.db, "healthy", 5000))!;
    expect(t2.id).toBe(t1.id);
    let wrote = false;
    const zombieOk = await completeWith(r.fx.db, t1, "zombie", async (q) => { wrote = true; await q.query("UPDATE tasks SET status='done', output='ZOMBIE' WHERE id=$1", [t1.id]); });
    expect(zombieOk).toBe(false);
    expect(wrote).toBe(false);
    const healthyOk = await completeWith(r.fx.db, t2, "healthy", async (q) => { await q.query("UPDATE tasks SET status='done', output='HEALTHY' WHERE id=$1", [t2.id]); });
    expect(healthyOk).toBe(true);
    expect((await r.fx.db.query("SELECT output FROM tasks WHERE id=$1", [t1.id])).rows[0].output).toBe("HEALTHY");
    void id;
  });

  it("a worker killed on every attempt eventually escalates instead of looping forever", async () => {
    r = await rig(() => "x");
    const id = await r.create({ plan: { tasks: [TASKS[0]!] }, options: { max_tasks: 5 } });
    for (let i = 0; i < 3; i++) {
      expect(await claimTask(r.fx.db, `dead-${i}`, 50)).not.toBeNull();
      await new Promise((x) => setTimeout(x, 80));
      await reapExpired(r.fx.db);
    }
    const m = await r.get(id);
    expect(m.status).toBe("needs_human");
    expect(m.escalation_reason).toMatch(/lost its worker 3 times/);
  });

  it("graceful shutdown hands in-flight tasks back without charging an attempt", async () => {
    r = await rig(({ user }) => (user.includes("Your task: T-a") ? { status: 200, delayMs: 3000, body: { choices: [{ message: { content: "late" } }], usage: {} } } : "ok"));
    const id = await r.create({ plan: { tasks: [TASKS[0]!] }, options: { max_tasks: 5 } });
    r.worker.start();
    for (let i = 0; i < 100 && (await r.get(id)).tasks.find((t: any) => t.key === "a").status !== "running"; i++) await new Promise((x) => setTimeout(x, 25));
    await r.worker.stop();
    const a = (await r.get(id)).tasks.find((t: any) => t.key === "a");
    expect(a).toMatchObject({ status: "queued", attempt: 0 });
  });
});
