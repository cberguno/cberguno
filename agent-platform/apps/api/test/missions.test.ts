import { afterEach, describe, expect, it } from "vitest";
import { plan, rig, type Script } from "./rig.js";

let r: Awaited<ReturnType<typeof rig>> | undefined;
afterEach(async () => { await r?.stop(); r = undefined; });

const TWO = plan([
  { key: "flights", title: "Find flights", assignee: "Flights", input: "Find flights to Lisbon" },
  { key: "hotels", title: "Find hotels", assignee: "Hotels", input: "Find hotels in Lisbon", depends_on: ["flights"] },
]);

const standard: Script = ({ agent, user }) => {
  if (user.includes("You are the orchestrator")) return TWO;
  if (user.includes("Combine the work below")) return "FINAL: itinerary for Lisbon";
  if (agent === "Flights") return "Flight TAP123 arrives 10:00";
  if (agent === "Hotels") return "Hotel Alfama near the station";
  return "?";
};

describe("durable missions", () => {
  it("plans, runs tasks in dependency order, passes outputs as references, synthesizes, accounts cost", async () => {
    r = await rig(standard);
    r.worker.start();
    const id = await r.create({});
    const m = await r.waitFor(id, ["succeeded"]);
    expect(m.output).toBe("FINAL: itinerary for Lisbon");
    expect(m.tasks.map((t: any) => [t.key, t.status])).toEqual([["plan", "done"], ["flights", "done"], ["hotels", "done"], ["synthesize", "done"]]);
    // dependent task saw the upstream output (a reference), inside the untrusted-data block
    const hotelPrompt = r.v.callsFor("Hotels")[0]!.user;
    expect(hotelPrompt).toContain("<upstream>");
    expect(hotelPrompt).toContain("Flight TAP123 arrives 10:00");
    // typed messages, not chatter
    const types = m.messages.map((x: any) => x.type);
    expect(types.filter((t: string) => t === "task.assign")).toHaveLength(2);
    expect(types.filter((t: string) => t === "task.result")).toHaveLength(2);
    expect(m.messages.find((x: any) => x.type === "task.assign").from_name).toBe("Director");
    // cost attribution: 4 model calls × (100*$1 + 50*$2)/1e6
    expect(m.cost_usd).toBeCloseTo(4 * 0.0002, 8);
    expect(m.tasks.reduce((s: number, t: any) => s + t.cost_usd, 0)).toBeCloseTo(m.cost_usd, 8);
  });

  it("runs independent tasks in parallel", async () => {
    const par: Script = ({ agent, user }) => {
      if (user.includes("You are the orchestrator")) return plan([{ key: "a", title: "A", assignee: "Flights", input: "do a" }, { key: "b", title: "B", assignee: "Hotels", input: "do b" }]);
      if (user.includes("Combine")) return "done";
      return { status: 200, delayMs: 200, body: { choices: [{ message: { content: `${agent} ok` }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
    };
    r = await rig(par);
    r.worker.start();
    await r.waitFor(await r.create({}), ["succeeded"]);
    expect(r.v.maxActive).toBeGreaterThanOrEqual(2);
  });

  it("rejects a bad plan, feeds the validation error back, and succeeds on the retry", async () => {
    let n = 0;
    r = await rig(({ agent, user }) => {
      if (user.includes("You are the orchestrator")) {
        n++;
        return n === 1 ? plan([{ key: "x", title: "X", assignee: "Nobody", input: "i" }]) : TWO;
      }
      return standard({ agent, user, system: "", n: 1, messages: [], toolNames: [] });
    });
    r.worker.start();
    const m = await r.waitFor(await r.create({}), ["succeeded"]);
    expect(r.v.callsFor("Director").filter((c) => c.user.includes("You are the orchestrator"))[1]!.user).toContain('assignee "Nobody" is not an active member');
    expect(m.tasks.find((t: any) => t.key === "plan").attempt).toBe(2);
  });

  it("rejects plans with cycles, unknown deps, and over-limit size", async () => {
    r = await rig(standard);
    const base = { title: "t", goal: "g", team_id: r.team };
    const cyc = await r.admin.post("/api/missions", { ...base, plan: { tasks: [{ key: "a", title: "A", assignee: "Flights", input: "i", depends_on: ["b"] }, { key: "b", title: "B", assignee: "Hotels", input: "i", depends_on: ["a"] }] } });
    expect(cyc.statusCode).toBe(400);
    expect(cyc.json().error).toMatch(/cycle/);
    const unk = await r.admin.post("/api/missions", { ...base, plan: { tasks: [{ key: "a", title: "A", assignee: "Flights", input: "i", depends_on: ["zzz"] }] } });
    expect(unk.json().error).toMatch(/unknown key/);
    const big = await r.admin.post("/api/missions", { ...base, options: { max_tasks: 3 }, plan: { tasks: ["a", "b", "c"].map((k) => ({ key: k, title: k, assignee: "Flights", input: "i" })) } });
    expect(big.json().error).toMatch(/exceed the mission task limit/);
  });

  it("a human-authored plan skips the orchestrator planning call", async () => {
    r = await rig(standard);
    r.worker.start();
    const id = await r.create({ plan: JSON.parse(TWO) });
    const m = await r.waitFor(id, ["succeeded"]);
    expect(m.tasks.some((t: any) => t.kind === "plan")).toBe(false);
    expect(r.v.calls.some((c) => c.user.includes("You are the orchestrator"))).toBe(false);
  });

  it("each task executes exactly once even with several competing workers", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({ key: `t${i}`, title: `T${i}`, assignee: i % 2 ? "Flights" : "Hotels", input: `unit ${i}` }));
    r = await rig(({ user }) => (user.includes("Combine") ? "done" : "ok"), {}, {});
    const { Worker } = await import("../src/worker.js");
    const ws = [r.worker, new Worker(r.deps, { pollMs: 10 }), new Worker(r.deps, { pollMs: 10 })];
    ws.forEach((w) => w.start());
    const m = await r.waitFor(await r.create({ plan: { tasks }, options: { max_tasks: 20 } }), ["succeeded"]);
    await Promise.all(ws.slice(1).map((w) => w.stop()));
    for (let i = 0; i < 10; i++) expect(r.v.calls.filter((c) => c.user.includes(`Your task: T${i}\n`))).toHaveLength(1);
    expect(m.tasks.every((t: any) => t.attempt <= 1)).toBe(true);
  });
});

describe("collaboration", () => {
  it("lets a specialist ask its manager a question and continue with the answer", async () => {
    r = await rig(({ agent, user }) => {
      if (user.includes("You are the orchestrator")) return plan([{ key: "f", title: "Find flights", assignee: "Flights", input: "Find flights" }]);
      if (agent === "Flights" && !user.includes("Clarifications")) return '{"status":"blocked","question":"Which departure airport?"}';
      if (agent === "Director" && user.includes("A team member asked you a question")) return "Depart from JFK";
      if (user.includes("Combine")) return "final";
      if (agent === "Flights") return user.includes("Depart from JFK") ? "JFK->LIS flight found" : "no answer seen";
      return "?";
    });
    r.worker.start();
    const m = await r.waitFor(await r.create({}), ["succeeded"]);
    expect(m.tasks.find((t: any) => t.key === "f").output).toBe("JFK->LIS flight found");
    const types = m.messages.map((x: any) => x.type);
    expect(types).toContain("question");
    expect(types).toContain("answer");
    expect(m.messages.find((x: any) => x.type === "question")).toMatchObject({ from_name: "Flights", to_name: "Director" });
  });

  it("lets a specialist delegate subtasks, then resumes it with their results", async () => {
    r = await rig(({ agent, user }) => {
      if (user.includes("You are the orchestrator")) return plan([{ key: "trip", title: "Research trip", assignee: "Flights", input: "Research the trip" }]);
      if (agent === "Flights" && user.includes("Your task: Research trip") && !user.includes("## Outbound"))
        return JSON.stringify({ status: "delegate", tasks: [{ key: "outbound", title: "Outbound", assignee: "Hotels", input: "outbound leg" }, { key: "ret", title: "Return", assignee: "Hotels", input: "return leg" }] });
      if (user.includes("Your task: Research trip")) return `Trip combines: ${/## Outbound[^]*?\n(.*)/.exec(user)?.[1]} + returned`;
      if (user.includes("Combine")) return "final";
      return `${agent} did ${/Your task: (.*)/.exec(user)?.[1]}`;
    });
    r.worker.start();
    const m = await r.waitFor(await r.create({}), ["succeeded"]);
    expect(m.tasks.map((t: any) => t.key)).toEqual(expect.arrayContaining(["trip", "trip.outbound", "trip.ret", "synthesize"]));
    const child = m.tasks.find((t: any) => t.key === "trip.outbound");
    expect(child.depth).toBe(2);
    expect(m.tasks.find((t: any) => t.key === "trip").output).toContain("Hotels did Outbound");
    expect(r.v.callsFor("Flights").filter((c) => c.user.includes("Your task: Research trip"))).toHaveLength(2); // ran, delegated, re-ran
    expect(m.tasks.find((t: any) => t.key === "trip").attempt).toBe(1); // the delegation round is refunded, not charged as a failure
  });

  it("QA review: requests changes once, task is revised with the feedback, then accepted; lesson is remembered", async () => {
    let reviews = 0;
    r = await rig(({ agent, user }) => {
      if (user.includes("You are the orchestrator")) return plan([{ key: "f", title: "Find flights", assignee: "Flights", input: "Find flights" }]);
      if (agent === "QA") return ++reviews === 1 ? '{"verdict":"request_changes","feedback":"Include the arrival time"}' : '{"verdict":"accept","feedback":""}';
      if (user.includes("Combine")) return "final";
      return user.includes("Include the arrival time") ? "Flight TAP123 arrives 10:00" : "Flight TAP123";
    });
    r.worker.start();
    const m = await r.waitFor(await r.create({ options: { review: true } }), ["succeeded"]);
    const f = m.tasks.find((t: any) => t.key === "f");
    expect(f).toMatchObject({ status: "done", revision: 1, output: "Flight TAP123 arrives 10:00" });
    expect(m.messages.filter((x: any) => x.type === "review.verdict").map((x: any) => x.body.verdict)).toEqual(["request_changes", "accept"]);
    const lessons = await r.fx.db.query("SELECT content, agent_id FROM memories WHERE kind='lesson'");
    expect(lessons.rows).toHaveLength(1);
    expect(lessons.rows[0].content).toContain("Include the arrival time");
    expect(lessons.rows[0].agent_id).toBe(r.ids.flights);
  });

  it("QA that keeps rejecting escalates to a human; resuming lets the mission finish", async () => {
    let reject = true;
    r = await rig(({ agent, user }) => {
      if (user.includes("You are the orchestrator")) return plan([{ key: "f", title: "Find flights", assignee: "Flights", input: "Find flights" }]);
      if (agent === "QA") return reject ? '{"verdict":"request_changes","feedback":"wrong"}' : '{"verdict":"accept","feedback":""}';
      if (user.includes("Combine")) return "final";
      return "attempt";
    });
    r.worker.start();
    const id = await r.create({ options: { review: true, max_revisions: 1 } });
    const m = await r.waitFor(id, ["needs_human"]);
    expect(m.escalation_reason).toMatch(/QA rejected "Find flights" after 1 revision/);
    expect(m.messages.some((x: any) => x.type === "escalation")).toBe(true);
    reject = false;
    expect((await r.op.post(`/api/missions/${id}/resume`)).statusCode).toBe(200);
    expect((await r.waitFor(id, ["succeeded"])).output).toBe("final");
  });

  it("surfaces conflicts reported by synthesis and lets a human accept", async () => {
    r = await rig(({ agent, user }) => {
      if (user.includes("You are the orchestrator")) return TWO;
      if (user.includes("Combine")) return '{"final":"Best effort itinerary","conflicts":["Flight lands after hotel check-out"]}';
      return `${agent} says something`;
    });
    r.worker.start();
    const id = await r.create({});
    const m = await r.waitFor(id, ["needs_human"]);
    expect(m.escalation_reason).toContain("Flight lands after hotel check-out");
    expect(m.output).toBe("Best effort itinerary");
    expect((await r.op.post(`/api/missions/${id}/resume`)).statusCode).toBe(409); // nothing to retry
    expect((await r.op.post(`/api/missions/${id}/accept`)).statusCode).toBe(200);
    expect((await r.get(id)).status).toBe("succeeded");
  });
});

describe("failure handling, limits and escalation", () => {
  it("retries with backoff, escalates after max attempts, and resumes after the fault is fixed", async () => {
    let broken = true;
    r = await rig((c) => (broken && c.agent === "Flights" ? { status: 503 } : standard(c)));
    r.worker.start();
    const id = await r.create({});
    const m = await r.waitFor(id, ["needs_human"]);
    const f = m.tasks.find((t: any) => t.key === "flights");
    expect(f).toMatchObject({ status: "failed", attempt: 3 });
    expect(f.error).toContain("503");
    expect(m.escalation_reason).toMatch(/"Find flights" failed after 3 attempts/);
    broken = false;
    await r.op.post(`/api/missions/${id}/resume`);
    expect((await r.waitFor(id, ["succeeded"])).output).toContain("FINAL");
  });

  it("stops a runaway conversation at the message budget and escalates instead of continuing", async () => {
    r = await rig(standard);
    r.worker.start();
    const id = await r.create({ options: { max_messages: 3 } });
    const m = await r.waitFor(id, ["needs_human"]);
    expect(m.escalation_reason).toMatch(/message budget of 3/);
    expect(m.messages.filter((x: any) => x.type !== "escalation").length).toBeLessThanOrEqual(3);
    expect(m.messages.some((x: any) => x.type === "escalation")).toBe(true);
    const callsAtEscalation = r.v.calls.length;
    await new Promise((x) => setTimeout(x, 300));
    expect(r.v.calls.length).toBe(callsAtEscalation); // nothing keeps running
  });

  it("stops at the mission cost cap and cancels remaining tasks", async () => {
    r = await rig(standard);
    r.worker.start();
    const id = await r.create({ max_cost_usd: 0.0006 }); // each call ≈ $0.0002 actual; worst-case gate trips on the 3rd
    const m = await r.waitFor(id, ["budget_exceeded"]);
    expect(m.tasks.some((t: any) => t.status === "cancelled")).toBe(true);
    expect(m.cost_usd).toBeLessThanOrEqual(0.0006);
  });

  it("an agent's own daily budget escalates rather than silently overspending", async () => {
    r = await rig(standard);
    await r.admin.patch(`/api/agents/${r.ids.flights}`, { daily_budget_usd: 0 });
    r.worker.start();
    const m = await r.waitFor(await r.create({}), ["needs_human"]);
    expect(m.escalation_reason).toMatch(/Flights's daily budget/);
  });

  it("a paused agent defers its task until resumed (and is excluded from new plans)", async () => {
    r = await rig(standard);
    const id = await r.create({ plan: JSON.parse(TWO) }); // planned while everyone is active
    await r.op.post(`/api/agents/${r.ids.hotels}/status`, { status: "paused" });
    expect((await r.admin.post("/api/missions", { title: "t", goal: "g", team_id: r.team, plan: JSON.parse(TWO) })).json().error).toMatch(/not an active member/);
    r.worker.start();
    await new Promise((x) => setTimeout(x, 600));
    const mid = await r.get(id);
    expect(mid.status).toBe("running");
    expect(mid.tasks.find((t: any) => t.key === "flights").status).toBe("done");
    expect(mid.tasks.find((t: any) => t.key === "hotels").status).toBe("queued");
    expect(mid.tasks.find((t: any) => t.key === "hotels").attempt).toBe(0); // deferral is not charged as an attempt
    await r.op.post(`/api/agents/${r.ids.hotels}/status`, { status: "active" });
    await r.fx.db.query("UPDATE tasks SET run_after=now() WHERE status='queued'"); // skip the 15s hold
    await r.waitFor(id, ["succeeded"]);
  });

  it("cancelling a mission cancels its open tasks", async () => {
    r = await rig(({ user }) => (user.includes("You are the orchestrator") ? { status: 200, delayMs: 1000, body: { choices: [{ message: { content: TWO } }], usage: {} } } : "x"));
    r.worker.start();
    const id = await r.create({});
    await new Promise((x) => setTimeout(x, 150));
    expect((await r.op.post(`/api/missions/${id}/cancel`)).statusCode).toBe(200);
    const m = await r.get(id);
    expect(m.status).toBe("cancelled");
    expect(m.tasks.every((t: any) => t.status === "cancelled")).toBe(true);
    await new Promise((x) => setTimeout(x, 1200)); // the in-flight plan call finishes but is fenced out
    expect((await r.get(id)).tasks).toHaveLength(1);
  });

  it("validates mission creation and enforces roles", async () => {
    r = await rig(standard, {}, { reviewTeam: false });
    const viewer = r.t.as(await r.t.mkUser("viewer"));
    expect((await viewer.post("/api/missions", { title: "t", goal: "g", team_id: r.team })).statusCode).toBe(403);
    expect((await r.admin.post("/api/missions", { title: "t", goal: "g", team_id: r.team, options: { review: true } })).json().error).toMatch(/QA agent/);
    expect((await r.admin.post("/api/missions", { title: "t", goal: "g", team_id: "00000000-0000-0000-0000-000000000000" })).statusCode).toBe(400);
    expect((await viewer.get("/api/missions")).statusCode).toBe(200);
  });
});

describe("concurrency stress", () => {
  it("20 simultaneous completions across 4 workers never strand a dependent task", async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({ key: `t${i}`, title: `T${i}`, assignee: i % 2 ? "Flights" : "Hotels", input: `unit ${i}` }));
    r = await rig(({ user }) => (user.includes("Combine") ? "done" : "ok"), { concurrency: 10 });
    const { Worker } = await import("../src/worker.js");
    const ws = [r.worker, ...[1, 2, 3].map(() => new Worker(r!.deps, { pollMs: 5, concurrency: 10 }))];
    ws.forEach((w) => w.start());
    const ids = await Promise.all([1, 2, 3].map(() => r!.create({ plan: { tasks }, options: { max_tasks: 30 } })));
    for (const id of ids) await r.waitFor(id, ["succeeded"], 30000);
    await Promise.all(ws.slice(1).map((w) => w.stop()));
  }, 40000);
});
