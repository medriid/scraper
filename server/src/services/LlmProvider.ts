/**
 * LlmProvider — virtual model presets for Scrapex.
 *
 * Exe Pro 1  → best quality (Groq Llama 3.3 70B for analysis + Gemini 2.5 Pro for code)
 * Exe Light 1 → fastest (Groq Llama 3.1 8B for analysis + Gemini 2.0 Flash for code)
 *
 * Routing strategy (per user request):
 *   - "architect" (site analysis)  → Groq first → Gemini → OpenRouter
 *   - "extractor" (JSON extraction) → Groq first → OpenRouter → Gemini
 *   - "coder"     (code generation) → Gemini first → OpenRouter → Groq
 *   - "validator" (validation)      → Groq first → OpenRouter → Gemini
 *
 * Each role falls back to an alternative provider when the primary hits quota.
 */

import { chatCompletion, streamCompletion, ProviderExhaustedError, AVAILABLE_MODELS } from "./aiService.js";
import type { ChatMessage } from "./aiService.js";
import { getKeyCount, GEMINI_PREFIX, GROQ_PREFIX, OPENROUTER_PREFIX } from "./keyRotation.js";

export const EXE_PRO_MODEL_ID = "exe-pro-1";
export const EXE_LIGHT_MODEL_ID = "exe-light-1";

export interface ExeModelOption {
  id: string;
  name: string;
  provider: "exe";
  free: true;
  contextWindow: string;
  description: string;
  available?: boolean;
}

export const EXE_MODELS: ExeModelOption[] = [
  {
    id: EXE_PRO_MODEL_ID,
    name: "Exe Pro 1",
    provider: "exe",
    free: true,
    contextWindow: "2M",
    description: "Best quality — Groq Llama 3.3 70B analysis + Gemini 2.5 Pro code generation",
  },
  {
    id: EXE_LIGHT_MODEL_ID,
    name: "Exe Light 1",
    provider: "exe",
    free: true,
    contextWindow: "1M",
    description: "Fastest — Groq Llama 3.1 8B analysis + Gemini 2.0 Flash code generation",
  },
];

/**
 * Ordered fallback chain per role.
 * Each entry is tried in sequence; if a provider is exhausted the next is used.
 */
interface ModelPlan {
  /** Ordered list of model IDs to try (first = primary, rest = fallbacks). */
  architect: string[];
  extractor: string[];
  coder: string[];
  validator: string[];
}

function pickAvailable(modelId: string): boolean {
  const hasGemini = getKeyCount(GEMINI_PREFIX) > 0;
  const hasGroq = getKeyCount(GROQ_PREFIX) > 0;
  const hasOpenRouter = getKeyCount(OPENROUTER_PREFIX) > 0;
  const m = AVAILABLE_MODELS.find((x) => x.id === modelId);
  if (!m) return false;
  if (m.provider === "gemini") return hasGemini;
  if (m.provider === "groq") return hasGroq;
  if (m.provider === "openrouter") return hasOpenRouter;
  return false;
}

