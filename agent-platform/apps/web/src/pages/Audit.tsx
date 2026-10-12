import { get } from "../api";
import { Card, Err, useLoad, when } from "../ui";

export default function Audit() {
  const { data, error } = useLoad(() => get<any[]>("/api/audit?limit=200"));
  return (
    <Card title="Audit log (append-only)">
      <Err msg={error} />
      <table>
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          {data?.map((r) => (
            <tr key={r.id}>
              <td>{when(r.at)}</td><td>{r.actor_kind}{r.actor_id ? ` ${String(r.actor_id).slice(0, 8)}` : ""}</td>
              <td><code>{r.action}</code></td><td>{r.target_type} {r.target_id ? String(r.target_id).slice(0, 8) : ""}</td>
              <td className="small mono">{JSON.stringify(r.detail).slice(0, 120)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
