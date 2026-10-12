import { useState, type FormEvent } from "react";
import { del, get, post, put } from "../api";
import { canEdit, isAdmin, useAuth } from "../auth";
import { Card, Err, useLoad, when } from "../ui";

export default function Memory() {
  const { me } = useAuth();
  const edit = canEdit(me?.role), admin = isAdmin(me?.role);
  const agents = useLoad(() => get<any[]>("/api/agents"));
  const teams = useLoad(() => get<any[]>("/api/teams"));
  const models = useLoad(() => get<any[]>("/api/models"));
  const setting = useLoad(() => get<any>("/api/settings/embedding"));
  const [agentId, setAgentId] = useState("");
  const mem = useLoad(() => get<any[]>(`/api/memories${agentId ? `?agent_id=${agentId}` : ""}`), [agentId]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [f, setF] = useState({ kind: "semantic", scope: "agent", agent_id: "", team_id: "", content: "" });
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { try { setErr(null); await fn(); } catch (e) { setErr((e as Error).message); } };

  const search = (e: FormEvent) => { e.preventDefault(); void run(async () => setHits(await get(`/api/memories/search?agent_id=${agentId}&q=${encodeURIComponent(q)}`))); };
  const add = (e: FormEvent) => { e.preventDefault(); void run(async () => { await post("/api/memories", { kind: f.kind, scope: f.scope, content: f.content, agent_id: f.scope === "agent" ? f.agent_id || agentId : undefined, team_id: f.scope === "team" ? f.team_id : undefined }); setF({ ...f, content: "" }); await mem.reload(); }); };
  const embedModels = models.data?.filter((m) => m.kind === "embedding") ?? [];

  return (
    <>
      <Err msg={err ?? mem.error} />
      {note && <div className="notice" role="status">{note}</div>}
      <Card title="Embedding model" actions={admin && <button onClick={() => run(async () => { const r = await post("/api/memories/consolidate"); setNote(`Consolidation: ${r.backfilled} embedded, ${r.merged} merged, ${r.pruned} pruned`); await mem.reload(); })}>Run consolidation</button>}>
        <p className="muted small">Semantic search needs an embedding model (add one under Models &amp; providers with kind “embedding”). Without one, memory still works using keyword search.</p>
        <div className="row">
          <select disabled={!admin} value={setting.data?.model?.id ?? ""} onChange={(e) => run(async () => { await put("/api/settings/embedding", { model_id: e.target.value || null }); await setting.reload(); })} aria-label="Embedding model">
            <option value="">None (keyword search only)</option>{embedModels.map((m) => <option key={m.id} value={m.id}>{m.display_name} ({m.provider_name})</option>)}
          </select>
          <span className="muted small">{setting.data?.model ? `Using ${setting.data.model.model_name}` : "Not configured"}</span>
        </div>
      </Card>

      <Card title="What does an agent remember?">
        <div className="grid wide">
          <label>Agent
            <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setHits(null); }}>
              <option value="">All agents</option>{agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name} (reach: {a.permissions?.memory_scope})</option>)}
            </select>
          </label>
          <form onSubmit={search} className="row full">
            <input placeholder="Test recall: what would this agent retrieve for…" value={q} onChange={(e) => setQ(e.target.value)} disabled={!agentId} />
            <button disabled={!agentId || !q.trim()}>Search as agent</button>
          </form>
        </div>
        {hits && (
          <table><thead><tr><th>Score</th><th>Similarity</th><th>Kind</th><th>Scope</th><th>Memory</th></tr></thead>
            <tbody>{hits.map((h) => <tr key={h.id}><td>{h.score.toFixed(3)}</td><td>{h.similarity.toFixed(3)} <span className="muted small">{h.method}</span></td><td>{h.kind}</td><td>{h.scope}</td><td>{h.content}</td></tr>)}
              {hits.length === 0 && <tr><td colSpan={5} className="muted">Nothing recalled (within this agent's scope).</td></tr>}</tbody></table>
        )}
      </Card>

      <Card title="Stored memories">
        <table>
          <thead><tr><th>Kind</th><th>Scope</th><th>Agent</th><th>Memory</th><th>Salience</th><th>Used</th><th>Created</th><th /></tr></thead>
          <tbody>
            {mem.data?.map((m) => (
              <tr key={m.id}><td>{m.kind}</td><td>{m.scope}</td><td>{m.agent_name ?? "—"}</td><td>{m.content}{!m.embedded && <span className="muted small"> · keyword-only</span>}</td>
                <td>{m.salience.toFixed(2)}</td><td>{m.access_count}</td><td>{when(m.created_at)}</td>
                <td>{edit && <button className="danger" onClick={() => run(async () => { await del(`/api/memories/${m.id}`); await mem.reload(); })}>Delete</button>}</td></tr>
            ))}
            {mem.data?.length === 0 && <tr><td colSpan={8} className="muted">Nothing stored yet. Agents write episodic memories as they finish tasks and lessons when reviewers request changes.</td></tr>}
          </tbody>
        </table>
        {edit && (
          <form onSubmit={add} className="grid">
            <label>Kind<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="semantic">fact (semantic)</option><option value="lesson">lesson</option></select></label>
            <label>Scope<select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="agent">one agent</option><option value="team">team</option>{admin && <option value="org">whole organisation</option>}</select></label>
            {f.scope === "agent" && <label>Agent<select value={f.agent_id || agentId} onChange={(e) => setF({ ...f, agent_id: e.target.value })} required><option value="" disabled>Choose…</option>{agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
            {f.scope === "team" && <label>Team<select value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })} required><option value="" disabled>Choose…</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
            <label className="full">Content<textarea rows={2} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} required /></label>
            <button className="primary">Add memory</button>
          </form>
        )}
        <p className="muted small">An agent can only read and write memory within the reach its admin-set permission allows (agent → team → org); it cannot widen that itself.</p>
      </Card>
    </>
  );
}
