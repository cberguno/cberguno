import { useState } from "react";
import { get } from "../api";
import { Card, Err, useLoad, usd } from "../ui";

export default function Usage() {
  const [days, setDays] = useState(7);
  const { data, error } = useLoad(() => get(`/api/usage/summary?days=${days}`), [days]);
  const max = Math.max(1e-9, ...(data?.byDay.map((d: any) => d.cost_usd) ?? [0]));
  return (
    <>
      <Card title="Cost & token usage" actions={
        <select value={days} onChange={(e) => setDays(+e.target.value)} aria-label="Range">
          {[1, 7, 30, 90].map((d) => <option key={d} value={d}>Last {d} day{d > 1 ? "s" : ""}</option>)}
        </select>}>
        <Err msg={error} />
        {data && (
          <div className="stats">
            <div><b>{usd(data.totals.cost_usd)}</b><span>total cost</span></div>
            <div><b>{data.totals.calls}</b><span>model calls</span></div>
            <div><b>{data.totals.tokens_in.toLocaleString()}</b><span>input tokens</span></div>
            <div><b>{data.totals.tokens_out.toLocaleString()}</b><span>output tokens</span></div>
          </div>
        )}
        {data && data.byDay.length > 0 && (
          <svg viewBox={`0 0 ${data.byDay.length * 40} 90`} className="chart" role="img" aria-label="Cost per day">
            {data.byDay.map((d: any, i: number) => {
              const h = (d.cost_usd / max) * 60;
              return <g key={d.day}><rect x={i * 40 + 6} y={70 - h} width="28" height={Math.max(h, 1)} rx="3" /><text x={i * 40 + 20} y="84" textAnchor="middle">{d.day.slice(5)}</text></g>;
            })}
          </svg>
        )}
      </Card>
      <Card title="By agent">
        <table><thead><tr><th>Agent</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead>
          <tbody>{data?.byAgent.map((a: any) => <tr key={a.id}><td>{a.name}</td><td>{a.calls}</td><td>{a.tokens_in}</td><td>{a.tokens_out}</td><td>{usd(a.cost_usd)}</td></tr>)}</tbody></table>
      </Card>
      <Card title="By model">
        <table><thead><tr><th>Model</th><th>Calls</th><th>Avg latency</th><th>Cost</th></tr></thead>
          <tbody>{data?.byModel.map((m: any) => <tr key={m.id}><td>{m.display_name}</td><td>{m.calls}</td><td>{m.avg_latency_ms} ms</td><td>{usd(m.cost_usd)}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}
