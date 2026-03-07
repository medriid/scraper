import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import OpenAI from "openai";
import { getAllKeys, GEMINI_PREFIX, OPENROUTER_PREFIX, GROQ_PREFIX } from "./keyRotation.js";

// ─── Quota / rate-limit helpers ───────────────────────────────────────────────

/**
 * Thrown when every API key for a provider has hit its quota.
 * Callers (LlmProvider) catch this to switch to a different provider.
 */
export class ProviderExhaustedError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`All ${provider} API keys are quota-exhausted`);
    this.name = "ProviderExhaustedError";
    this.provider = provider;
  }
}

/** Detect 429 / quota-exceeded responses from any provider. */
function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("too many requests") ||
    msg.includes("resource_exhausted") ||
    msg.includes("exceeded your current quota")
  );
}


export interface ModelOption {
  id: string;
  name: string;
  provider: "gemini" | "openrouter" | "groq";
  free: boolean;
  contextWindow: string;
  description: string;
}

/**
 * Direct Gemini models (accessed via @google/generative-ai SDK, GEMINI_API_KEY*).
 * Gemini API has a generous free tier via Google AI Studio.
 */
const GEMINI_MODELS: ModelOption[] = [
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Most capable Gemini — advanced reasoning & code",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Next-gen Flash — speed + strong reasoning",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Google's fast model — balanced speed & quality",
  },
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Ultra-fast lightweight Gemini 2.0 variant",
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "gemini",
    free: true,
    contextWindow: "2M",
    description: "Long-context powerhouse with 2M token window",
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Versatile and fast, 1M context, free tier",
  },
  {
    id: "gemini-1.5-flash-8b",
    name: "Gemini 1.5 Flash 8B",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Smallest Gemini — highest throughput & lowest latency",
  },
];

/**
 * OpenRouter models with :free tag — no credits required.
 * Also includes a few low-cost "rare-limit" premium models.
 *
 * Source: openrouter.ai/models (filtered :free, updated 2025-03)
 */
