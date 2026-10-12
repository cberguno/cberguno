import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../api";
import { canEdit, isAdmin, useAuth } from "../auth";
import { Badge, Card, Err, RiskBadge, useLoad, when } from "../ui";

export default function Approvals() {
  const { me } = useAuth();
  const list = useLoad(() => get<any[]>("/api/approvals"));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => void list.reload(), 3000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = list.data?.filter((a) => a.status === "pending") ?? [];
  const done = list.data?.filter((a) => a.status !== "pending") ?? [];
  const decide = async (id: string, d: "approve" | "reject") => { try { setErr(null); await post(`/api/approvals/${id}/${d}`, { note: notes[id] || undefined }); await list.reload(); } catch (e) { setErr((e as Error).message); } };

  return (
    <>
      <Err msg={err ?? list.error} />
      <Card title={`Waiting for your decision (${pending.length})`}>
        {pending.length === 0 && <p className="muted">Nothing is waiting. Agents will ask here before doing anything that changes the outside world.</p>}
        {pending.map((a) => {
          const blocked = a.risk === "irreversible" && !isAdmin(me?.role);
          return (
            <div key={a.id} className="approval">
              <div className="row"><b className="mono">{a.tool_name}</b><RiskBadge risk={a.risk} />
                <span className="muted small">requested {when(a.requested_at)} · expires {when(a.expires_at)}</span></div>
              <p className="small muted">{a.agent_name} wants to do this for <Link to={`/missions?mission=${a.mission_id}`}>{a.mission_title}</Link> (task: {a.task_title})</p>
              <pre className="output" aria-label="Exactly what will be sent">{JSON.stringify(a.args, null, 2)}</pre>
              <p className="small muted">If approved, exactly these values are sent — once. Review them as carefully as you would a payment.</p>
              <div className="row">
                <input placeholder="Note (optional)" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} aria-label="Decision note" />
                <button className="primary" disabled={!canEdit(me?.role) || blocked} onClick={() => decide(a.id, "approve")}>Approve</button>
                <button className="danger" disabled={!canEdit(me?.role)} onClick={() => decide(a.id, "reject")}>Reject</button>
              </div>
              {blocked && <p className="small error-text">Irreversible actions (payments, bookings, cancellations) can only be approved by an admin.</p>}
            </div>
          );
        })}
      </Card>
      <Card title="History">
        <table><thead><tr><th>When</th><th>Tool</th><th>Agent</th><th>Mission</th><th>Decision</th><th>By</th><th>Note</th></tr></thead>
          <tbody>{done.map((a) => <tr key={a.id}><td>{when(a.decided_at ?? a.requested_at)}</td><td className="mono">{a.tool_name}</td><td>{a.agent_name}</td><td>{a.mission_title}</td><td><Badge s={a.status} /></td><td>{a.decided_by_email ?? "—"}</td><td>{a.decision_note ?? ""}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}
