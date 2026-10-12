import { describe, expect, it } from "vitest";
import { open, seal, hashPassword, verifyPassword } from "../src/crypto.js";
import { redact } from "../src/audit.js";
import { type Candidate, rank, costUsd } from "../src/router.js";
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");

describe("crypto vault", () => {
  it("roundtrips and never stores plaintext", () => {
    const s = seal("sk-secret-1234", key);
    expect(s).not.toContain("sk-secret");
    expect(open(s, key)).toBe("sk-secret-1234");
  });
  it("uses a fresh nonce each time", () => {
    expect(seal("x", key)).not.toBe(seal("x", key));
  });
  it("detects tampering", () => {
    const buf = Buffer.from(seal("hello", key), "base64");
    buf[14] = buf[14]! ^ 0xff;
    expect(() => open(buf.toString("base64"), key)).toThrow();
  });
  it("rejects the wrong key", () => {
    expect(() => open(seal("hello", key), randomBytes(32).toString("base64"))).toThrow();
  });
  it("hashes passwords with verification", async () => {
    const h = await hashPassword("pw-123456789012");
    expect(await verifyPassword("pw-123456789012", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("audit redaction", () => {
  it("redacts secret-bearing keys at any depth", () => {
    expect(redact({ name: "p", api_key: "sk-1", nested: [{ password: "x", ok: 1 }] })).toEqual({
      name: "p",
      api_key: "[redacted]",
      nested: [{ password: "[redacted]", ok: 1 }],
    });
  });
});

const c = (o: Partial<Candidate> & { modelName: string }): Candidate => ({
  modelId: o.modelName, providerId: "p", providerName: "p", tier: "standard", contextWindow: 8000,
  supportsTools: false, supportsVision: false, usdPerMtokIn: 1, usdPerMtokOut: 1, avgLatencyMs: null, ...o,
});

describe("router.rank", () => {
  const pool = [
    c({ modelName: "tiny", tier: "fast", usdPerMtokIn: 0.1, usdPerMtokOut: 0.2, avgLatencyMs: 300 }),
    c({ modelName: "mid-cheap", tier: "standard", usdPerMtokIn: 1, usdPerMtokOut: 2, avgLatencyMs: 900 }),
    c({ modelName: "mid-fast", tier: "standard", usdPerMtokIn: 2, usdPerMtokOut: 4, avgLatencyMs: 400 }),
    c({ modelName: "big", tier: "frontier", usdPerMtokIn: 10, usdPerMtokOut: 30, contextWindow: 200000, supportsTools: true }),
  ];
  const names = (r: Candidate[]) => r.map((x) => x.modelName);

  it("prefers the tier matching complexity and falls back down the sequence", () => {
    expect(names(rank(pool, { strategy: "cheapest", complexity: "low" }))).toEqual(["tiny", "mid-cheap", "mid-fast", "big"]);
    expect(names(rank(pool, { strategy: "cheapest", complexity: "high" }))).toEqual(["big", "mid-cheap", "mid-fast", "tiny"]);
    expect(names(rank(pool, { strategy: "cheapest", complexity: "medium" }))).toEqual(["mid-cheap", "mid-fast", "tiny", "big"]);
  });
  it("orders within a tier by strategy", () => {
    expect(names(rank(pool, { strategy: "fastest", complexity: "medium" })).slice(0, 2)).toEqual(["mid-fast", "mid-cheap"]);
  });
  it("applies hard constraints", () => {
    expect(names(rank(pool, { strategy: "cheapest", complexity: "low", needsTools: true }))).toEqual(["big"]);
    expect(names(rank(pool, { strategy: "cheapest", complexity: "low", minContext: 100000 }))).toEqual(["big"]);
    expect(names(rank(pool, { strategy: "cheapest", complexity: "low", maxLatencyMs: 500 }))).toEqual(["tiny", "mid-fast", "big"]);
  });
  it("returns empty when nothing qualifies", () => {
    expect(rank(pool, { strategy: "cheapest", complexity: "low", needsVision: true })).toEqual([]);
  });
  it("computes cost per million tokens", () => {
    expect(costUsd({ usdPerMtokIn: 3, usdPerMtokOut: 15 }, 1000, 500)).toBeCloseTo(0.0105, 6);
  });
});
