import { useState, type FormEvent } from "react";
import { del, get, patch, post } from "../api";
import { isAdmin, useAuth } from "../auth";
import { Badge, Card, Err, RiskBadge, useLoad, when } from "../ui";

const SCHEMA_EXAMPLE = '{\n  "type": "object",\n  "properties": { "to": { "type": "string", "description": "IATA code" } },\n  "required": ["to"]\n}';

export default function Tools() {
  const { me } = useAuth();
  const admin = isAdmin(me?.role);
  const tools = useLoad(() => get<any[]>("/api/tools"));
  const servers = useLoad(() => get<any[]>("/api/mcp-servers"));
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState<{ id: string; args: string } | null>(null);
  const [tf, setTf] = useState({ name: "", description: "", method: "GET", url: "", auth: "none", api_key: "", risk: "read", approval: "never", schema: SCHEMA_EXAMPLE });
  const [sf, setSf] = useState({ name: "", url: "", api_key: "", auth_header: "Authorization" });
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { try { setErr(null); await fn(); after?.(); } catch (e) { setErr((e as Error).message); } };
  const reload = () => { void tools.reload(); void servers.reload(); };

  const addTool = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      let schema; try { schema = JSON.parse(tf.schema); } catch { throw new Error("Input schema is not valid JSON"); }
      await post("/api/tools", {
        name: tf.name, description: tf.description, input_schema: schema, risk: tf.risk, approval: tf.risk === "irreversible" ? "required" : tf.approval,
        config: { method: tf.method, url: tf.url, ...(tf.auth !== "none" ? { auth: { type: tf.auth } } : {}) }, api_key: tf.api_key || undefined,
      });
      setTf({ ...tf, name: "", description: "", url: "", api_key: "" });
    }, reload);
  };

  return (
    <>
      <Err msg={err ?? tools.error} />
      {note && <div className="notice" role="status">{note}</div>}
      <Card title="Tools">
        <p className="muted small">Agents can only use tools an admin has granted them (Agents → Permissions). Anything that changes the outside world waits for a human to approve it.</p>
        <table>
          <thead><tr><th>Tool</th><th>Source</th><th>Risk</th><th>Approval</th><th>Granted to</th><th>Status</th><th /></tr></thead>
          <tbody>
            {tools.data?.map((t) => (
              <>
                <tr key={t.id} className={t.enabled ? "" : "dim"}>
                  <td><b className="mono">{t.name}</b><div className="muted small">{t.description.slice(0, 110)}</div></td>
                  <td>{t.kind === "mcp" ? `MCP · ${t.server_name}` : t.kind}</td>
                  <td><RiskBadge risk={t.risk} /></td>
                  <td>{t.approval === "required" ? "human approval" : "automatic"}</td>
                  <td className="small">{t.granted_to.length ? t.granted_to.join(", ") : <span className="muted">nobody</span>}</td>
                  <td>{t.needs_review ? <span className="badge failed" title={t.review_reason}>needs review</span> : <Badge s={t.enabled ? "active" : "paused"} />}</td>
                  <td className="row">
                    {admin && t.needs_review && <button className="primary" onClick={() => run(() => patch(`/api/tools/${t.id}`, { acknowledge_review: true, enabled: true }), reload)}>Approve change</button>}
                    {admin && !t.needs_review && <button onClick={() => run(() => patch(`/api/tools/${t.id}`, { enabled: !t.enabled }), reload)}>{t.enabled ? "Disable" : "Enable"}</button>}
                    {admin && t.risk !== "irreversible" && <button onClick={() => run(() => patch(`/api/tools/${t.id}`, { approval: t.approval === "required" ? "never" : "required" }), reload)}>{t.approval === "required" ? "Skip approval" : "Require approval"}</button>}
                    {admin && t.risk === "read" && !t.name.startsWith("memory_") && <button onClick={() => setTesting({ id: t.id, args: "{}" })}>Test</button>}
                    {admin && t.kind === "http" && <button className="danger" onClick={() => confirm(`Delete ${t.name}?`) && run(() => del(`/api/tools/${t.id}`), reload)}>Delete</button>}
                  </td>
                </tr>
                {testing && testing.id === t.id && (
                  <tr key={t.id + "t"}><td colSpan={7}>
                    <div className="row"><textarea rows={3} className="mono" value={testing.args} onChange={(e) => setTesting({ ...testing, args: e.target.value })} aria-label="Test arguments (JSON)" />
                      <button className="primary" onClick={() => run(async () => { const r = await post(`/api/tools/${t.id}/test`, { args: JSON.parse(testing.args) }); setNote(`${t.name}: ${r.result.slice(0, 600)}`); })}>Run</button>
                      <button onClick={() => setTesting(null)}>Close</button></div>
                  </td></tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="MCP servers">
        <p className="muted small">Model Context Protocol servers expose ready-made tools (flights, hotels, calendars…). Syncing lists their tools here. Tools not declared read-only start as “needs approval”; if a server later changes a tool, it is switched off until an admin approves the change.</p>
        <table>
          <thead><tr><th>Server</th><th>URL</th><th>Tools</th><th>Last sync</th><th /></tr></thead>
          <tbody>
            {servers.data?.map((s) => (
              <tr key={s.id}>
                <td><b>{s.name}</b>{s.has_key && <span className="muted small"> · key ••••{s.key_hint}</span>}</td><td className="mono small">{s.url}</td><td>{s.tool_count}</td>
                <td className="small">{when(s.last_synced_at)}{s.last_error && <div className="error-text">{s.last_error}</div>}</td>
                <td className="row">{admin && <>
                  <button onClick={() => run(async () => { const r = await post(`/api/mcp-servers/${s.id}/sync`); setNote(`Synced ${s.name}: ${r.added} new, ${r.updated} changed${r.flagged ? `, ${r.flagged} need review` : ""}`); }, reload)}>Sync tools</button>
                  <button className="danger" onClick={() => confirm(`Remove ${s.name} and its tools?`) && run(() => del(`/api/mcp-servers/${s.id}`), reload)}>Remove</button></>}</td>
              </tr>
            ))}
            {servers.data?.length === 0 && <tr><td colSpan={5} className="muted">No MCP servers yet.</td></tr>}
          </tbody>
        </table>
        {admin && (
          <form className="grid" onSubmit={(e) => { e.preventDefault(); void run(() => post("/api/mcp-servers", { name: sf.name, url: sf.url, api_key: sf.api_key || undefined, auth_header: sf.auth_header }), () => { setSf({ ...sf, name: "", url: "", api_key: "" }); reload(); }); }}>
            <label>Name (lowercase)<input value={sf.name} onChange={(e) => setSf({ ...sf, name: e.target.value })} required pattern="[a-z][a-z0-9]{0,23}" /></label>
            <label>Server URL<input value={sf.url} onChange={(e) => setSf({ ...sf, url: e.target.value })} required type="url" placeholder="https://mcp.example.com/mcp" /></label>
            <label>API key / token (optional, stored encrypted)<input type="password" autoComplete="off" value={sf.api_key} onChange={(e) => setSf({ ...sf, api_key: e.target.value })} /></label>
            <label>Auth header<input value={sf.auth_header} onChange={(e) => setSf({ ...sf, auth_header: e.target.value })} /></label>
            <button className="primary">Add MCP server</button>
          </form>
        )}
      </Card>

      {admin && (
        <Card title="Add an HTTP API as a tool">
          <form onSubmit={addTool} className="grid wide">
            <label>Tool name (a-z, 0-9, _)<input value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} required pattern="[a-z][a-z0-9_]*" /></label>
            <label>Method<select value={tf.method} onChange={(e) => setTf({ ...tf, method: e.target.value })}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="full">What it does (the agent reads this)<input value={tf.description} onChange={(e) => setTf({ ...tf, description: e.target.value })} required /></label>
            <label className="full">URL (use {"{param}"} for path parameters)<input value={tf.url} onChange={(e) => setTf({ ...tf, url: e.target.value })} required type="url" placeholder="https://api.example.com/flights/{id}" /></label>
            <label>Authentication<select value={tf.auth} onChange={(e) => setTf({ ...tf, auth: e.target.value })}><option value="none">none</option><option value="bearer">Bearer token</option><option value="header">API-key header</option><option value="query">API-key query parameter</option></select></label>
            <label>API key (stored encrypted, never shown)<input type="password" autoComplete="off" value={tf.api_key} onChange={(e) => setTf({ ...tf, api_key: e.target.value })} disabled={tf.auth === "none"} /></label>
            <label>Risk<select value={tf.risk} onChange={(e) => setTf({ ...tf, risk: e.target.value, approval: e.target.value === "read" ? "never" : "required" })}>
              <option value="read">read-only (look things up)</option><option value="write">write (changes something)</option><option value="irreversible">irreversible (payments, bookings, cancellations)</option></select></label>
            <label>Approval<select value={tf.risk === "irreversible" ? "required" : tf.approval} disabled={tf.risk === "irreversible"} onChange={(e) => setTf({ ...tf, approval: e.target.value })}><option value="never">automatic</option><option value="required">human approval</option></select></label>
            <label className="full">Input schema (JSON Schema)<textarea rows={6} className="mono" value={tf.schema} onChange={(e) => setTf({ ...tf, schema: e.target.value })} /></label>
            <div className="row full"><button className="primary">Add tool</button></div>
          </form>
        </Card>
      )}
    </>
  );
}
