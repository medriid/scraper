export interface ModelOption {
  id: string;
  name: string;
  provider: "gemini" | "openrouter" | "groq";
  free: boolean;
  contextWindow: string;
  description: string;
  available: boolean;
}

export interface AgentStep {
  type:
    | "thinking"
    | "browsing"
    | "analyzing"
    | "generating"
    | "refining"
    | "building"
    | "complete"
    | "error";
  message: string;
  detail?: string;
  data?: {
    analysis?: string;
    schema?: Record<string, unknown>;
    refinedPrompt?: string;
    apiFile?: string;
  };
}

export type SessionPhase =
  | "idle"
  | "configuring"
  | "running"
  | "complete"
  | "error";

export interface SessionConfig {
  websiteUrl: string;
  instructions: string;
  modelId: string;
}

export interface SessionResult {
  schema: Record<string, unknown>;
  refinedPrompt: string;
  analysis: string;
  apiFile: string;
}