const OPENROUTER_MODELS: ModelOption[] = [
  // ── Google ────────────────────────────────────────────────────────────────
  {
    id: "google/gemini-2.5-pro:free",
    name: "Gemini 2.5 Pro (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "1M",
    description: "Gemini 2.5 Pro via OpenRouter — top-tier reasoning",
  },
  {
    id: "google/gemini-2.5-flash:free",
    name: "Gemini 2.5 Flash (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "1M",
    description: "Gemini 2.5 Flash via OpenRouter — fast & capable",
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash Exp (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "1M",
    description: "Gemini 2.0 Flash via OpenRouter — no Gemini key needed",
  },
  {
    id: "google/gemma-3-27b-it:free",
    name: "Gemma 3 27B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Google Gemma 3 27B Instruct — strong open model",
  },
  {
    id: "google/gemma-3-12b-it:free",
    name: "Gemma 3 12B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Google Gemma 3 12B — efficient mid-size",
  },
  {
    id: "google/gemma-3-4b-it:free",
    name: "Gemma 3 4B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Google Gemma 3 4B — compact & fast",
  },
  {
    id: "google/gemma-2-9b-it:free",
    name: "Gemma 2 9B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "8K",
    description: "Google Gemma 2 9B Instruct",
  },
  // ── Meta Llama ────────────────────────────────────────────────────────────
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Meta Llama 3.3 70B — excellent instruction following",
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct:free",
    name: "Llama 3.1 8B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Meta Llama 3.1 8B — lightweight and fast",
  },
  {
    id: "meta-llama/llama-3.2-3b-instruct:free",
    name: "Llama 3.2 3B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Meta Llama 3.2 3B — ultra-fast on-device size",
  },
  // ── DeepSeek ─────────────────────────────────────────────────────────────
  {
    id: "deepseek/deepseek-chat:free",
    name: "DeepSeek V3 (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "64K",
    description: "DeepSeek Chat V3 — strong code & reasoning, free",
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek R1 (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "64K",
    description: "DeepSeek R1 — chain-of-thought reasoning powerhouse",
  },
  {
    id: "deepseek/deepseek-r1-distill-llama-70b:free",
    name: "DeepSeek R1 Distill 70B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "DeepSeek R1 distilled into Llama 70B",
  },
  {
    id: "deepseek/deepseek-r1-distill-qwen-32b:free",
    name: "DeepSeek R1 Distill Qwen 32B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "DeepSeek R1 distilled into Qwen 32B",
  },
  // ── Qwen ─────────────────────────────────────────────────────────────────
  {
    id: "qwen/qwen-2.5-72b-instruct:free",
    name: "Qwen 2.5 72B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Alibaba Qwen 2.5 72B — multilingual & strong code",
  },
  {
    id: "qwen/qwq-32b:free",
    name: "QwQ 32B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Qwen QwQ 32B — deep reasoning / o1-style thinking",
  },
  {
    id: "qwen/qwen-2.5-7b-instruct:free",
    name: "Qwen 2.5 7B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Qwen 2.5 7B — compact multilingual model",
  },
  // ── Mistral ───────────────────────────────────────────────────────────────
  {
    id: "mistralai/mistral-7b-instruct:free",
    name: "Mistral 7B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "32K",
    description: "Mistral 7B Instruct — reliable and fast",
  },
  // ── Microsoft ────────────────────────────────────────────────────────────
  {
    id: "microsoft/phi-3-mini-128k-instruct:free",
    name: "Phi-3 Mini 128K (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Microsoft Phi-3 Mini — very long context, small model",
  },
  // ── NousResearch ──────────────────────────────────────────────────────────
  {
    id: "nousresearch/hermes-3-llama-3.1-405b:free",
    name: "Hermes 3 405B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "128K",
    description: "Hermes 3 on Llama 405B — premium-quality, free tier",
  },
  // ── OpenRouter native ────────────────────────────────────────────────────
  {
    id: "openrouter/cypher-alpha:free",
    name: "Cypher Alpha (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "1M",
    description: "OpenRouter's own model — 1M context, free tier",
  },
  // ── Community / Other ─────────────────────────────────────────────────────
  {
    id: "openchat/openchat-7b:free",
    name: "OpenChat 7B (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "8K",
    description: "OpenChat 7B — strong instruction following",
  },
  {
    id: "huggingfaceh4/zephyr-7b-beta:free",
    name: "Zephyr 7B Beta (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "4K",
    description: "HuggingFace Zephyr 7B Beta — assistant-tuned",
  },
  // ── Premium / rare-rate-limit ────────────────────────────────────────────
  // These are not :free but have generous or free daily rate limits
  {
    id: "anthropic/claude-3-haiku",
    name: "Claude 3 Haiku (OR)",
    provider: "openrouter",
    free: false,
    contextWindow: "200K",
    description: "Anthropic Claude 3 Haiku — fast, affordable via OR",
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini (OR)",
    provider: "openrouter",
    free: false,
    contextWindow: "128K",
    description: "OpenAI GPT-4o Mini via OpenRouter",
  },
];

/**
 * Groq models — ultra-fast inference via Groq's LPU hardware.
 * OpenAI-compatible API at https://api.groq.com/openai/v1
 * All models on a generous free tier (14,400 req/day, 6k tokens/min).
 * Get free API keys at https://console.groq.com
 */
const GROQ_MODELS: ModelOption[] = [
  {
    id: "meta-llama/llama-4-maverick-17b-128e-instruct",
    name: "Llama 4 Maverick 17B",
    provider: "groq",
    free: true,
    contextWindow: "512K",
    description: "Meta Llama 4 Maverick — best Groq model, strong reasoning",
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B",
    provider: "groq",
    free: true,
    contextWindow: "512K",
    description: "Meta Llama 4 Scout — 512K context, fast & capable",
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    provider: "groq",
    free: true,
    contextWindow: "128K",
    description: "Meta Llama 3.3 70B — ultra-fast, excellent instruction following",
  },
  {
    id: "deepseek-r1-distill-llama-70b",
    name: "DeepSeek R1 Distill 70B",
    provider: "groq",
    free: true,
    contextWindow: "128K",
    description: "DeepSeek R1 reasoning distilled into Llama 70B, on Groq",
  },
  {
    id: "qwen-qwq-32b",
    name: "Qwen QwQ 32B",
    provider: "groq",
    free: true,
    contextWindow: "128K",
    description: "Qwen QwQ 32B — deep o1-style reasoning on Groq",
  },
  {
    id: "llama-3.3-70b-specdec",
    name: "Llama 3.3 70B SpecDec",
    provider: "groq",
    free: true,
    contextWindow: "8K",
    description: "Llama 3.3 70B with speculative decoding — extra fast",
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    provider: "groq",
    free: true,
    contextWindow: "128K",
    description: "Meta Llama 3.1 8B — fastest model on Groq, 128K context",
  },
  {
    id: "gemma2-9b-it",
    name: "Gemma 2 9B",
    provider: "groq",
    free: true,
    contextWindow: "8K",
    description: "Google Gemma 2 9B Instruct — compact & reliable on Groq",
  },
];

export const AVAILABLE_MODELS: ModelOption[] = [...GEMINI_MODELS, ...OPENROUTER_MODELS, ...GROQ_MODELS];

// ─── Client factories ─────────────────────────────────────────────────────────

function createGeminiClient(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

function createOpenRouterClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": process.env.CLIENT_URL ?? "https://scrapex.app",
      "X-Title": "Scrapex",
    },
  });
}

function createGroqClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey,
  });
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.7,
  maxTokens = 4096
): Promise<string> {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  if (model.provider === "gemini") {
    return geminiChat(modelId, messages, temperature, maxTokens);
  } else if (model.provider === "groq") {
    return groqChat(modelId, messages, temperature, maxTokens);
  } else {
    return openrouterChat(modelId, messages, temperature, maxTokens);
  }
}

export async function* streamCompletion(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.7,
  maxTokens = 4096
): AsyncGenerator<string> {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  if (model.provider === "gemini") {
    yield* geminiStream(modelId, messages, temperature, maxTokens);
  } else if (model.provider === "groq") {
    yield* groqStream(modelId, messages, temperature, maxTokens);
  } else {
    yield* openrouterStream(modelId, messages, temperature, maxTokens);
  }
}

// ─── Gemini implementation ────────────────────────────────────────────────────

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

function buildGeminiContents(messages: ChatMessage[]) {
  // Gemini uses "user"/"model" roles, no "system" role in contents
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages.filter((m) => m.role !== "system");

  const contents = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  return { systemMsg, contents };
}

async function geminiChat(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): Promise<string> {
  const keys = getAllKeys(GEMINI_PREFIX);
  if (keys.length === 0) throw new ProviderExhaustedError("Gemini");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      const genAI = createGeminiClient(apiKey);
      const { systemMsg, contents } = buildGeminiContents(messages);
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemMsg,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      });
      const result = await model.generateContent({ contents });
      return result.response.text();
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`[aiService] Gemini key quota hit, trying next key…`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  console.warn(`[aiService] All Gemini keys exhausted`);
  throw new ProviderExhaustedError("Gemini");
  void lastError;
}

async function* geminiStream(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): AsyncGenerator<string> {
  const keys = getAllKeys(GEMINI_PREFIX);
  if (keys.length === 0) throw new ProviderExhaustedError("Gemini");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      const genAI = createGeminiClient(apiKey);
      const { systemMsg, contents } = buildGeminiContents(messages);
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemMsg,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      });
      const streamResult = await model.generateContentStream({ contents });
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
      return;
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`[aiService] Gemini stream key quota hit, trying next key…`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  console.warn(`[aiService] All Gemini keys exhausted (stream)`);
  throw new ProviderExhaustedError("Gemini");
  void lastError;
}

// ─── OpenRouter implementation ────────────────────────────────────────────────

async function openrouterChat(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): Promise<string> {
  const keys = getAllKeys(OPENROUTER_PREFIX);
  if (keys.length === 0) throw new ProviderExhaustedError("OpenRouter");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      const client = createOpenRouterClient(apiKey);
      const response = await client.chat.completions.create({
        model: modelId,
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      return response.choices[0]?.message?.content ?? "";
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`[aiService] OpenRouter key quota hit, trying next key…`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  console.warn(`[aiService] All OpenRouter keys exhausted`);
  throw new ProviderExhaustedError("OpenRouter");
  void lastError;
}

async function* openrouterStream(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): AsyncGenerator<string> {
  const keys = getAllKeys(OPENROUTER_PREFIX);
  if (keys.length === 0) throw new ProviderExhaustedError("OpenRouter");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      const client = createOpenRouterClient(apiKey);
      const stream = await client.chat.completions.create({
        model: modelId,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
      return;
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`[aiService] OpenRouter stream key quota hit, trying next key…`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  console.warn(`[aiService] All OpenRouter keys exhausted (stream)`);
  throw new ProviderExhaustedError("OpenRouter");
  void lastError;
}

// ─── Groq implementation ──────────────────────────────────────────────────────

async function groqChat(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): Promise<string> {
  const keys = getAllKeys(GROQ_PREFIX);
  if (keys.length === 0) throw new ProviderExhaustedError("Groq");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      const client = createGroqClient(apiKey);
      const response = await client.chat.completions.create({
        model: modelId,
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      return response.choices[0]?.message?.content ?? "";
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`[aiService] Groq key quota hit, trying next key…`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  console.warn(`[aiService] All Groq keys exhausted`);
  throw new ProviderExhaustedError("Groq");
  void lastError;
}

async function* groqStream(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): AsyncGenerator<string> {
  const keys = getAllKeys(GROQ_PREFIX);
  if (keys.length === 0) throw new ProviderExhaustedError("Groq");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      const client = createGroqClient(apiKey);
      const stream = await client.chat.completions.create({
        model: modelId,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
      return;
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`[aiService] Groq stream key quota hit, trying next key…`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  console.warn(`[aiService] All Groq keys exhausted (stream)`);
  throw new ProviderExhaustedError("Groq");
  void lastError;
}

