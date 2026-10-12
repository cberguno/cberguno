import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { del, get, patch, post } from "../api";
import { canEdit, useAuth } from "../auth";
import { Badge, Card, Err, useLoad, when } from "../ui";

const PRESETS: [string, string][] = [["Every day at 07:00", "0 7 * * *"], ["Every weekday at 09:00", "0 9 * * 1-5"], ["Every hour", "0 * * * *"], ["Every Monday 08:00", "0 8 * * 1"], ["Every 15 minutes", "*/15 * * * *"]];

export default function Schedules() {
  const { me } = useAuth();
  const edit = canEdit(me?.role);
  const list = useLoad(() => get<any[]>("/api/schedules"));
  const teams = useLoad(() => get<any[]>("/api/teams"));
  const [f, setF] = useState({ name: "", cron: "0 7 * * *", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", team_id: "", title: "", goal: "", max_cost_usd: 1, overlap: "skip" });
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { try { setErr(null); await fn(); await list.reload(); } catch (e) { setErr((e as Error).message); } };
  const create = (e: FormEvent) => { e.preventDefault(); void run(async () => { await post("/api/schedules", { name: f.name, cron: f.cron, timezone: f.timezone, overlap: f.overlap, mission: { title: f.title || f.name, goal: f.goal, team_id: f.team_id, max_cost_usd: +f.max_cost_usd } }); setF({ ...f, name: "", title: "", goal: "" }); }); };

  return (
    <>
      <Err msg={err ?? list.error} />
      {note && <div className="notice" role="status">{note}</div>}
      <Card title="Schedules and monitors">
        <p className="muted small">A schedule starts a mission on a timetable (a “monitor” is simply a scheduled mission whose goal is to check something and report changes — agents keep what they saw in memory). Anything that changes the outside world still waits for approval, even when scheduled.</p>
        <table>
          <thead><tr><th>Name</th><th>When</th><th>Next run</th><th>Last mission</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list.data?.map((s) => (
              <tr key={s.id} className={s.enabled ? "" : "dim"}>
                <td><b>{s.name}</b><div className="muted small">{s.team_name} · cap ${s.mission.max_cost_usd ?? 2} · overlap: {s.overlap}</div>{s.last_error && <div className="small error-text">{s.last_error}</div>}</td>
                <td className="mono small">{s.cron}<div className="muted">{s.timezone}</div></td><td>{s.enabled ? when(s.next_run_at) : "—"}</td>
                <td>{s.last_mission_id ? <Link to={`/missions?mission=${s.last_mission_id}`}>{s.last_mission_status}</Link> : "—"}</td>
                <td><Badge s={s.enabled ? "active" : "paused"} /></td>
                <td className="row">{edit && <>
                  <button onClick={() => run(async () => { const r = await post(`/api/schedules/${s.id}/run-now`); setNote(`Started mission ${r.id.slice(0, 8)}…`); })}>Run now</button>
                  <button onClick={() => run(() => patch(`/api/schedules/${s.id}`, { enabled: !s.enabled }))}>{s.enabled ? "Pause" : "Resume"}</button>
                  <button className="danger" onClick={() => confirm(`Delete ${s.name}?`) && run(() => del(`/api/schedules/${s.id}`))}>Delete</button></>}</td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td colSpan={6} className="muted">No schedules yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {edit && (
        <Card title="New schedule">
          <form onSubmit={create} className="grid wide">
            <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
            <label>Team<select value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })} required><option value="" disabled>Choose…</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Preset<select value="" onChange={(e) => e.target.value && setF({ ...f, cron: e.target.value })}><option value="">Choose…</option>{PRESETS.map(([l, c]) => <option key={c} value={c}>{l}</option>)}</select></label>
            <label>Cron (min hour day month weekday)<input className="mono" value={f.cron} onChange={(e) => setF({ ...f, cron: e.target.value })} required /></label>
            <label>Time zone<input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} required /></label>
            <label>Cost cap per run (USD)<input type="number" step="any" min={0.0001} value={f.max_cost_usd} onChange={(e) => setF({ ...f, max_cost_usd: +e.target.value })} /></label>
            <label>If the last run is still going<select value={f.overlap} onChange={(e) => setF({ ...f, overlap: e.target.value })}><option value="skip">skip this run</option><option value="allow">start another anyway</option></select></label>
            <label>Mission title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="defaults to the name" /></label>
            <label className="full">Goal<textarea rows={3} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} required /></label>
            <div className="row full"><button className="primary">Create schedule</button></div>
          </form>
        </Card>
      )}
    </>
  );
}
