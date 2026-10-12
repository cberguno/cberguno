export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CompleteRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type CompleteResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: string;
};

export type ProviderTarget = { kind: ProviderKind; baseUrl: string; apiKey: string | null };
export type ProviderKind = "openai_compat" | "anthropic" | "gemini";

/** Errors the router may retry on another candidate. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface ModelProvider {
  complete(target: ProviderTarget, req: CompleteRequest): Promise<CompleteResult>;
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ProviderError(`network error: ${(e as Error).message}`, null, true);
  }
  const text = await res.text();
  if (!res.ok) {
    // Truncate: provider error bodies can be large and must never echo our key (we never put it in the body).
    throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, isRetryableStatus(res.status));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("provider returned non-JSON body", res.status, false);
  }
}
