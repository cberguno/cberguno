import { afterEach, describe, expect, it } from "vitest";
import { fireDueSchedules, nextRun, ScheduleError } from "../src/schedules.js";
import { rig, type Script } from "./rig.js";

let r: Awaited<ReturnType<typeof rig>> | undefined;
afterEach(async () => { await r?.stop(); r = undefined; });

const TWO = { tasks: [{ key: "a", title: "A", assignee: "Flights", input: "do a" }, { key: "b", title: "B", assignee: "Hotels", input: "do b", depends_on: ["a"] }] };
const ok: Script = ({ user }) => (user.includes("Combine") ? "final" : "ok");

describe("cron", () => {
  it("computes next runs in the schedule's timezone, DST-aware", () => {
    const from = new Date("2026-03-07T12:00:00Z");
    expect(nextRun("0 9 * * *", "UTC", from).toISOString()).toBe("2026-03-08T09:00:00.000Z");
    // 09:00 New York is 14:00 UTC before US DST (Mar 8 2026) and 13:00 UTC after it
    expect(nextRun("0 9 * * *", "America/New_York", from).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(nextRun("0 9 * * *", "America/New_York", new Date("2026-03-08T15:00:00Z")).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(nextRun("*/15 * * * 1-5", "UTC", new Date("2026-10-12T10:07:00Z")).toISOString()).toBe("2026-10-12T10:15:00.000Z"); // a Monday
  });
  it("rejects malformed expressions and unknown timezones", () => {
    expect(() => nextRun("not a cron", "UTC", new Date())).toThrow(ScheduleError);
    expect(() => nextRun("* * * *", "UTC", new Date())).toThrow(/5 fields/);
    expect(() => nextRun("0 9 * * *", "Mars/Olympus", new Date())).toThrow(ScheduleError);
  });
});

describe("schedules", () => {
  const mk = (extra: object = {}, mission: object = {}) =>
    r!.op.post("/api/schedules", { name: `s${Math.random().toString(36).slice(2, 7)}`, cron: "0 7 * * *", timezone: "Europe/Lisbon", mission: { title: "Daily price check", goal: "Check fares", team_id: r!.team, plan: TWO, ...mission }, ...extra });

  it("validates cron, timezone and the mission template at creation; roles enforced", async () => {
    r = await rig(ok);
    const viewer = r.t.as(await r.t.mkUser("viewer"));
    expect((await viewer.post("/api/schedules", {})).statusCode).toBe(403);
    expect((await mk({ cron: "nonsense here ok" })).statusCode).toBe(400);
    expect((await mk({ timezone: "Mars/Olympus" })).statusCode).toBe(400);
    expect((await mk({}, { team_id: "00000000-0000-0000-0000-000000000000" })).statusCode).toBe(400);
    expect((await mk({}, { plan: { tasks: [{ key: "a", title: "A", assignee: "Ghost", input: "x" }] } })).json().error).toMatch(/not an active member/);
    const good = await mk();
    expect(good.statusCode).toBe(201);
    expect(new Date(good.json().next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect((await viewer.get("/api/schedules")).json()).toHaveLength(1);
  });

  it("fires due schedules, runs the mission to completion on a worker, and schedules the next slot", async () => {
    r = await rig(ok);
    const id = (await mk()).json().id;
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '1 minute'");
    expect(await fireDueSchedules(r.fx.db)).toBe(1);
    const s = (await r.fx.db.query("SELECT * FROM schedules WHERE id=$1", [id])).rows[0];
    expect(new Date(s.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(s.last_error).toBeNull();
    expect(await fireDueSchedules(r.fx.db)).toBe(0); // nothing is due now
    r.worker.start();
    const m = (await r.admin.get("/api/missions")).json()[0];
    expect(m.title).toMatch(/^Daily price check — /);
    expect((await r.waitFor(m.id, ["succeeded"])).output).toBe("final");
    expect((await r.admin.get("/api/schedules")).json()[0]).toMatchObject({ last_mission_status: "succeeded", last_mission_id: m.id });
  });

  it("four workers racing on the same due slot start exactly one mission", async () => {
    r = await rig(ok);
    await mk();
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '1 minute'");
    const fired = await Promise.all([1, 2, 3, 4].map(() => fireDueSchedules(r!.fx.db)));
    expect(fired.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await r.fx.db.query("SELECT count(*)::int n FROM missions WHERE schedule_id IS NOT NULL")).rows[0].n).toBe(1);
  });

  it("after downtime it starts ONE catch-up mission, not one per missed slot", async () => {
    r = await rig(ok);
    await mk({ cron: "*/5 * * * *" });
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '3 days'");
    expect(await fireDueSchedules(r.fx.db)).toBe(1);
    expect(await fireDueSchedules(r.fx.db)).toBe(0);
  });

  it("overlap=skip does not pile a new run on top of one still active; overlap=allow does", async () => {
    r = await rig(ok); // worker never started: the first mission stays 'running'
    await mk({ name: "skipper", overlap: "skip" });
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '1 minute'");
    expect(await fireDueSchedules(r.fx.db)).toBe(1);
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '1 minute'");
    expect(await fireDueSchedules(r.fx.db)).toBe(0);
    expect((await r.admin.get("/api/schedules")).json()[0].last_error).toMatch(/previous run still active/);
    await r.admin.patch(`/api/schedules/${(await r.admin.get("/api/schedules")).json()[0].id}`, { overlap: "allow" });
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '1 minute'");
    expect(await fireDueSchedules(r.fx.db)).toBe(1);
  });

  it("disabled schedules do not fire; a template that went bad records the error instead of retrying every tick", async () => {
    r = await rig(ok);
    const id = (await mk()).json().id;
    await r.admin.patch(`/api/schedules/${id}`, { enabled: false });
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '1 minute'");
    expect(await fireDueSchedules(r.fx.db)).toBe(0);
    await r.admin.patch(`/api/schedules/${id}`, { enabled: true });
    await r.fx.db.query("UPDATE schedules SET next_run_at = now() - interval '1 minute'");
    await r.op.post(`/api/agents/${r.ids.hotels}/status`, { status: "terminated" }); // breaks the stored plan
    expect(await fireDueSchedules(r.fx.db)).toBe(0);
    const s = (await r.admin.get("/api/schedules")).json()[0];
    expect(s.last_error).toMatch(/failed .*not an active member/);
    expect(new Date(s.next_run_at).getTime()).toBeGreaterThan(Date.now()); // moved on; no hot loop
  });

  it("run-now starts an immediate mission without moving the timetable; scheduled work still needs approvals for writes", async () => {
    r = await rig(ok);
    const created = (await mk()).json();
    const before = (await r.fx.db.query("SELECT next_run_at FROM schedules WHERE id=$1", [created.id])).rows[0].next_run_at;
    const run = await r.op.post(`/api/schedules/${created.id}/run-now`);
    expect(run.statusCode).toBe(201);
    expect((await r.fx.db.query("SELECT next_run_at FROM schedules WHERE id=$1", [created.id])).rows[0].next_run_at).toEqual(before);
    expect((await r.admin.get(`/api/missions/${run.json().id}`)).json().title).toMatch(/manual/);
    expect((await r.op.post("/api/schedules/00000000-0000-0000-0000-000000000000/run-now")).statusCode).toBe(404);
    expect((await r.op.del(`/api/schedules/${created.id}`)).statusCode).toBe(204);
  });
});

describe("workflows (visual builder backend)", () => {
  const def = { tasks: [
    { key: "flights", title: "Find flights", assignee: "Flights", input: "Find flights to {destination}", x: 40, y: 40 },
    { key: "hotels", title: "Find hotels", assignee: "Hotels", input: "Find hotels", depends_on: ["flights"], x: 300, y: 40 },
  ] };

  it("stores a drawn graph, validates it against a team, and runs it as a mission", async () => {
    r = await rig(ok);
    const wf = await r.op.post("/api/workflows", { name: "Trip basics", definition: def });
    expect(wf.statusCode).toBe(201);
    expect((await r.op.post("/api/workflows", { name: "Trip basics", definition: def })).statusCode).toBe(409);
    expect((await r.op.post("/api/workflows/validate", { team_id: r.team, definition: def })).json()).toEqual({ ok: true });
    const cyc = { tasks: [{ ...def.tasks[0], depends_on: ["hotels"] }, def.tasks[1]] };
    expect((await r.op.post("/api/workflows/validate", { team_id: r.team, definition: cyc })).json()).toMatchObject({ ok: false, error: expect.stringMatching(/cycle/) });
    expect((await r.op.post("/api/workflows/validate", { team_id: r.team, definition: { tasks: [{ ...def.tasks[0], assignee: "Nobody" }] } })).json().ok).toBe(false);

    expect((await r.admin.get("/api/workflows")).json()[0].definition.tasks[0]).toMatchObject({ x: 40, y: 40 }); // layout is preserved
    r.worker.start();
    const run = await r.op.post(`/api/workflows/${wf.json().id}/run`, { team_id: r.team, goal: "Trip to Lisbon" });
    expect(run.statusCode).toBe(201);
    const m = await r.waitFor(run.json().id, ["succeeded"]);
    expect(m.tasks.map((t: any) => t.key)).toEqual(["flights", "hotels", "synthesize"]); // no planning call: the human's graph is the plan
    expect(r.v.calls.some((c) => c.user.includes("You are the orchestrator"))).toBe(false);

    const put = await r.op.put(`/api/workflows/${wf.json().id}`, { name: "Trip basics v2", definition: { tasks: [def.tasks[0]] } });
    expect(put.statusCode).toBe(200);
    expect((await r.op.del(`/api/workflows/${wf.json().id}`)).statusCode).toBe(204);
    expect((await r.op.post("/api/workflows", { name: "empty", definition: { tasks: [] } })).statusCode).toBe(400);
  });
});
