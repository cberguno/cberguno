import { useEffect, useMemo, useState, type FormEvent } from "react";
import { get, post } from "../api";
import { canEdit, useAuth } from "../auth";
import { Badge, Card, Err, useLoad, usd, when } from "../ui";

type Task = { id: string; parent_task_id: string | null; key: string; kind: string; title: string; status: string; depends_on: string[]; assignee_name: string; attempt: number; revision: number; output: string | null; error: string | null; cost_usd: number };
type Msg = { id: string; type: string; from_kind: string; from_name: string | null; to_kind: string; to_name: string | null; body: Record<string, any>; created_at: string };

const NW = 168, NH = 46, GX = 54, GY = 18;

/** Layered DAG: column = longest dependency chain; dotted edges link a task to its review/answer/helper tasks. */
function TaskGraph({ tasks }: { tasks: Task[] }) {
  const g = useMemo(() => {
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    const layer = new Map<string, number>();
    const depth = (k: string, seen: Set<string>): number => {
      if (layer.has(k)) return layer.get(k)!;
      if (seen.has(k)) return 0;
      const t = byKey.get(k);
      const d = t ? Math.max(-1, ...t.depends_on.filter((x) => byKey.has(x)).map((x) => depth(x, new Set([...seen, k])))) + 1 : 0;
      layer.set(k, d);
      return d;
    };
    tasks.forEach((t) => depth(t.key, new Set()));
    const hasPlan = tasks.some((t) => t.kind === "plan");
    if (hasPlan) for (const t of tasks) if (t.kind !== "plan") layer.set(t.key, (layer.get(t.key) ?? 0) + 1); // the plan is its own first column
    // review / answer tasks sit one column after the task they serve
    for (const t of tasks) if ((t.kind === "review" || t.kind === "answer") && t.parent_task_id) {
      const p = tasks.find((x) => x.id === t.parent_task_id);
      if (p) layer.set(t.key, (layer.get(p.key) ?? 0) + 0.5);
    }
    const cols = new Map<number, Task[]>();
    tasks.forEach((t) => cols.set(layer.get(t.key) ?? 0, [...(cols.get(layer.get(t.key) ?? 0) ?? []), t]));
    const xs = [...cols.keys()].sort((a, b) => a - b);
    const pos = new Map<string, { x: number; y: number }>();
    xs.forEach((c, ci) => cols.get(c)!.forEach((t, ri) => pos.set(t.key, { x: ci * (NW + GX), y: ri * (NH + GY) })));
    const edges: { a: string; b: string; dotted: boolean }[] = [];
    for (const t of tasks) {
      t.depends_on.forEach((d) => byKey.has(d) && edges.push({ a: d, b: t.key, dotted: false }));
      if (hasPlan && t.kind === "work" && t.depends_on.length === 0 && !t.parent_task_id) edges.push({ a: "plan", b: t.key, dotted: true });
      if (t.parent_task_id && (t.kind === "review" || t.kind === "answer")) { const p = tasks.find((x) => x.id === t.parent_task_id); if (p) edges.push({ a: p.key, b: t.key, dotted: true }); }
    }
    const width = Math.max(...[...pos.values()].map((p) => p.x)) + NW, height = Math.max(...[...pos.values()].map((p) => p.y)) + NH;
    return { pos, edges, width, height };
  }, [tasks]);
  if (!tasks.length) return null;
  return (
    <div className="orgchart">
      <svg viewBox={`-4 -4 ${g.width + 8} ${g.height + 8}`} width={g.width + 8} height={g.height + 8} role="img" aria-label="Task graph">
        {g.edges.map((e, i) => { const a = g.pos.get(e.a)!, b = g.pos.get(e.b)!; return <path key={i} className={`edge ${e.dotted ? "dotted" : ""}`} d={`M${a.x + NW},${a.y + NH / 2} C${a.x + NW + GX / 2},${a.y + NH / 2} ${b.x - GX / 2},${b.y + NH / 2} ${b.x},${b.y + NH / 2}`} />; })}
        {tasks.map((t) => { const p = g.pos.get(t.key)!; return (
          <g key={t.id} transform={`translate(${p.x},${p.y})`} className={`tnode st-${t.status}`}>
            <rect width={NW} height={NH} rx="8" />
            <text x="10" y="19" className="n1">{(t.title.length > 24 ? t.title.slice(0, 23) + "…" : t.title)}</text>
            <text x="10" y="36" className="n2">{t.assignee_name} · {t.status.replace("_", " ")}{t.revision ? ` · rev ${t.revision}` : ""}</text>
          </g>); })}
      </svg>
    </div>
  );
}

