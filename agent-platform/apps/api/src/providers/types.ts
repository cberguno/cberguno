/** JSON-schema description of a callable tool, as offered to the model. */
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
/** `providerData` carries vendor-specific state that must be echoed back verbatim (e.g. Gemini thought signatures). */
export type ToolCall = { id: string; name: string; arguments: Record<string, unknown>; providerData?: unknown };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export type CompleteRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type CompleteResult = {
  text: string;
  toolCalls: ToolCall[];
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

/** Providers return tool arguments as JSON text; a malformed string must reach the gateway as a validation error, not crash the run. */
export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : { __invalid_arguments: raw.slice(0, 500) };
  } catch {
    return { __invalid_arguments: raw.slice(0, 500) };
  }
}
