import OpenAI from "openai";
import { getNextKey, OPENAI_PREFIX, OPENROUTER_PREFIX } from "./keyRotation.js";

export interface ModelOption {
  id: string;
  name: string;
  provider: "openai" | "openrouter";
  free: boolean;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash",
    provider: "openrouter",
    free: true,
    description: "Google Gemini 2.0 Flash – fast, efficient, free tier",
  },
  {
    id: "google/gemini-2.0-pro-exp-02-05:free",
    name: "Gemini 2.0 Pro",
    provider: "openrouter",
    free: true,
    description: "Google Gemini 2.0 Pro – advanced reasoning, free tier",
  },
  {
    id: "google/gemini-2.5-flash-preview:free",
    name: "Gemini 2.5 Flash",
    provider: "openrouter",
    free: true,
    description: "Google Gemini 2.5 Flash Preview – latest, free tier",
  },
  {
    id: "google/gemini-2.5-flash-lite-preview:free",
    name: "Gemini 2.5 Flash Lite",
    provider: "openrouter",
    free: true,
    description: "Google Gemini 2.5 Flash Lite – lightweight, free tier",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B",
    provider: "openrouter",
    free: true,
    description: "Meta Llama 3.3 70B Instruct – powerful open model, free tier",
  },
  {
    id: "deepseek/deepseek-chat:free",
    name: "DeepSeek Chat",
    provider: "openrouter",
    free: true,
    description: "DeepSeek Chat – strong reasoning & code, free tier",
  },
  {
    id: "mistralai/mistral-7b-instruct:free",
    name: "Mistral 7B",
    provider: "openrouter",
    free: true,
    description: "Mistral 7B Instruct – fast and capable, free tier",
  },
  {
    id: "qwen/qwen-2.5-72b-instruct:free",
    name: "Qwen 2.5 72B",
    provider: "openrouter",
    free: true,
    description: "Alibaba Qwen 2.5 72B – multilingual, free tier",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    free: false,
    description: "OpenAI GPT-4o Mini – fast, cost-efficient",
  },
  {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    provider: "openai",
    free: false,
    description: "OpenAI GPT-3.5 Turbo – reliable and fast",
  },
];

function createOpenRouterClient(): OpenAI | null {
  const key = getNextKey(OPENROUTER_PREFIX);
  if (!key) return null;
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: key,
    defaultHeaders: {
      "HTTP-Referer": process.env.CLIENT_URL ?? "https://scraper.app",
      "X-Title": "AI Scraper",
    },
  });
}

function createOpenAIClient(): OpenAI | null {
  const key = getNextKey(OPENAI_PREFIX);
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export function getClientForModel(modelId: string): { client: OpenAI; model: string } | null {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!model) return null;

  if (model.provider === "openrouter") {
    const client = createOpenRouterClient();
    if (!client) return null;
    return { client, model: modelId };
  } else {
    const client = createOpenAIClient();
    if (!client) return null;
    return { client, model: modelId };
  }
}

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
  const clientInfo = getClientForModel(modelId);
  if (!clientInfo) throw new Error(`No API key available for model: ${modelId}`);

  const { client, model } = clientInfo;
  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function* streamCompletion(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.7,
  maxTokens = 4096
): AsyncGenerator<string> {
  const clientInfo = getClientForModel(modelId);
  if (!clientInfo) throw new Error(`No API key available for model: ${modelId}`);

  const { client, model } = clientInfo;
  const stream = await client.chat.completions.create({
    model,
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