function getModelPlan(modelId: string): ModelPlan {
  const hasGemini = getKeyCount(GEMINI_PREFIX) > 0;
  const hasGroq = getKeyCount(GROQ_PREFIX) > 0;
  const hasOpenRouter = getKeyCount(OPENROUTER_PREFIX) > 0;

  if (!hasGemini && !hasGroq && !hasOpenRouter) {
    throw new Error("No AI API keys configured");
  }

  if (modelId === EXE_PRO_MODEL_ID) {
    return {
      // General scraping analysis → Groq first, then Gemini, then OpenRouter
      architect: [
        hasGroq    ? "llama-3.3-70b-versatile"            : "",
        hasGemini  ? "gemini-2.5-pro"                     : "",
        hasOpenRouter ? "google/gemini-2.5-pro:free"      : "",
        hasOpenRouter ? "meta-llama/llama-3.3-70b-instruct:free" : "",
      ].filter(Boolean),

      // Fast extraction → Groq first, then OpenRouter, then Gemini
      extractor: [
        hasGroq    ? "llama-3.3-70b-versatile"                   : "",
        hasOpenRouter ? "meta-llama/llama-3.3-70b-instruct:free" : "",
        hasGemini  ? "gemini-2.0-flash"                          : "",
      ].filter(Boolean),

      // Code generation → Gemini first, then OpenRouter, then Groq
      coder: [
        hasGemini  ? "gemini-2.5-pro"                            : "",
        hasOpenRouter ? "google/gemini-2.5-pro:free"             : "",
        hasGroq    ? "llama-3.3-70b-versatile"                   : "",
        hasOpenRouter ? "meta-llama/llama-3.3-70b-instruct:free" : "",
      ].filter(Boolean),

      // Validation → Groq first, then OpenRouter, then Gemini
      validator: [
        hasGroq    ? "llama-3.3-70b-versatile"                   : "",
        hasOpenRouter ? "openrouter/cypher-alpha:free"           : "",
        hasGemini  ? "gemini-2.0-flash"                          : "",
      ].filter(Boolean),
    };
  }

  if (modelId === EXE_LIGHT_MODEL_ID) {
    return {
      // General scraping analysis → Groq first, then Gemini, then OpenRouter
      architect: [
        hasGroq    ? "llama-3.1-8b-instant"                      : "",
        hasGemini  ? "gemini-2.0-flash"                          : "",
        hasOpenRouter ? "meta-llama/llama-3.1-8b-instruct:free"  : "",
      ].filter(Boolean),

      // Fast extraction → Groq first, then OpenRouter, then Gemini
      extractor: [
        hasGroq    ? "llama-3.1-8b-instant"                      : "",
        hasOpenRouter ? "meta-llama/llama-3.1-8b-instruct:free"  : "",
        hasGemini  ? "gemini-2.0-flash-lite"                     : "",
      ].filter(Boolean),

      // Code generation → Gemini first, then Groq, then OpenRouter
      coder: [
        hasGemini  ? "gemini-2.0-flash"                          : "",
        hasGroq    ? "llama-3.3-70b-versatile"                   : "",
        hasOpenRouter ? "meta-llama/llama-3.3-70b-instruct:free" : "",
      ].filter(Boolean),

      // Validation → Groq first, then OpenRouter, then Gemini
      validator: [
        hasGroq    ? "llama-3.1-8b-instant"                      : "",
        hasOpenRouter ? "meta-llama/llama-3.1-8b-instruct:free"  : "",
        hasGemini  ? "gemini-2.0-flash-lite"                     : "",
      ].filter(Boolean),
    };
  }

  // Fall-through: use modelId directly for all roles (single model, no cascading)
  return {
    architect: [modelId],
    extractor: [modelId],
    coder: [modelId],
    validator: [modelId],
  };
}

// ─── Cascade helpers ──────────────────────────────────────────────────────────

/**
 * Try each model in the ordered list.  Falls through to the next when a
 * ProviderExhaustedError is raised (all keys for that provider are at quota).
 */
async function cascadeChat(
  chain: string[],
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): Promise<string> {
  if (chain.length === 0) throw new Error("No models available for this role");
  let lastErr: unknown;
  for (const modelId of chain) {
    try {
      return await chatCompletion(modelId, messages, temperature, maxTokens);
    } catch (err) {
      if (err instanceof ProviderExhaustedError) {
        console.warn(`[LlmProvider] ${err.message} — trying next model in chain…`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("All models in chain failed");
}

async function* cascadeStream(
  chain: string[],
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): AsyncGenerator<string> {
  if (chain.length === 0) throw new Error("No models available for code generation");
  let lastErr: unknown;
  for (const modelId of chain) {
    try {
      yield* streamCompletion(modelId, messages, temperature, maxTokens);
      return;
    } catch (err) {
      if (err instanceof ProviderExhaustedError) {
        console.warn(`[LlmProvider] ${err.message} — trying next coder in chain…`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("All coder models in chain failed");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isExeModel(modelId: string): boolean {
  return modelId === EXE_PRO_MODEL_ID || modelId === EXE_LIGHT_MODEL_ID;
}

/** Run site architecture / analysis (Groq-first, Gemini fallback) */
export async function runArchitect(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 4096
): Promise<string> {
  const plan = getModelPlan(modelId);
  return cascadeChat(plan.architect, messages, 0.2, maxTokens);
}

/** Run fast structured extraction (Groq-first, OpenRouter fallback) */
export async function runExtractor(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 2048
): Promise<string> {
  const plan = getModelPlan(modelId);
  return cascadeChat(plan.extractor, messages, 0.1, maxTokens);
}

/** Run code generation with streaming (Gemini-first, fallback to Groq/OpenRouter) */
export async function* streamCoder(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 16384
): AsyncGenerator<string> {
  const plan = getModelPlan(modelId);
  yield* cascadeStream(plan.coder, messages, 0.2, maxTokens);
}

/** Run validation / fallback check (Groq-first) */
export async function runValidator(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 2048
): Promise<string> {
  const plan = getModelPlan(modelId);
  return cascadeChat(plan.validator, messages, 0.1, maxTokens);
}

/** Generic chat that routes through the appropriate role model */
export async function exeChat(
  modelId: string,
  role: "architect" | "extractor" | "coder" | "validator",
  messages: ChatMessage[],
  maxTokens = 4096
): Promise<string> {
  const plan = getModelPlan(modelId);
  return cascadeChat(plan[role], messages, role === "extractor" ? 0.1 : 0.2, maxTokens);
}

// Keep pickAvailable exported for tests / diagnostics
export { pickAvailable };

