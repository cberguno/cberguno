import { useState, type FormEvent } from "react";
import { del, get, patch, post } from "../api";
import { canEdit, isAdmin, useAuth } from "../auth";
import { Badge, Card, Err, useLoad, usd } from "../ui";

export default function Models() {
  const { me } = useAuth();
  const admin = isAdmin(me?.role);
  const providers = useLoad(() => get<any[]>("/api/providers"));
  const models = useLoad(() => get<any[]>("/api/models"));
  const presets = useLoad(() => get<any[]>("/api/provider-presets"));
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pf, setPf] = useState({ name: "", kind: "openai_compat", base_url: "", api_key: "" });
  const [mf, setMf] = useState({ provider_id: "", model_name: "", display_name: "", tier: "standard", kind: "chat", context_window: 128000, supports_tools: false, usd_per_mtok_in: 0, usd_per_mtok_out: 0 });
  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    try { setErr(null); await fn(); after(); } catch (e) { setErr((e as Error).message); }
  };
  const addProvider = (e: FormEvent) => { e.preventDefault(); void run(() => post("/api/providers", { ...pf, api_key: pf.api_key || undefined }), () => { setPf({ name: "", kind: "openai_compat", base_url: "", api_key: "" }); void providers.reload(); }); };
  const addModel = (e: FormEvent) => { e.preventDefault(); void run(() => post("/api/models", { ...mf, display_name: mf.display_name || mf.model_name }), () => { void models.reload(); }); };
  const test = async (id: string) => {
    setNote("Testing…");
    try { const r = await post(`/api/providers/${id}/test`); setNote(`OK via ${r.model} in ${r.latency_ms} ms`); } catch (e) { setNote(`Failed: ${(e as Error).message}`); }
  };

  return (
    <>
      <Err msg={err ?? providers.error ?? models.error} />
      {note && <div className="notice" role="status">{note}</div>}
      <Card title="Providers">
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Base URL</th><th>Key</th><th>Status</th><th /></tr></thead>
          <tbody>
            {providers.data?.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td><td>{p.kind}</td><td className="mono small">{p.base_url}</td>
                <td>{p.has_key ? `••••${p.key_hint}` : <span className="muted">none</span>}</td>
                <td><Badge s={p.enabled ? "active" : "paused"} /></td>
                <td className="row">
                  {admin && <button onClick={() => test(p.id)}>Test</button>}
                  {admin && <button onClick={() => run(() => patch(`/api/providers/${p.id}`, { enabled: !p.enabled }), () => void providers.reload())}>{p.enabled ? "Disable" : "Enable"}</button>}
                  {admin && <button className="danger" onClick={() => confirm(`Delete provider ${p.name} and its models?`) && run(() => del(`/api/providers/${p.id}`), () => { void providers.reload(); void models.reload(); })}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (
          <form onSubmit={addProvider} className="grid">
            <label>Preset
              <select onChange={(e) => { const p = presets.data?.find((x) => x.name === e.target.value); if (p) setPf({ ...pf, name: p.name, kind: p.kind, base_url: p.baseUrl }); }} defaultValue="">
                <option value="" disabled>Choose…</option>
                {presets.data?.map((p) => <option key={p.name}>{p.name}</option>)}
              </select>
            </label>
            <label>Name<input value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} required /></label>
            <label>Kind
              <select value={pf.kind} onChange={(e) => setPf({ ...pf, kind: e.target.value })}>
                <option value="openai_compat">OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option>
              </select>
            </label>
            <label>Base URL<input value={pf.base_url} onChange={(e) => setPf({ ...pf, base_url: e.target.value })} required /></label>
            <label>API key (stored encrypted, never shown again)<input type="password" autoComplete="off" value={pf.api_key} onChange={(e) => setPf({ ...pf, api_key: e.target.value })} /></label>
            <button className="primary">Add provider</button>
          </form>
        )}
      </Card>

      <Card title="Models">
        <table>
          <thead><tr><th>Model</th><th>Provider</th><th>Tier</th><th>Context</th><th>$/Mtok in</th><th>$/Mtok out</th><th>Latency</th><th /></tr></thead>
          <tbody>
            {models.data?.map((m) => (
              <tr key={m.id} className={m.enabled ? "" : "dim"}>
                <td>{m.display_name}<div className="muted small mono">{m.model_name}</div></td><td>{m.provider_name}</td><td>{m.tier}{m.kind === "embedding" && <div className="muted small">embedding</div>}</td>
                <td>{m.context_window.toLocaleString()}</td><td>{usd(m.usd_per_mtok_in)}</td><td>{usd(m.usd_per_mtok_out)}</td>
                <td>{m.avg_latency_ms ? `${m.avg_latency_ms} ms` : "—"}</td>
                <td className="row">
                  {admin && <button onClick={() => run(() => patch(`/api/models/${m.id}`, { enabled: !m.enabled }), () => void models.reload())}>{m.enabled ? "Disable" : "Enable"}</button>}
                  {admin && <button className="danger" onClick={() => run(() => del(`/api/models/${m.id}`), () => void models.reload())}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (providers.data?.length ?? 0) > 0 && (
          <form onSubmit={addModel} className="grid">
            <label>Provider
              <select value={mf.provider_id} onChange={(e) => setMf({ ...mf, provider_id: e.target.value })} required>
                <option value="" disabled>Choose…</option>{providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Model id (as sent to the API)<input value={mf.model_name} onChange={(e) => setMf({ ...mf, model_name: e.target.value })} required /></label>
            <label>Display name<input value={mf.display_name} onChange={(e) => setMf({ ...mf, display_name: e.target.value })} /></label>
            <label>Tier
              <select value={mf.tier} onChange={(e) => setMf({ ...mf, tier: e.target.value })}><option value="fast">fast</option><option value="standard">standard</option><option value="frontier">frontier</option></select>
            </label>
            <label>Kind
              <select value={mf.kind} onChange={(e) => setMf({ ...mf, kind: e.target.value })}><option value="chat">chat</option><option value="embedding">embedding (memory)</option></select>
            </label>
            <label>Context window<input type="number" min={1} value={mf.context_window} onChange={(e) => setMf({ ...mf, context_window: +e.target.value })} /></label>
            <label>$ / Mtok input<input type="number" step="any" min={0} value={mf.usd_per_mtok_in} onChange={(e) => setMf({ ...mf, usd_per_mtok_in: +e.target.value })} /></label>
            <label>$ / Mtok output<input type="number" step="any" min={0} value={mf.usd_per_mtok_out} onChange={(e) => setMf({ ...mf, usd_per_mtok_out: +e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={mf.supports_tools} onChange={(e) => setMf({ ...mf, supports_tools: e.target.checked })} />Supports tools</label>
            <button className="primary">Add model</button>
          </form>
        )}
        {!canEdit(me?.role) && <p className="muted small">Read-only: ask an admin to change providers and models.</p>}
        <p className="muted small">Prices and model ids are entered by you from each vendor's pricing page — they are not bundled, because they change.</p>
      </Card>
    </>
  );
}
