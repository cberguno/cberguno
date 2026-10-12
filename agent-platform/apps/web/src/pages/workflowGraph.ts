export type WNode = { key: string; title: string; assignee: string; input: string; depends_on: string[]; x: number; y: number };
export const W = 190, H = 62;

/** Would making `to` depend on `from` create a cycle? (i.e. does `from` already depend on `to`, directly or not.) */
export function wouldCycle(nodes: WNode[], from: string, to: string): boolean {
  const by = new Map(nodes.map((n) => [n.key, n]));
  const seen = new Set<string>();
  const dfs = (k: string): boolean => { if (k === to) return true; if (seen.has(k)) return false; seen.add(k); return (by.get(k)?.depends_on ?? []).some(dfs); };
  return dfs(from);
}

/** Left-to-right layers by dependency depth. */
export function autoLayout(nodes: WNode[]): WNode[] {
  const by = new Map(nodes.map((n) => [n.key, n]));
  const depth = new Map<string, number>();
  const d = (k: string, seen: Set<string>): number => {
    if (depth.has(k)) return depth.get(k)!;
    if (seen.has(k)) return 0;
    const v = Math.max(-1, ...(by.get(k)?.depends_on ?? []).filter((x) => by.has(x)).map((x) => d(x, new Set([...seen, k])))) + 1;
    depth.set(k, v);
    return v;
  };
  nodes.forEach((n) => d(n.key, new Set()));
  const rows = new Map<number, number>();
  return nodes.map((n) => { const col = depth.get(n.key)!; const row = rows.get(col) ?? 0; rows.set(col, row + 1); return { ...n, x: 40 + col * (W + 70), y: 40 + row * (H + 36) }; });
}

