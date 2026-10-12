import { EventEmitter } from "node:events";
import type { Db } from "./db.js";

export type RunEvent = { id: number; run_id: string; type: string; data: Record<string, unknown>; at: string };

/**
 * Persist-then-publish run events. Persisted rows are the source of truth (SSE replays from them);
 * the emitter only provides low-latency fan-out inside this process.
 * Phase 2 swaps the emitter for Redis pub/sub so multiple API replicas/workers share a feed.
 */
export class RunBus {
  private ee = new EventEmitter().setMaxListeners(0);
  constructor(private db: Db) {}

  async emit(runId: string, type: string, data: Record<string, unknown> = {}): Promise<RunEvent> {
    const { rows } = await this.db.query(
      "INSERT INTO run_events(run_id, type, data) VALUES ($1,$2,$3) RETURNING id, run_id, type, data, at",
      [runId, type, JSON.stringify(data)],
    );
    const ev = rows[0] as RunEvent;
    this.ee.emit(runId, ev);
    return ev;
  }

  subscribe(runId: string, fn: (e: RunEvent) => void): () => void {
    this.ee.on(runId, fn);
    return () => this.ee.off(runId, fn);
  }
}
