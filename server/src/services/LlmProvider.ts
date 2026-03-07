/**
 * LlmProvider — virtual model presets for Scrapex.
 *
 * Exe Pro 1  → best quality (Gemini 2.5 Pro + Groq Llama 3.3 70B)
 * Exe Light 1 → fastest (Gemini 2.0 Flash + Groq Llama 3.1 8B)
 *
 * Each preset uses different real models for different pipeline roles:
 *   - "architect": map site structure / large-context analysis
 *   - "extractor": sub-second structured JSON extraction
 *   - "coder": code generation (streaming)
 *   - "validator": final validation / fallback
 */

import { chatCompletion, streamCompletion, AVAILABLE_MODELS } from "./aiService.js";
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
    description: "Highest quality — Gemini 2.5 Pro architecture + Groq Llama 3.3 70B extraction",
  },
  {
    id: EXE_LIGHT_MODEL_ID,
    name: "Exe Light 1",
    provider: "exe",
    free: true,
    contextWindow: "1M",
    description: "Fastest — Gemini 2.0 Flash architecture + Groq Llama 3.1 8B extraction",
  },
];

interface ModelPlan {
  architect: string;  // large context, site analysis
  extractor: string;  // fast JSON extraction
  coder: string;      // code generation (streaming)
  validator: string;  // fallback validation
}

function getAvailableArchitect(preferred: string, fallback: string): string {
  const hasGemini = getKeyCount(GEMINI_PREFIX) > 0;
  const hasOpenRouter = getKeyCount(OPENROUTER_PREFIX) > 0;
  const hasGroq = getKeyCount(GROQ_PREFIX) > 0;

  // Check if preferred model's provider has keys
  const pref = AVAILABLE_MODELS.find((m) => m.id === preferred);
  if (pref) {
    if (pref.provider === "gemini" && hasGemini) return preferred;
    if (pref.provider === "openrouter" && hasOpenRouter) return preferred;
    if (pref.provider === "groq" && hasGroq) return preferred;
  }

  const fb = AVAILABLE_MODELS.find((m) => m.id === fallback);
  if (fb) {
    if (fb.provider === "gemini" && hasGemini) return fallback;
    if (fb.provider === "openrouter" && hasOpenRouter) return fallback;
    if (fb.provider === "groq" && hasGroq) return fallback;
  }

  // Pick any available
  if (hasGemini) return "gemini-2.0-flash";
  if (hasGroq) return "llama-3.3-70b-versatile";
  if (hasOpenRouter) return "google/gemini-2.0-flash-exp:free";
  throw new Error("No AI API keys configured");
}

function getModelPlan(modelId: string): ModelPlan {
  const hasGemini = getKeyCount(GEMINI_PREFIX) > 0;
  const hasGroq = getKeyCount(GROQ_PREFIX) > 0;
  const hasOpenRouter = getKeyCount(OPENROUTER_PREFIX) > 0;

  if (modelId === EXE_PRO_MODEL_ID) {
    return {
      architect: getAvailableArchitect(
        hasGemini ? "gemini-2.5-pro" : "gemini-1.5-pro",
        hasOpenRouter ? "google/gemini-2.5-pro:free" : "llama-3.3-70b-versatile"
      ),
      extractor: hasGroq ? "llama-3.3-70b-versatile" : (hasGemini ? "gemini-2.0-flash" : "meta-llama/llama-3.3-70b-instruct:free"),
      coder: hasGemini ? "gemini-2.5-pro" : (hasOpenRouter ? "google/gemini-2.5-pro:free" : "llama-3.3-70b-versatile"),
      validator: hasOpenRouter ? "openrouter/cypher-alpha:free" : (hasGroq ? "llama-3.3-70b-versatile" : "gemini-2.0-flash"),
    };
  }

  if (modelId === EXE_LIGHT_MODEL_ID) {
    return {
      architect: getAvailableArchitect(
        hasGemini ? "gemini-2.0-flash" : "gemini-2.0-flash-lite",
        hasGroq ? "llama-3.1-8b-instant" : "meta-llama/llama-3.1-8b-instruct:free"
      ),
      extractor: hasGroq ? "llama-3.1-8b-instant" : (hasGemini ? "gemini-2.0-flash-lite" : "meta-llama/llama-3.1-8b-instruct:free"),
      coder: hasGemini ? "gemini-2.0-flash" : (hasGroq ? "llama-3.3-70b-versatile" : "meta-llama/llama-3.3-70b-instruct:free"),
      validator: hasGroq ? "llama-3.1-8b-instant" : (hasGemini ? "gemini-2.0-flash-lite" : "meta-llama/llama-3.1-8b-instruct:free"),
    };
  }

  // Fall-through: use modelId directly for all roles
  return {
    architect: modelId,
    extractor: modelId,
    coder: modelId,
    validator: modelId,
  };
}

export function isExeModel(modelId: string): boolean {
  return modelId === EXE_PRO_MODEL_ID || modelId === EXE_LIGHT_MODEL_ID;
}

/** Run site architecture / analysis (large-context, slower, high quality) */
export async function runArchitect(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 4096
): Promise<string> {
  const plan = getModelPlan(modelId);
  return chatCompletion(plan.architect, messages, 0.2, maxTokens);
}

/** Run fast structured extraction (sub-second, JSON output) */
export async function runExtractor(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 2048
): Promise<string> {
  const plan = getModelPlan(modelId);
  return chatCompletion(plan.extractor, messages, 0.1, maxTokens);
}

/** Run code generation with streaming */
export async function* streamCoder(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 16384
): AsyncGenerator<string> {
  const plan = getModelPlan(modelId);
  yield* streamCompletion(plan.coder, messages, 0.2, maxTokens);
}

/** Run validation / fallback check */
export async function runValidator(
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 2048
): Promise<string> {
  const plan = getModelPlan(modelId);
  return chatCompletion(plan.validator, messages, 0.1, maxTokens);
}

/** Generic chat that routes through the appropriate role model */
export async function exeChat(
  modelId: string,
  role: "architect" | "extractor" | "coder" | "validator",
  messages: ChatMessage[],
  maxTokens = 4096
): Promise<string> {
  const plan = getModelPlan(modelId);
  const realModelId = plan[role];
  return chatCompletion(realModelId, messages, role === "extractor" ? 0.1 : 0.2, maxTokens);
}
