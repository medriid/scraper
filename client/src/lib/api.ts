import type { ModelOption } from "../types";

const BASE = "/api";

export async function fetchModels(): Promise<{
  models: ModelOption[];
  keyStatus: { openai: number; openrouter: number };
}> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

export function startAgentSession(
  websiteUrl: string,
  instructions: string,
  modelId: string,
  onStep: (step: import("../types").AgentStep) => void,
  onCodeChunk: (chunk: string) => void,
  onDone: (sessionId: string | null) => void,
  onError: (message: string) => void
): () => void {
  let cancelled = false;

  const run = async () => {
    const res = await fetch(`${BASE}/scraper/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteUrl, instructions, modelId }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "Unknown error");
      onError(text);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!cancelled) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          try {
            const data = JSON.parse(raw);
            if (currentEvent === "step") onStep(data);
            else if (currentEvent === "code_chunk") onCodeChunk(data.chunk);
            else if (currentEvent === "done") onDone(data.sessionId);
            else if (currentEvent === "error") onError(data.message);
          } catch {
            // ignore parse errors
          }
          currentEvent = "";
        }
      }
    }
  };

  run().catch((err) => onError(err instanceof Error ? err.message : String(err)));

  return () => {
    cancelled = true;
  };
}