const LW = 130, RH = 30;
/** Sequence diagram of structured agent-to-agent messages. */
function Conversation({ messages }: { messages: Msg[] }) {
  const lanes = useMemo(() => {
    const names: string[] = [];
    const add = (n: string) => { if (!names.includes(n)) names.push(n); };
    messages.forEach((m) => { add(m.from_name ?? (m.from_kind === "system" ? "System" : "Human")); add(m.to_name ?? (m.to_kind === "user" ? "Human" : "Channel")); });
    return names;
  }, [messages]);
  if (!messages.length) return <p className="muted">No messages yet.</p>;
  const x = (n: string) => lanes.indexOf(n) * LW + LW / 2;
  const h = messages.length * RH + 40;
  return (
    <div className="orgchart">
      <svg width={lanes.length * LW} height={h} viewBox={`0 0 ${lanes.length * LW} ${h}`} role="img" aria-label="Agent message sequence">
        <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" className="arrowhead" /></marker></defs>
        {lanes.map((n) => <g key={n}><text x={x(n)} y="14" textAnchor="middle" className="n1">{n}</text><line x1={x(n)} x2={x(n)} y1="22" y2={h} className="lane" /></g>)}
        {messages.map((m, i) => {
          const a = x(m.from_name ?? (m.from_kind === "system" ? "System" : "Human")), b = x(m.to_name ?? (m.to_kind === "user" ? "Human" : "Channel")), y = 40 + i * RH;
          const self = a === b;
          return (
            <g key={m.id} className={`msg t-${m.type.split(".")[0]}`}>
              <line x1={a} x2={self ? a + 24 : b} y1={y} y2={y} markerEnd="url(#arr)" />
              <text x={Math.min(a, b) + (self ? 28 : 6)} y={y - 5} className="n2">{m.type}</text>
              <title>{JSON.stringify(m.body, null, 1)}</title>
            </g>);
        })}
      </svg>
    </div>
  );
}

