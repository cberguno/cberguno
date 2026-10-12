export type Role = "admin" | "operator" | "viewer";

let token: string | null = null;
try { token = sessionStorage.getItem("ap_token"); } catch { /* storage unavailable */ }

export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try { t ? sessionStorage.setItem("ap_token", t) : sessionStorage.removeItem("ap_token"); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && token) { setToken(null); location.assign("/login"); }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.issues ? data.issues.map((i: any) => `${i.path}: ${i.message}`).join("; ") : data.error ?? res.statusText;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const patch = <T = any>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>("PUT", p, b);
export const del = <T = any>(p: string) => api<T>("DELETE", p);

export type RunEvent = { id: number; type: string; data: Record<string, any>; at: string };

/** SSE over fetch so the bearer token travels in a header, not a URL. */
export async function streamRun(runId: string, onEvent: (e: RunEvent) => void, signal: AbortSignal) {
  const res = await fetch(`/api/runs/${runId}/events`, { headers: { authorization: `Bearer ${token}` }, signal });
  if (!res.ok || !res.body) throw new ApiError("stream failed", res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}
