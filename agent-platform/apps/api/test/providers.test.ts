import { afterEach, describe, expect, it } from "vitest";
import { adapters, ProviderError } from "../src/providers/index.js";
import { mockServer } from "./helpers.js";

let closers: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(closers.map((c) => c())); closers = []; });

const msgs = [{ role: "system" as const, content: "be brief" }, { role: "user" as const, content: "hi" }];

describe("provider wire formats (against a local HTTP server, not the live vendors)", () => {
  it("openai_compat: path, bearer auth, body, parsing", async () => {
    const s = await mockServer(() => ({ status: 200, body: { choices: [{ message: { content: "yo" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } } }));
    closers.push(s.close);
    const r = await adapters.openai_compat.complete({ kind: "openai_compat", baseUrl: s.url + "/v1/", apiKey: "sk-test" }, { model: "m1", messages: msgs, maxTokens: 10 });
    expect(r).toEqual({ text: "yo", tokensIn: 7, tokensOut: 3, finishReason: "stop" });
    expect(s.seen[0]!.url).toBe("/v1/chat/completions");
    expect(s.seen[0]!.headers.authorization).toBe("Bearer sk-test");
    expect(s.seen[0]!.body).toMatchObject({ model: "m1", max_tokens: 10, messages: msgs });
  });
  it("openai_compat: no auth header for keyless local servers", async () => {
    const s = await mockServer(() => ({ status: 200, body: { choices: [{ message: { content: "" }, finish_reason: "stop" }] } }));
    closers.push(s.close);
    await adapters.openai_compat.complete({ kind: "openai_compat", baseUrl: s.url, apiKey: null }, { model: "m", messages: msgs, maxTokens: 1 });
    expect(s.seen[0]!.headers.authorization).toBeUndefined();
  });
  it("anthropic: x-api-key, version header, system split out, text blocks joined", async () => {
    const s = await mockServer(() => ({ status: 200, body: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], usage: { input_tokens: 9, output_tokens: 4 }, stop_reason: "end_turn" } }));
    closers.push(s.close);
    const r = await adapters.anthropic.complete({ kind: "anthropic", baseUrl: s.url, apiKey: "ak" }, { model: "claude-x", messages: msgs, maxTokens: 20 });
    expect(r).toEqual({ text: "ab", tokensIn: 9, tokensOut: 4, finishReason: "end_turn" });
    const q = s.seen[0]!;
    expect(q.url).toBe("/v1/messages");
    expect(q.headers["x-api-key"]).toBe("ak");
    expect(q.headers["anthropic-version"]).toBe("2023-06-01");
    expect(q.body.system).toBe("be brief");
    expect(q.body.messages).toEqual([{ role: "user", content: "hi" }]);
  });
  it("gemini: key in header (not URL), systemInstruction, role mapping", async () => {
    const s = await mockServer(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } } }));
    closers.push(s.close);
    const r = await adapters.gemini.complete({ kind: "gemini", baseUrl: s.url + "/v1beta", apiKey: "gk" }, { model: "gem-x", messages: [...msgs, { role: "assistant", content: "prev" }], maxTokens: 8 });
    expect(r).toEqual({ text: "ok", tokensIn: 5, tokensOut: 2, finishReason: "STOP" });
    const q = s.seen[0]!;
    expect(q.url).toBe("/v1beta/models/gem-x:generateContent");
    expect(q.url).not.toContain("gk");
    expect(q.headers["x-goog-api-key"]).toBe("gk");
    expect(q.body.systemInstruction.parts[0].text).toBe("be brief");
    expect(q.body.contents.map((c: any) => c.role)).toEqual(["user", "model"]);
  });
  it("classifies HTTP errors as retryable or not", async () => {
    for (const [status, retryable] of [[429, true], [503, true], [401, false], [400, false]] as const) {
      const s = await mockServer(() => ({ status, body: { error: "x" } }));
      closers.push(s.close);
      const err = await adapters.openai_compat.complete({ kind: "openai_compat", baseUrl: s.url, apiKey: "k" }, { model: "m", messages: msgs, maxTokens: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.retryable).toBe(retryable);
    }
  });
  it("anthropic/gemini refuse to call without a key", async () => {
    await expect(adapters.anthropic.complete({ kind: "anthropic", baseUrl: "http://x", apiKey: null }, { model: "m", messages: msgs, maxTokens: 1 })).rejects.toThrow(/API key/);
    await expect(adapters.gemini.complete({ kind: "gemini", baseUrl: "http://x", apiKey: null }, { model: "m", messages: msgs, maxTokens: 1 })).rejects.toThrow(/API key/);
  });
});
