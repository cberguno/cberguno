import { postJson, ProviderError, type ProviderKind, type ProviderTarget } from "./types.js";

export type EmbedResult = { vectors: number[][]; tokens: number };

/** OpenAI-style /embeddings (OpenAI, Ollama, vLLM, OpenRouter, Qwen/DashScope compat, ...) and Gemini batchEmbedContents. */
export async function embedWith(target: ProviderTarget, model: string, texts: string[], signal?: AbortSignal): Promise<EmbedResult> {
  const kind: ProviderKind = target.kind;
  const base = target.baseUrl.replace(/\/+$/, "");
  if (kind === "openai_compat") {
    const headers: Record<string, string> = target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {};
    const json = await postJson(`${base}/embeddings`, headers, { model, input: texts }, signal);
    const data: any[] = Array.isArray(json?.data) ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
    if (data.length !== texts.length || data.some((d) => !Array.isArray(d.embedding))) throw new ProviderError("malformed embeddings response", null, false);
    return { vectors: data.map((d) => d.embedding as number[]), tokens: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0 };
  }
  if (kind === "gemini") {
    if (!target.apiKey) throw new ProviderError("gemini provider requires an API key", null, false);
    const json = await postJson(
      `${base}/models/${encodeURIComponent(model)}:batchEmbedContents`,
      { "x-goog-api-key": target.apiKey },
      { requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) },
      signal,
    );
    const embs: any[] = json?.embeddings ?? [];
    if (embs.length !== texts.length || embs.some((e) => !Array.isArray(e.values))) throw new ProviderError("malformed embeddings response", null, false);
    return { vectors: embs.map((e) => e.values as number[]), tokens: 0 };
  }
  throw new ProviderError(`${kind} provider has no embeddings API; use an OpenAI-compatible or Gemini provider`, null, false);
}
