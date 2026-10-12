import dns from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as ufetch } from "undici";

export class BlockedHostError extends Error {}

/** True for loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast, ULA and similar. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]!);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return true; // not an IP we understand: refuse
}

/** Resolve a hostname and refuse if ANY address is non-public. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length) throw new BlockedHostError(`cannot resolve ${hostname}`);
  for (const a of addrs) if (isPrivateIp(a)) throw new BlockedHostError(`${hostname} resolves to a non-public address`);
}

/**
 * fetch() that validates the address at *connect time* (not just before), closing the DNS-rebinding gap between "check" and "use".
 * Redirects are not followed automatically: callers re-validate each hop.
 */
export function safeFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}, opts: { allowPrivate?: boolean } = {}) {
  if (opts.allowPrivate) return ufetch(url, { ...init, redirect: "manual" });
  const dispatcher = new Agent({
    connect: {
      lookup: (hostname, options, cb) => {
        dns.lookup(hostname, { all: true }).then(
          (addrs) => {
            const bad = addrs.find((a) => isPrivateIp(a.address));
            if (bad || !addrs.length) return cb(new BlockedHostError(`${hostname} resolves to a non-public address`) as any, "" as any, 0 as any);
            if ((options as any)?.all) return (cb as any)(null, addrs);
            cb(null, addrs[0]!.address, addrs[0]!.family);
          },
          (e) => cb(e, "" as any, 0 as any),
        );
      },
    },
  });
  return ufetch(url, { ...init, redirect: "manual", dispatcher });
}
