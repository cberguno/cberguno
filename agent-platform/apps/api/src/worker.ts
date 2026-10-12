import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { consolidateMemories } from "./memory.js";
import type { LlmDeps } from "./llm.js";
import { claimTask, reapExpired } from "./queue.js";
import { executeTask } from "./taskRunner.js";

export type WorkerOpts = {
  id?: string; concurrency?: number; leaseMs?: number; pollMs?: number; reapMs?: number; backoffBaseMs?: number; consolidateEveryMs?: number;
};

/** Pulls tasks from the Postgres queue and executes them. Safe to run many instances (embedded in the API and/or standalone). */
export class Worker {
  readonly id: string;
  private opts: Required<Omit<WorkerOpts, "id">>;
  private running = false;
  private inflight = new Set<Promise<void>>();
  private shutdown = new AbortController();
  private loop?: Promise<void>;

  constructor(private deps: LlmDeps, opts: WorkerOpts = {}) {
    this.id = opts.id ?? `w-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.opts = {
      concurrency: opts.concurrency ?? 4, leaseMs: opts.leaseMs ?? 60_000, pollMs: opts.pollMs ?? 500,
      reapMs: opts.reapMs ?? 5_000, backoffBaseMs: opts.backoffBaseMs ?? 2_000, consolidateEveryMs: opts.consolidateEveryMs ?? 3_600_000,
    };
  }

  private get db(): Db { return this.deps.db; }

  /** Claim and start one task if there is capacity. Returns true if a task was started. */
  async tick(): Promise<boolean> {
    if (this.inflight.size >= this.opts.concurrency) return false;
    const task = await claimTask(this.db, this.id, this.opts.leaseMs);
    if (!task) return false;
    const p = executeTask({ ...this.deps, workerId: this.id, leaseMs: this.opts.leaseMs, backoffBaseMs: this.opts.backoffBaseMs, shutdown: this.shutdown.signal }, task)
      .catch((e) => console.error(`worker ${this.id}: task ${task.id} crashed: ${(e as Error).message}`))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
    return true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      let lastReap = 0, lastConsolidate = Date.now();
      while (this.running) {
        try {
          if (Date.now() - lastReap >= this.opts.reapMs) { lastReap = Date.now(); await reapExpired(this.db); }
          if (Date.now() - lastConsolidate >= this.opts.consolidateEveryMs) { lastConsolidate = Date.now(); await consolidateMemories(this.deps); }
          let started = false;
          while (this.running && (await this.tick())) started = true;
          if (!started) await new Promise((r) => setTimeout(r, this.opts.pollMs));
          else await new Promise((r) => setTimeout(r, 25));
        } catch (e) {
          console.error(`worker ${this.id}: loop error: ${(e as Error).message}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    })();
  }

  /** Graceful stop: in-flight tasks are aborted and handed back to the queue without charging an attempt. */
  async stop() {
    this.running = false;
    this.shutdown.abort();
    await this.loop;
    await Promise.allSettled([...this.inflight]);
  }
}