export default function Missions() {
  const { me } = useAuth();
  const edit = canEdit(me?.role);
  const list = useLoad(() => get<any[]>("/api/missions"));
  const teams = useLoad(() => get<any[]>("/api/teams"));
  const [sel, setSel] = useState<string>("");
  const detail = useLoad(() => (sel ? get<any>(`/api/missions/${sel}`) : Promise.resolve(null)), [sel]);
  const [form, setForm] = useState({ title: "", goal: "", team_id: "", review: false, max_cost_usd: 2 });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { // live monitoring: poll while anything is in flight
    const id = setInterval(() => { void list.reload(); if (sel && detail.data && ["running"].includes(detail.data.status)) void detail.reload(); }, 2000);
    return () => clearInterval(id);
  }, [sel, detail.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try { setErr(null); const r = await post("/api/missions", { title: form.title, goal: form.goal, team_id: form.team_id, max_cost_usd: +form.max_cost_usd, options: { review: form.review } }); setSel(r.id); await list.reload(); setForm({ ...form, title: "", goal: "" }); }
    catch (x) { setErr((x as Error).message); }
  };
  const act = async (name: string) => { try { setErr(null); await post(`/api/missions/${sel}/${name}`); await detail.reload(); await list.reload(); } catch (x) { setErr((x as Error).message); } };
  const m = detail.data;

  return (
    <>
      {edit && (
        <Card title="Start a mission">
          <form onSubmit={create} className="grid wide">
            <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
            <label>Team
              <select value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })} required>
                <option value="" disabled>Choose…</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.members.length})</option>)}
              </select>
            </label>
            <label>Cost cap (USD)<input type="number" step="any" min={0.0001} value={form.max_cost_usd} onChange={(e) => setForm({ ...form, max_cost_usd: +e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={form.review} onChange={(e) => setForm({ ...form, review: e.target.checked })} />QA review each task</label>
            <label className="full">Goal<textarea rows={3} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} required /></label>
            <div className="row full"><button className="primary">Start mission</button><span className="muted small">The team's orchestrator plans the work, specialists execute in parallel, results are synthesized. Requires an orchestrator agent on the team.</span></div>
          </form>
        </Card>
      )}
      <Err msg={err ?? list.error} />
      <Card title="Missions">
        <table>
          <thead><tr><th>Mission</th><th>Team</th><th>Status</th><th>Progress</th><th>Cost / cap</th><th>Started</th></tr></thead>
          <tbody>
            {list.data?.map((x) => (
              <tr key={x.id} className={x.id === sel ? "sel" : ""} onClick={() => setSel(x.id)} style={{ cursor: "pointer" }}>
                <td><b>{x.title}</b>{x.escalation_reason && <div className="small error-text">{x.escalation_reason}</div>}</td><td>{x.team_name}</td><td><Badge s={x.status} /></td>
                <td>{x.tasks_done}/{x.tasks_total}</td><td>{usd(x.cost_usd)} / {usd(x.max_cost_usd)}</td><td>{when(x.created_at)}</td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td colSpan={6} className="muted">No missions yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      {m && (
        <>
          <Card title={m.title} actions={<><Badge s={m.status} />
            {edit && m.status === "needs_human" && <><button className="primary" onClick={() => act("resume")}>Retry failed tasks</button>{m.output && <button onClick={() => act("accept")}>Accept result</button>}</>}
            {edit && ["running", "needs_human"].includes(m.status) && <button className="danger" onClick={() => confirm("Cancel this mission?") && act("cancel")}>Cancel</button>}</>}>
            <p className="muted small">Orchestrator: {m.orchestrator_name} · Team: {m.team_name} · Spent {usd(m.cost_usd)} of {usd(m.max_cost_usd)}</p>
            <p>{m.goal}</p>
            {m.escalation_reason && <div className="error" role="alert"><b>Needs a human:</b> {m.escalation_reason}</div>}
            {m.error && m.status !== "needs_human" && <div className="error">{m.error}</div>}
            {m.output && <><h3>Result</h3><pre className="output">{m.output}</pre></>}
          </Card>
          <Card title="Task graph"><TaskGraph tasks={m.tasks} /></Card>
          <Card title="Agent communication"><Conversation messages={m.messages} /></Card>
          <Card title="Tasks">
            <table>
              <thead><tr><th>Task</th><th>Agent</th><th>Status</th><th>Tries</th><th>Cost</th><th /></tr></thead>
              <tbody>
                {m.tasks.map((t: Task) => (
                  <>
                    <tr key={t.id}><td>{t.title}<div className="muted small mono">{t.key} · {t.kind}</div></td><td>{t.assignee_name}</td><td><Badge s={t.status} /></td><td>{t.attempt}{t.revision ? ` (rev ${t.revision})` : ""}</td><td>{usd(t.cost_usd)}</td>
                      <td><button onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Hide" : "Output"}</button></td></tr>
                    {open === t.id && <tr key={t.id + "o"}><td colSpan={6}>{t.error && <div className="error">{t.error}</div>}<pre className="output">{t.output ?? "(no output yet)"}</pre></td></tr>}
                  </>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
