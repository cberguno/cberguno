import { anthropic } from "./anthropic.js";
import { gemini } from "./gemini.js";
import { openaiCompat } from "./openaiCompat.js";
import type { ModelProvider, ProviderKind } from "./types.js";

export * from "./types.js";

export const adapters: Record<ProviderKind, ModelProvider> = {
  openai_compat: openaiCompat,
  anthropic,
  gemini,
};

/** Convenience presets for the "add provider" form. Base URLs only: models and prices are yours to enter. */
export const PROVIDER_PRESETS = [
  { name: "openai", kind: "openai_compat", baseUrl: "https://api.openai.com/v1" },
  { name: "anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com" },
  { name: "gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { name: "xai", kind: "openai_compat", baseUrl: "https://api.x.ai/v1" },
  { name: "deepseek", kind: "openai_compat", baseUrl: "https://api.deepseek.com/v1" },
  { name: "qwen", kind: "openai_compat", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  { name: "openrouter", kind: "openai_compat", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "huggingface", kind: "openai_compat", baseUrl: "https://router.huggingface.co/v1" },
  { name: "ollama-local", kind: "openai_compat", baseUrl: "http://localhost:11434/v1" },
] as const;
