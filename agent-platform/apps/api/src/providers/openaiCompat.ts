import { type ChatMessage, type ModelProvider, parseArgs, postJson, ProviderError } from "./types.js";

function toWire(m: ChatMessage) {
  if (m.role === "assistant" && m.toolCalls?.length) {
    return { role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) };
  }
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  return { role: m.role, content: m.content };
}

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
        messages: req.messages.map(toWire),
        ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
      req.signal,
    );
    const choice = json?.choices?.[0];
    if (!choice) throw new ProviderError("response had no choices", null, false);
    const content = choice.message?.content;
    const toolCalls = (Array.isArray(choice.message?.tool_calls) ? choice.message.tool_calls : []).map((c: any, i: number) => ({
      id: String(c.id ?? `call_${i}`), name: String(c.function?.name ?? ""), arguments: parseArgs(c.function?.arguments),
    }));
    return {
      text: typeof content === "string" ? content : "",
      toolCalls,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      finishReason: choice.finish_reason ?? "unknown",
    };
  },
};
