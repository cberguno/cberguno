import { type ChatMessage, type ModelProvider, parseArgs, postJson, ProviderError } from "./types.js";

/** Gemini accepts an OpenAPI-subset schema: strip the JSON-Schema keywords it rejects. */
export function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (s && typeof s === "object") {
    return Object.fromEntries(Object.entries(s as Record<string, unknown>).filter(([k]) => !["$schema", "$id", "additionalProperties", "$defs", "definitions"].includes(k)).map(([k, v]) => [k, geminiSchema(v)]));
  }
  return s;
}

function toWire(msgs: ChatMessage[]) {
  const out: { role: string; parts: any[] }[] = [];
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const part = { functionResponse: { name: m.name, response: m.isError ? { error: m.content } : { content: m.content } } };
      const last = out[out.length - 1];
      if (last && last.role === "user" && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else out.push({ role: "user", parts: [part] });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({ role: "model", parts: [...(m.content ? [{ text: m.content }] : []), ...m.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.arguments }, ...(c.providerData ? (c.providerData as object) : {}) }))] });
    } else out.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
  }
  return out;
}

/** Google Generative Language API. `baseUrl` e.g. https://generativelanguage.googleapis.com/v1beta */
export const gemini: ModelProvider = {
  async complete(target, req) {
    if (!target.apiKey) throw new ProviderError("gemini provider requires an API key", null, false);
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = toWire(req.messages);
    const json = await postJson(
      `${target.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(req.model)}:generateContent`,
      { "x-goog-api-key": target.apiKey }, // header, not query string: keeps the key out of URLs and logs
      {
        contents,
        ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }] } : {}),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      },
      req.signal,
    );
    const cand = json?.candidates?.[0];
    if (!cand) throw new ProviderError(`no candidates (${json?.promptFeedback?.blockReason ?? "unknown"})`, null, false);
    const parts: any[] = cand.content?.parts ?? [];
    return {
      text: parts.map((p) => p.text ?? "").join(""),
      // thought signatures must be echoed back on the next turn or Gemini rejects multi-step tool use
      toolCalls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: `call_${i}`, name: String(p.functionCall.name), arguments: parseArgs(p.functionCall.args), ...(p.thoughtSignature ? { providerData: { thoughtSignature: p.thoughtSignature } } : {}) })),
      tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
      finishReason: cand.finishReason ?? "unknown",
    };
  },
};
