import { type ModelProvider, postJson, ProviderError } from "./types.js";

/**
 * Chat Completions wire format. Serves OpenAI, xAI, DeepSeek, Qwen (DashScope compatible-mode),
 * OpenRouter, Hugging Face endpoints, and local Ollama/vLLM/llama.cpp servers.
 * `baseUrl` is the API root, e.g. https://api.openai.com/v1
 */
export const openaiCompat: ModelProvider = {
  async complete(target, req) {
    const headers: Record<string, string> = {};
    if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
    const json = await postJson(
      `${target.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      headers,
      {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
      req.signal,
    );
    const choice = json?.choices?.[0];
    if (!choice) throw new ProviderError("response had no choices", null, false);
    const content = choice.message?.content;
    return {
      text: typeof content === "string" ? content : "",
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      finishReason: choice.finish_reason ?? "unknown",
    };
  },
};
