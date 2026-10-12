import { useCallback, useEffect, useState, type ReactNode } from "react";

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setData(await fn()); setError(null); } catch (e) { setError((e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload, setData };
}

export const Err = ({ msg }: { msg: string | null }) => (msg ? <div className="error" role="alert">{msg}</div> : null);

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && <header><h2>{title}</h2><div className="row">{actions}</div></header>}
      {children}
    </section>
  );
}

export const usd = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(Number(n ?? 0) < 1 ? 4 : 2)}`;
export const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
export const Badge = ({ s }: { s: string }) => <span className={`badge ${s}`}>{s.replace("_", " ")}</span>;

/** Risk of a tool: read-only (green), write (amber), irreversible (red). Shows the risk, not a status word. */
export const RiskBadge = ({ risk }: { risk: string }) => <span className={`badge ${risk === "read" ? "active" : risk === "write" ? "paused" : "failed"}`}>{risk}</span>;
