import { type ChatMessage, type ModelProvider, postJson, ProviderError } from "./types.js";

/** Anthropic wants tool results as content blocks of a user turn; consecutive results of one assistant turn share one message. */
function toWire(msgs: ChatMessage[]) {
  const out: { role: string; content: unknown }[] = [];
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && (last.content as any[]).every((b) => b.type === "tool_result")) (last.content as unknown[]).push(block);
      else out.push({ role: "user", content: [block] });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({ role: "assistant", content: [...(m.content ? [{ type: "text", text: m.content }] : []), ...m.toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.arguments }))] });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** Anthropic Messages API. `baseUrl` e.g. https://api.anthropic.com */
export const anthropic: ModelProvider = {
  async complete(target, req) {
    if (!target.apiKey) throw new ProviderError("anthropic provider requires an API key", null, false);
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = toWire(req.messages);
    const json = await postJson(
      `${target.baseUrl.replace(/\/+$/, "")}/v1/messages`,
      { "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        ...(system ? { system } : {}),
        messages,
        ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
      req.signal,
    );
    const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
      toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), name: String(b.name), arguments: b.input && typeof b.input === "object" ? b.input : {} })),
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
      finishReason: json.stop_reason ?? "unknown",
    };
  },
};
