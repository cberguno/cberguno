import { useEffect, useMemo, useState } from "react";
import { del, get, post, put } from "../api";
import { canEdit, useAuth } from "../auth";
import { Card, Err, useLoad } from "../ui";

type Member = { agent_id: string; reports_to: string | null; name: string; role: string; kind: string; status: string };

const W = 170, H = 54, GX = 20, GY = 46;

/** Tidy-tree layout: each node is centred over its children; leaves get one slot. */
function layout(members: Member[]) {
  const ids = new Set(members.map((m) => m.agent_id));
  const kids = new Map<string, Member[]>();
  const roots: Member[] = [];
  for (const m of members) {
    if (m.reports_to && ids.has(m.reports_to)) kids.set(m.reports_to, [...(kids.get(m.reports_to) ?? []), m]);
    else roots.push(m);
  }
  const nodes: { m: Member; x: number; y: number }[] = [];
  const edges: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  let slot = 0;
  const place = (m: Member, depth: number, seen: Set<string>): { x: number; y: number } => {
    const y = depth * (H + GY);
    const cs = (kids.get(m.agent_id) ?? []).filter((c) => !seen.has(c.agent_id));
    let x: number;
    const childPos = cs.map((c) => place(c, depth + 1, new Set([...seen, c.agent_id])));
    if (childPos.length === 0) x = slot++ * (W + GX);
    else x = (childPos[0]!.x + childPos[childPos.length - 1]!.x) / 2;
    nodes.push({ m, x, y });
    for (const p of childPos) edges.push({ from: { x, y }, to: p });
    return { x, y };
  };
  roots.forEach((r) => place(r, 0, new Set([r.agent_id])));
  const maxX = Math.max(0, ...nodes.map((n) => n.x)) + W;
  const maxY = Math.max(0, ...nodes.map((n) => n.y)) + H;
  return { nodes, edges, width: maxX, height: maxY };
}

export function OrgChart({ members }: { members: Member[] }) {
  const g = useMemo(() => layout(members), [members]);
  if (members.length === 0) return <p className="muted">No members yet.</p>;
  return (
    <div className="orgchart">
      <svg viewBox={`-6 -6 ${g.width + 12} ${g.height + 12}`} width={g.width + 12} height={g.height + 12} role="img" aria-label="Organisation chart">
        {g.edges.map((e, i) => {
          const x1 = e.from.x + W / 2, y1 = e.from.y + H, x2 = e.to.x + W / 2, y2 = e.to.y, ym = (y1 + y2) / 2;
          return <path key={i} d={`M${x1},${y1} V${ym} H${x2} V${y2}`} className="edge" />;
        })}
        {g.nodes.map(({ m, x, y }) => (
          <g key={m.agent_id} transform={`translate(${x},${y})`} className={`node ${m.status}`}>
            <rect width={W} height={H} rx="8" />
            <text x={W / 2} y="22" textAnchor="middle" className="n1">{m.name.length > 22 ? m.name.slice(0, 21) + "…" : m.name}</text>
            <text x={W / 2} y="40" textAnchor="middle" className="n2">{m.kind}{m.status !== "active" ? ` · ${m.status}` : ""}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function Teams() {
  const { me } = useAuth();
  const edit = canEdit(me?.role);
  const teams = useLoad(() => get<any[]>("/api/teams"));
  const agents = useLoad(() => get<any[]>("/api/agents"));
  const [sel, setSel] = useState<string>("");
  const [draft, setDraft] = useState<Map<string, string | null>>(new Map()); // agent_id -> reports_to
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const team = teams.data?.find((t) => t.id === sel);

  useEffect(() => {
    if (team) setDraft(new Map(team.members.map((m: Member) => [m.agent_id, m.reports_to])));
  }, [team?.id, teams.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      setErr(null);
      await put(`/api/teams/${sel}/members`, { members: [...draft].map(([agent_id, reports_to]) => ({ agent_id, reports_to })) });
      await teams.reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const draftMembers: Member[] = [...draft].map(([id, rt]) => {
    const a = agents.data?.find((x) => x.id === id);
    return { agent_id: id, reports_to: rt, name: a?.name ?? id, role: a?.role ?? "", kind: a?.kind ?? "", status: a?.status ?? "active" };
  });

  return (
    <>
      <Card title="Teams" actions={edit && (
        <form className="row" onSubmit={async (e) => { e.preventDefault(); try { const t = await post("/api/teams", { name }); setName(""); await teams.reload(); setSel(t.id); } catch (x) { setErr((x as Error).message); } }}>
          <input placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} required /><button className="primary">Create</button>
        </form>)}>
        <Err msg={err ?? teams.error} />
        <div className="row wrap">
          {teams.data?.map((t) => <button key={t.id} className={t.id === sel ? "primary" : ""} onClick={() => setSel(t.id)}>{t.name} ({t.members.length})</button>)}
          {teams.data?.length === 0 && <span className="muted">No teams yet.</span>}
        </div>
      </Card>
      {team && (
        <>
          <Card title={`Org chart — ${team.name}`} actions={edit && <button className="danger" onClick={async () => { if (confirm(`Delete team ${team.name}?`)) { await del(`/api/teams/${team.id}`); setSel(""); await teams.reload(); } }}>Delete team</button>}>
            <OrgChart members={draftMembers} />
          </Card>
          <Card title="Members and reporting lines" actions={edit && <button className="primary" onClick={save}>Save team</button>}>
            <table>
              <thead><tr><th>In team</th><th>Agent</th><th>Reports to</th></tr></thead>
              <tbody>
                {agents.data?.filter((a) => a.status !== "terminated").map((a) => (
                  <tr key={a.id}>
                    <td><input type="checkbox" disabled={!edit} checked={draft.has(a.id)} aria-label={`Include ${a.name}`}
                      onChange={(e) => setDraft((d) => { const n = new Map(d); if (e.target.checked) n.set(a.id, null); else { n.delete(a.id); for (const [k, v] of n) if (v === a.id) n.set(k, null); } return n; })} /></td>
                    <td>{a.name} <span className="muted small">{a.role}</span></td>
                    <td>
                      {draft.has(a.id) && (
                        <select disabled={!edit} value={draft.get(a.id) ?? ""} onChange={(e) => setDraft((d) => new Map(d).set(a.id, e.target.value || null))} aria-label={`Manager of ${a.name}`}>
                          <option value="">— top of team —</option>
                          {[...draft.keys()].filter((k) => k !== a.id).map((k) => <option key={k} value={k}>{agents.data?.find((x) => x.id === k)?.name}</option>)}
                        </select>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
