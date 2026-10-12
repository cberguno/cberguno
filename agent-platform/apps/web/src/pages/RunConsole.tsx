import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { get, post, streamRun, type RunEvent } from "../api";
import { canEdit, useAuth } from "../auth";
import { Badge, Card, Err, useLoad, usd, when } from "../ui";

export default function RunConsole() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const agents = useLoad(() => get<any[]>("/api/agents"));
  const runs = useLoad(() => get<any[]>("/api/runs?limit=20"));
  const [agentId, setAgentId] = useState(params.get("agent") ?? "");
  const [input, setInput] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [run, setRun] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const follow = async (id: string) => {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setRunId(id); setEvents([]); setRun(null);
    try { await streamRun(id, (e) => setEvents((xs) => [...xs, e]), ac.signal); } catch (e) { if ((e as Error).name !== "AbortError") setErr((e as Error).message); }
    if (!ac.signal.aborted) { setRun(await get(`/api/runs/${id}`)); void runs.reload(); }
  };
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    setErr(null);
    try { const { id } = await post(`/api/agents/${agentId}/runs`, { input }); void follow(id); } catch (e) { setErr((e as Error).message); }
  };
  const running = runId && !run;

  return (
    <>
      <Card title="Run console">
        <Err msg={err ?? agents.error} />
        <div className="grid wide">
          <label>Agent
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Choose…</option>
              {agents.data?.filter((a) => a.status === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="full">Task / message<textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)} /></label>
          <div className="row full">
            <button className="primary" disabled={!canEdit(me?.role) || !agentId || !input.trim() || !!running} onClick={start}>Run</button>
            {running && <button onClick={() => post(`/api/runs/${runId}/cancel`).catch((e) => setErr(e.message))}>Cancel</button>}
            {!canEdit(me?.role) && <span className="muted small">Viewers cannot start runs.</span>}
          </div>
        </div>
      </Card>

      {runId && (
        <Card title="Live run" actions={run ? <Badge s={run.status} /> : <Badge s="running" />}>
          <ol className="timeline">
            {events.map((e) => (
              <li key={e.id}><b>{e.type}</b> <span className="muted small">{new Date(e.at).toLocaleTimeString()}</span>
                <div className="small mono">{Object.entries(e.data).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("  ")}</div></li>
            ))}
          </ol>
          {run && (
            <>
              <div className="stats">
                <div><b>{usd(run.cost_usd)}</b><span>cost</span></div><div><b>{run.tokens_in}</b><span>tokens in</span></div><div><b>{run.tokens_out}</b><span>tokens out</span></div>
              </div>
              {run.error && <div className="error">{run.error}</div>}
              {run.output && <pre className="output">{run.output}</pre>}
            </>
          )}
        </Card>
      )}

      <Card title="Recent runs">
        <table>
          <thead><tr><th>When</th><th>Agent</th><th>Input</th><th>Status</th><th>Cost</th><th /></tr></thead>
          <tbody>
            {runs.data?.map((r) => (
              <tr key={r.id}><td>{when(r.started_at)}</td><td>{r.agent_name}</td><td className="clip">{r.input}</td><td><Badge s={r.status} /></td><td>{usd(r.cost_usd)}</td>
                <td><button onClick={() => follow(r.id)}>Open</button></td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
