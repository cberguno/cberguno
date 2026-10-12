import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { del, get, post, put } from "../api";
import { canEdit, useAuth } from "../auth";
import { Card, Err, useLoad } from "../ui";
import { autoLayout, H, W, wouldCycle, type WNode } from "./workflowGraph";

const CANVAS_W = 1000, CANVAS_H = 520;
const KEY_RE = /^[a-z0-9_-]{1,40}$/i;

export default function Workflows() {
  const { me } = useAuth();
  const edit = canEdit(me?.role);
  const nav = useNavigate();
  const saved = useLoad(() => get<any[]>("/api/workflows"));
  const teams = useLoad(() => get<any[]>("/api/teams"));
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [nodes, setNodes] = useState<WNode[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [goal, setGoal] = useState("");
  const [cap, setCap] = useState(1);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: string; dx: number; dy: number } | null>(null);

  const team = teams.data?.find((t) => t.id === teamId);
  const members: string[] = team?.members.map((m: any) => m.name) ?? [];
  useEffect(() => { if (!teamId && teams.data?.length) setTeamId(teams.data[0].id); }, [teams.data, teamId]);

  const pt = (e: React.PointerEvent) => {
    const s = svg.current!;
    const p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(s.getScreenCTM()!.inverse());
    return { x: q.x, y: q.y };
  };
  const upd = (key: string, patch: Partial<WNode>) => setNodes((ns) => ns.map((n) => (n.key === key ? { ...n, ...patch } : n)));
  const selected = nodes.find((n) => n.key === sel) ?? null;

  const addNode = () => {
    let i = nodes.length + 1;
    while (nodes.some((n) => n.key === `t${i}`)) i++;
    const n: WNode = { key: `t${i}`, title: `Task ${i}`, assignee: members[0] ?? "", input: "", depends_on: [], x: 40 + ((nodes.length % 4) * (W + 50)), y: 40 + Math.floor(nodes.length / 4) * (H + 40) };
    setNodes([...nodes, n]); setSel(n.key);
  };
  const removeNode = (key: string) => { setNodes(nodes.filter((n) => n.key !== key).map((n) => ({ ...n, depends_on: n.depends_on.filter((d) => d !== key) }))); setSel(null); };
  const rename = (oldKey: string, next: string) => {
    if (!KEY_RE.test(next) || nodes.some((n) => n.key === next && n.key !== oldKey)) return setMsg({ ok: false, text: "Key must be unique: 1–40 letters, digits, - or _" });
    setNodes(nodes.map((n) => ({ ...n, key: n.key === oldKey ? next : n.key, depends_on: n.depends_on.map((d) => (d === oldKey ? next : d)) })));
    setSel(next); setMsg(null);
  };

  const onMove = (e: React.PointerEvent) => {
    const p = pt(e);
    if (drag.current) upd(drag.current.key, { x: Math.max(0, Math.min(CANVAS_W - W, p.x - drag.current.dx)), y: Math.max(0, Math.min(CANVAS_H - H, p.y - drag.current.dy)) });
    else if (link) setLink({ ...link, x: p.x, y: p.y });
  };
  const onUp = (e: React.PointerEvent) => {
    if (link) {
      const p = pt(e);
      const target = nodes.find((n) => n.key !== link.from && p.x >= n.x && p.x <= n.x + W && p.y >= n.y && p.y <= n.y + H);
      if (target && !target.depends_on.includes(link.from)) {
        if (wouldCycle(nodes, link.from, target.key)) setMsg({ ok: false, text: "That connection would create a loop." });
        else { upd(target.key, { depends_on: [...target.depends_on, link.from] }); setMsg(null); }
      }
    }
    drag.current = null; setLink(null);
  };

  const definition = useMemo(() => ({ tasks: nodes.map((n) => ({ key: n.key, title: n.title, assignee: n.assignee, input: n.input || n.title, depends_on: n.depends_on, x: Math.round(n.x), y: Math.round(n.y) })) }), [nodes]);
  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };

  const validate = () => guard(async () => {
    const r = await post("/api/workflows/validate", { team_id: teamId, definition });
    setMsg(r.ok ? { ok: true, text: "Valid: every task has an active team member and there are no loops." } : { ok: false, text: r.error });
  });
  const save = () => guard(async () => {
    if (!name.trim()) throw new Error("Give the workflow a name first.");
    if (id) await put(`/api/workflows/${id}`, { name, definition });
    else setId((await post("/api/workflows", { name, definition })).id);
    await saved.reload(); setMsg({ ok: true, text: "Saved." });
  });
  const run = () => guard(async () => {
    if (!id) throw new Error("Save the workflow before running it.");
    if (!goal.trim()) throw new Error("Describe the goal for this run.");
    const r = await post(`/api/workflows/${id}/run`, { team_id: teamId, goal, max_cost_usd: +cap });
    nav(`/missions?mission=${r.id}`);
  });
  const load = (w: any) => { setId(w.id); setName(w.name); setNodes(w.definition.tasks.map((t: any, i: number) => ({ ...t, depends_on: t.depends_on ?? [], x: t.x ?? 40 + i * 230, y: t.y ?? 40 }))); setSel(null); setMsg(null); };
  const fresh = () => { setId(null); setName(""); setNodes([]); setSel(null); setMsg(null); };

  const edges = nodes.flatMap((n) => n.depends_on.map((d) => ({ from: nodes.find((x) => x.key === d), to: n, dep: d }))).filter((e) => e.from);
  const path = (ax: number, ay: number, bx: number, by: number) => `M${ax},${ay} C${ax + 60},${ay} ${bx - 60},${by} ${bx},${by}`;

  return (
    <>
      <Card title="Workflow builder" actions={<>
        <select aria-label="Saved workflows" value={id ?? ""} onChange={(e) => { const w = saved.data?.find((x) => x.id === e.target.value); w ? load(w) : fresh(); }}>
          <option value="">New workflow</option>{saved.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        {id && edit && <button className="danger" onClick={() => confirm(`Delete “${name}”?`) && guard(async () => { await del(`/api/workflows/${id}`); fresh(); await saved.reload(); })}>Delete</button>}</>}>
        <p className="muted small">Draw the plan yourself: add tasks, drag them around, and drag from a task's right dot onto another task to say “that one needs this one's result first”. Tasks with no arrow between them run in parallel. Running it skips the AI planning step and uses your graph.</p>
        <div className="row wrap">
          <input placeholder="Workflow name" aria-label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} />
          <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          {edit && <button onClick={addNode}>Add task</button>}
          <button onClick={() => setNodes(autoLayout(nodes))} disabled={!nodes.length}>Tidy layout</button>
          <button onClick={validate} disabled={!nodes.length || !teamId}>Check</button>
          {edit && <button className="primary" onClick={save} disabled={!nodes.length}>Save</button>}
        </div>
        <Err msg={msg && !msg.ok ? msg.text : null} />
        {msg?.ok && <div className="notice" role="status">{msg.text}</div>}
        <div className="wfwrap">
          <div className="canvaswrap">
            <svg ref={svg} width={CANVAS_W} height={CANVAS_H} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className="canvas" role="application" aria-label="Workflow canvas"
              onPointerMove={onMove} onPointerUp={onUp} onPointerDown={(e) => { if (e.target === svg.current) setSel(null); }}>
              <defs><marker id="warr" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" className="arrowhead" /></marker></defs>
              {edges.map((e) => (
                <g key={`${e.dep}>${e.to.key}`} className="wedge" onClick={() => edit && upd(e.to.key, { depends_on: e.to.depends_on.filter((d) => d !== e.dep) })}>
                  <path d={path(e.from!.x + W, e.from!.y + H / 2, e.to.x, e.to.y + H / 2)} className="edge" markerEnd="url(#warr)" />
                  <path d={path(e.from!.x + W, e.from!.y + H / 2, e.to.x, e.to.y + H / 2)} className="hit"><title>Click to remove this dependency</title></path>
                </g>
              ))}
              {link && (() => { const f = nodes.find((n) => n.key === link.from)!; return <path d={path(f.x + W, f.y + H / 2, link.x, link.y)} className="edge dotted" />; })()}
              {nodes.map((n) => (
                <g key={n.key} className={`wnode ${n.key === sel ? "sel" : ""}`} data-key={n.key} transform={`translate(${n.x},${n.y})`}
                  onPointerDown={(e) => { if (!edit) return setSel(n.key); const p = pt(e); drag.current = { key: n.key, dx: p.x - n.x, dy: p.y - n.y }; svg.current!.setPointerCapture(e.pointerId); setSel(n.key); }}>
                  <rect width={W} height={H} rx="9" />
                  <text x="12" y="23" className="n1">{n.title.length > 24 ? n.title.slice(0, 23) + "…" : n.title}</text>
                  <text x="12" y="42" className="n2">{n.assignee || "unassigned"}</text>
                  <circle cx="0" cy={H / 2} r="6" className="port in" />
                  {edit && <circle cx={W} cy={H / 2} r="8" className="port out" aria-label={`Connect from ${n.title}`}
                    onPointerDown={(e) => { e.stopPropagation(); const p = pt(e); svg.current!.setPointerCapture(e.pointerId); setLink({ from: n.key, x: p.x, y: p.y }); }} />}
                </g>
              ))}
              {nodes.length === 0 && <text x={CANVAS_W / 2} y={CANVAS_H / 2} textAnchor="middle" className="n2">Click “Add task” to start drawing a workflow</text>}
            </svg>
          </div>
          <aside className="wpanel" aria-label="Task details">
            {selected ? (
              <>
                <h3>Task</h3>
                <label>Title<input value={selected.title} onChange={(e) => upd(selected.key, { title: e.target.value })} disabled={!edit} /></label>
                <label>Done by<select value={selected.assignee} onChange={(e) => upd(selected.key, { assignee: e.target.value })} disabled={!edit}>
                  {!members.includes(selected.assignee) && <option value={selected.assignee}>{selected.assignee || "choose…"}</option>}{members.map((m) => <option key={m}>{m}</option>)}</select></label>
                <label>Instructions<textarea rows={5} value={selected.input} onChange={(e) => upd(selected.key, { input: e.target.value })} disabled={!edit} /></label>
                <label>Key<input value={selected.key} onChange={(e) => rename(selected.key, e.target.value)} disabled={!edit} className="mono" /></label>
                <p className="small muted">Needs first: {selected.depends_on.length ? selected.depends_on.join(", ") : "nothing (starts immediately)"}</p>
                {edit && <button className="danger" onClick={() => removeNode(selected.key)}>Delete task</button>}
              </>
            ) : <p className="muted small">Select a task to edit it.</p>}
          </aside>
        </div>
        {edit && id && (
          <div className="grid wide" style={{ marginTop: 14 }}>
            <label className="full">Goal for this run<textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Plan a 3-day Lisbon trip for two, budget $2,500" /></label>
            <label>Cost cap (USD)<input type="number" step="any" min={0.0001} value={cap} onChange={(e) => setCap(+e.target.value)} /></label>
            <div className="row"><button className="primary" onClick={run}>Run this workflow</button></div>
          </div>
        )}
      </Card>
    </>
  );
}
