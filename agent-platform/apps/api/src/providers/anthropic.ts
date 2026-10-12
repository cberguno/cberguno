import { type ModelProvider, postJson, ProviderError } from "./types.js";

/** Anthropic Messages API. `baseUrl` e.g. https://api.anthropic.com */
export const anthropic: ModelProvider = {
  async complete(target, req) {
    if (!target.apiKey) throw new ProviderError("anthropic provider requires an API key", null, false);
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const json = await postJson(
      `${target.baseUrl.replace(/\/+$/, "")}/v1/messages`,
      { "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        ...(system ? { system } : {}),
        messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
      req.signal,
    );
    const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
      finishReason: json.stop_reason ?? "unknown",
    };
  },
};
