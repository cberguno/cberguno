import { type ModelProvider, postJson, ProviderError } from "./types.js";

/** Google Generative Language API. `baseUrl` e.g. https://generativelanguage.googleapis.com/v1beta */
export const gemini: ModelProvider = {
  async complete(target, req) {
    if (!target.apiKey) throw new ProviderError("gemini provider requires an API key", null, false);
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const json = await postJson(
      `${target.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(req.model)}:generateContent`,
      { "x-goog-api-key": target.apiKey }, // header, not query string: keeps the key out of URLs and logs
      {
        contents,
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
      tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
      finishReason: cand.finishReason ?? "unknown",
    };
  },
};
