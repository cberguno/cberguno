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
    expect(r).toEqual({ text: "yo", toolCalls: [], tokensIn: 7, tokensOut: 3, finishReason: "stop" });
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
    expect(r).toEqual({ text: "ab", toolCalls: [], tokensIn: 9, tokensOut: 4, finishReason: "end_turn" });
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
    expect(r).toEqual({ text: "ok", toolCalls: [], tokensIn: 5, tokensOut: 2, finishReason: "STOP" });
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

describe("native tool calling (wire formats against local servers)", () => {
  const tools = [{ name: "search_flights", description: "Find flights", parameters: { type: "object", $schema: "http://json-schema.org/draft-07/schema#", additionalProperties: false, properties: { to: { type: "string" } }, required: ["to"] } }];
  const convo = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "flights to LIS?" },
    { role: "assistant" as const, content: "checking", toolCalls: [{ id: "c1", name: "search_flights", arguments: { to: "LIS" } }, { id: "c2", name: "search_flights", arguments: { to: "OPO" } }] },
    { role: "tool" as const, toolCallId: "c1", name: "search_flights", content: "TAP123" },
    { role: "tool" as const, toolCallId: "c2", name: "search_flights", content: "boom", isError: true },
  ];

  it("openai_compat: offers tools, serialises calls/results, parses tool_calls (bad JSON args do not crash)", async () => {
    const s = await mockServer(() => ({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [{ id: "x1", function: { name: "search_flights", arguments: '{"to":"LIS"}' } }, { id: "x2", function: { name: "search_flights", arguments: "{not json" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }));
    closers.push(s.close);
    const r = await adapters.openai_compat.complete({ kind: "openai_compat", baseUrl: s.url, apiKey: "k" }, { model: "m", messages: convo, tools, maxTokens: 10 });
    expect(r.toolCalls[0]).toEqual({ id: "x1", name: "search_flights", arguments: { to: "LIS" } });
    expect(r.toolCalls[1]!.arguments).toHaveProperty("__invalid_arguments");
    const b = s.seen[0]!.body;
    expect(b.tools[0]).toEqual({ type: "function", function: { name: "search_flights", description: "Find flights", parameters: tools[0]!.parameters } });
    expect(b.messages[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "search_flights", arguments: '{"to":"LIS"}' } }, { id: "c2" }] });
    expect(b.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "TAP123" });
  });

  it("anthropic: tool_use blocks in, merged tool_result blocks out", async () => {
    const s = await mockServer(() => ({ status: 200, body: { content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "tu1", name: "search_flights", input: { to: "LIS" } }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "tool_use" } }));
    closers.push(s.close);
    const r = await adapters.anthropic.complete({ kind: "anthropic", baseUrl: s.url, apiKey: "k" }, { model: "m", messages: convo, tools, maxTokens: 10 });
    expect(r.toolCalls).toEqual([{ id: "tu1", name: "search_flights", arguments: { to: "LIS" } }]);
    expect(r.text).toBe("ok");
    const b = s.seen[0]!.body;
    expect(b.tools[0]).toMatchObject({ name: "search_flights", input_schema: tools[0]!.parameters });
    expect(b.messages[1].content).toEqual([{ type: "text", text: "checking" }, { type: "tool_use", id: "c1", name: "search_flights", input: { to: "LIS" } }, { type: "tool_use", id: "c2", name: "search_flights", input: { to: "OPO" } }]);
    expect(b.messages).toHaveLength(3); // both results share ONE user message
    expect(b.messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "c1", content: "TAP123" }, { type: "tool_result", tool_use_id: "c2", content: "boom", is_error: true }]);
  });

  it("gemini: functionDeclarations with unsupported schema keys stripped, thought signatures echoed", async () => {
    const s = await mockServer(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ functionCall: { name: "search_flights", args: { to: "LIS" } }, thoughtSignature: "SIG" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } }));
    closers.push(s.close);
    const r = await adapters.gemini.complete({ kind: "gemini", baseUrl: s.url, apiKey: "k" }, { model: "m", messages: convo, tools, maxTokens: 10 });
    expect(r.toolCalls).toEqual([{ id: "call_0", name: "search_flights", arguments: { to: "LIS" }, providerData: { thoughtSignature: "SIG" } }]);
    const decl = s.seen[0]!.body.tools[0].functionDeclarations[0];
    expect(decl.parameters).toEqual({ type: "object", properties: { to: { type: "string" } }, required: ["to"] }); // no $schema / additionalProperties
    // echo the signature on a follow-up
    const s2 = await mockServer(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: "done" }] } }] } }));
    closers.push(s2.close);
    await adapters.gemini.complete({ kind: "gemini", baseUrl: s2.url, apiKey: "k" }, { model: "m", messages: [{ role: "user", content: "q" }, { role: "assistant", content: "", toolCalls: r.toolCalls }, { role: "tool", toolCallId: "call_0", name: "search_flights", content: "TAP" }], tools, maxTokens: 10 });
    const sent = s2.seen[0]!.body.contents;
    expect(sent[1]).toEqual({ role: "model", parts: [{ functionCall: { name: "search_flights", args: { to: "LIS" } }, thoughtSignature: "SIG" }] });
    expect(sent[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "search_flights", response: { content: "TAP" } } }] });
  });
});
