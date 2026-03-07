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

export type OutputLanguage = "typescript" | "python";

export interface SessionConfig {
  websiteUrl: string;
  instructions: string;
  modelId: string;
  language: OutputLanguage;
}

export interface SessionResult {
  schema: Record<string, unknown>;
  refinedPrompt: string;
  analysis: string;
  apiFile: string;
}

export interface DailyUsage {
  used: number;
  limit: number;
  isOwner: boolean;
}

export type TeamRole = "owner" | "editor" | "viewer";

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  invited_by?: string | null;
  created_at?: string;
  user?: {
    email: string;
    display_name?: string;
    avatar_url?: string | null;
  };
}
