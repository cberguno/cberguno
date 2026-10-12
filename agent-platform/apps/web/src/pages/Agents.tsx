import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { get, patch, post } from "../api";
import { canEdit, isAdmin, useAuth } from "../auth";
import { Badge, Card, Err, useLoad, usd } from "../ui";

const blank = {
  name: "", kind: "specialist", role: "", goal: "", instructions: "", model_id: "" as string,
  routing: { strategy: "cheapest", complexity: "medium" } as any,
  tools: "", memory_scope: "agent", max_cost_usd_per_run: 0.5, daily_budget_usd: 5, run_timeout_ms: 120000,
};

export default function Agents() {
  const { me } = useAuth();
  const edit = canEdit(me?.role), admin = isAdmin(me?.role);
  const agents = useLoad(() => get<any[]>("/api/agents"));
  const models = useLoad(() => get<any[]>("/api/models"));
  const [form, setForm] = useState<typeof blank & { id?: string }>(blank);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (a?: any) => {
    setErr(null);
    setForm(a ? { ...blank, ...a, model_id: a.model_id ?? "", tools: (a.permissions?.tools ?? []).join(", "), memory_scope: a.permissions?.memory_scope ?? "agent" } : blank);
    setOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: any = { name: form.name, kind: form.kind, role: form.role, goal: form.goal, instructions: form.instructions, model_id: form.model_id || null, routing: form.routing };
    if (admin) {
      body.permissions = { tools: form.tools.split(",").map((s) => s.trim()).filter(Boolean), memory_scope: form.memory_scope };
      body.max_cost_usd_per_run = +form.max_cost_usd_per_run; body.daily_budget_usd = +form.daily_budget_usd; body.run_timeout_ms = +form.run_timeout_ms;
    }
    try { form.id ? await patch(`/api/agents/${form.id}`, body) : await post("/api/agents", body); setOpen(false); await agents.reload(); } catch (x) { setErr((x as Error).message); }
  };
  const status = async (id: string, s: string) => { try { await post(`/api/agents/${id}/status`, { status: s }); await agents.reload(); } catch (x) { setErr((x as Error).message); } };

  return (
    <>
      <Card title="Agents" actions={edit && <button className="primary" onClick={() => startEdit()}>New agent</button>}>
        <Err msg={err && !open ? err : agents.error} />
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Kind</th><th>Model</th><th>Today / budget</th><th>Status</th><th /></tr></thead>
          <tbody>
            {agents.data?.map((a) => (
              <tr key={a.id}>
                <td><b>{a.name}</b><div className="muted small">v{a.version}</div></td><td>{a.role}</td><td>{a.kind}</td>
                <td>{a.model_name ?? <span className="muted">auto · {a.routing.strategy}/{a.routing.complexity}</span>}</td>
                <td>{usd(a.spent_today_usd)} / {usd(a.daily_budget_usd)}</td><td><Badge s={a.status} /></td>
                <td className="row">
                  <Link to={`/runs?agent=${a.id}`} className="btn">Run</Link>
                  {edit && a.status !== "terminated" && <button onClick={() => startEdit(a)}>Edit</button>}
                  {edit && a.status === "active" && <button onClick={() => status(a.id, "paused")}>Pause</button>}
                  {edit && a.status === "paused" && <button onClick={() => status(a.id, "active")}>Resume</button>}
                  {edit && a.status !== "terminated" && <button className="danger" onClick={() => confirm(`Terminate ${a.name}? This cannot be undone.`) && status(a.id, "terminated")}>Terminate</button>}
                </td>
              </tr>
            ))}
            {agents.data?.length === 0 && <tr><td colSpan={7} className="muted">No agents yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      {open && (
        <Card title={form.id ? `Edit ${form.name}` : "New agent"}>
          <form onSubmit={save} className="grid wide">
            <Err msg={err} />
            <label>Name<input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} /></label>
            <label>Kind
              <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                {["orchestrator", "specialist", "research", "execution", "qa"].map((k) => <option key={k}>{k}</option>)}
              </select>
            </label>
            <label className="full">Role (one line)<input value={form.role} onChange={(e) => set("role", e.target.value)} required /></label>
            <label className="full">Goal<textarea rows={2} value={form.goal} onChange={(e) => set("goal", e.target.value)} /></label>
            <label className="full">Instructions<textarea rows={6} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} /></label>
            <label>Model
              <select value={form.model_id} onChange={(e) => set("model_id", e.target.value)}>
                <option value="">Auto-route by policy</option>
                {models.data?.map((m) => <option key={m.id} value={m.id}>{m.display_name} ({m.provider_name})</option>)}
              </select>
            </label>
            <label>Routing strategy
              <select disabled={!!form.model_id} value={form.routing.strategy} onChange={(e) => set("routing", { ...form.routing, strategy: e.target.value })}>
                <option>cheapest</option><option>fastest</option><option>quality</option>
              </select>
            </label>
            <label>Task complexity
              <select disabled={!!form.model_id} value={form.routing.complexity} onChange={(e) => set("routing", { ...form.routing, complexity: e.target.value })}>
                <option>low</option><option>medium</option><option>high</option>
              </select>
            </label>
            <fieldset className="full" disabled={!admin}>
              <legend>Permissions and limits {admin ? "" : "(admin only)"}</legend>
              <div className="grid">
                <label>Allowed tools (comma-separated; enforced from Phase 3)<input value={form.tools} onChange={(e) => set("tools", e.target.value)} /></label>
                <label>Memory scope
                  <select value={form.memory_scope} onChange={(e) => set("memory_scope", e.target.value)}><option>agent</option><option>team</option><option>org</option></select>
                </label>
                <label>Max cost per run (USD)<input type="number" step="any" min={0} value={form.max_cost_usd_per_run} onChange={(e) => set("max_cost_usd_per_run", e.target.value)} /></label>
                <label>Daily budget (USD)<input type="number" step="any" min={0} value={form.daily_budget_usd} onChange={(e) => set("daily_budget_usd", e.target.value)} /></label>
                <label>Run timeout (ms)<input type="number" min={1000} value={form.run_timeout_ms} onChange={(e) => set("run_timeout_ms", e.target.value)} /></label>
              </div>
            </fieldset>
            <div className="row full"><button className="primary">{form.id ? "Save new version" : "Create agent"}</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
          </form>
        </Card>
      )}
    </>
  );
}
