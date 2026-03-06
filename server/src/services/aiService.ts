import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import OpenAI from "openai";
import { getNextKey, GEMINI_PREFIX, OPENROUTER_PREFIX } from "./keyRotation.js";

export interface ModelOption {
  id: string;
  name: string;
  provider: "gemini" | "openrouter";
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
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Google's latest fast model — balanced speed & quality",
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
    id: "gemini-2.5-pro-preview-03-25",
    name: "Gemini 2.5 Pro (Preview)",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Most capable Gemini — advanced reasoning & code",
  },
  {
    id: "gemini-2.5-flash-preview-04-17",
    name: "Gemini 2.5 Flash (Preview)",
    provider: "gemini",
    free: true,
    contextWindow: "1M",
    description: "Next-gen Flash — speed + strong reasoning",
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
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash Exp (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "1M",
    description: "Gemini 2.0 Flash via OpenRouter — no Gemini key needed",
  },
  {
    id: "google/gemini-2.0-pro-exp-02-05:free",
    name: "Gemini 2.0 Pro Exp (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "2M",
    description: "Gemini 2.0 Pro Experimental via OpenRouter",
  },
  {
    id: "google/gemini-2.5-pro-exp-03-25:free",
    name: "Gemini 2.5 Pro Exp (OR)",
    provider: "openrouter",
    free: true,
    contextWindow: "1M",
    description: "Gemini 2.5 Pro Experimental via OpenRouter — top-tier",
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

export const AVAILABLE_MODELS: ModelOption[] = [...GEMINI_MODELS, ...OPENROUTER_MODELS];

// ─── Client factories ─────────────────────────────────────────────────────────

function createGeminiClient(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

function createOpenRouterClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": process.env.CLIENT_URL ?? "https://scraper.app",
      "X-Title": "AI Scraper",
    },
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
  const apiKey = getNextKey(GEMINI_PREFIX);
  if (!apiKey) throw new Error("No Gemini API key available (set GEMINI_API_KEY_1, ...)");

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
}

async function* geminiStream(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): AsyncGenerator<string> {
  const apiKey = getNextKey(GEMINI_PREFIX);
  if (!apiKey) throw new Error("No Gemini API key available (set GEMINI_API_KEY_1, ...)");

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
}

// ─── OpenRouter implementation ────────────────────────────────────────────────

async function openrouterChat(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): Promise<string> {
  const apiKey = getNextKey(OPENROUTER_PREFIX);
  if (!apiKey) throw new Error("No OpenRouter API key available (set OPENROUTER_API_KEY_1, ...)");

  const client = createOpenRouterClient(apiKey);
  const response = await client.chat.completions.create({
    model: modelId,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content ?? "";
}

async function* openrouterStream(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): AsyncGenerator<string> {
  const apiKey = getNextKey(OPENROUTER_PREFIX);
  if (!apiKey) throw new Error("No OpenRouter API key available (set OPENROUTER_API_KEY_1, ...)");

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
}

