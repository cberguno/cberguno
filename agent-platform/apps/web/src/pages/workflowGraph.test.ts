import { describe, expect, it } from "vitest";
import { autoLayout, wouldCycle, type WNode } from "./workflowGraph";

const n = (key: string, depends_on: string[] = []): WNode => ({ key, title: key, assignee: "A", input: "", depends_on, x: 0, y: 0 });

describe("wouldCycle (is `to` depending on `from` a loop?)", () => {
  const g = [n("a"), n("b", ["a"]), n("c", ["b"])]; // a -> b -> c
  it("rejects connections that close a loop, direct or transitive", () => {
    expect(wouldCycle(g, "c", "a")).toBe(true); // a would depend on c, but c already depends on a (via b)
    expect(wouldCycle(g, "b", "a")).toBe(true);
    expect(wouldCycle(g, "a", "a")).toBe(true); // self
  });
  it("allows legitimate new dependencies", () => {
    expect(wouldCycle(g, "a", "c")).toBe(false); // c also needs a: fine
    expect(wouldCycle([n("x"), n("y")], "x", "y")).toBe(false);
  });
  it("terminates on already-cyclic input", () => {
    expect(() => wouldCycle([n("a", ["b"]), n("b", ["a"])], "a", "z")).not.toThrow();
  });
});

describe("autoLayout", () => {
  it("places tasks left-to-right by dependency depth and stacks siblings", () => {
    const out = autoLayout([n("a"), n("b"), n("c", ["a", "b"]), n("d", ["c"])]);
    const at = Object.fromEntries(out.map((o) => [o.key, o]));
    expect(at.a!.x).toBe(at.b!.x);
    expect(at.a!.y).not.toBe(at.b!.y);
    expect(at.c!.x).toBeGreaterThan(at.a!.x);
    expect(at.d!.x).toBeGreaterThan(at.c!.x);
  });
  it("does not lose or mutate nodes, and survives a cycle", () => {
    const input = [n("a", ["b"]), n("b", ["a"])];
    const out = autoLayout(input);
    expect(out.map((o) => o.key)).toEqual(["a", "b"]);
    expect(input[0]!.x).toBe(0);
  });
});
