import type { ModelOption, Team, TeamMember, DailyUsage } from "../types";

const BASE = "/api";

export async function fetchModels(): Promise<{
  models: ModelOption[];
  keyStatus: { gemini: number; openrouter: number; groq: number };
}> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

export async function fetchUsage(token: string): Promise<{ usage: DailyUsage }> {
  const res = await fetch(`${BASE}/scraper/usage`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch usage");
  return res.json();
}

// ─── Teams API ────────────────────────────────────────────────────────────────

export async function fetchTeams(token: string): Promise<Team[]> {
  const res = await fetch(`${BASE}/teams`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch teams");
  const data = await res.json();
  return data.teams;
}

export async function createTeam(name: string, token: string): Promise<Team> {
  const res = await fetch(`${BASE}/teams`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create team" }));
    throw new Error(err.error ?? "Failed to create team");
  }
  const data = await res.json();
  return data.team;
}

export async function deleteTeam(teamId: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}/teams/${teamId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to delete team");
}

export async function fetchTeamMembers(teamId: string, token: string): Promise<TeamMember[]> {
  const res = await fetch(`${BASE}/teams/${teamId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch team members");
  const data = await res.json();
  return data.members;
}

export async function addTeamMember(
  teamId: string,
  email: string,
  role: "editor" | "viewer",
  token: string
): Promise<TeamMember> {
  const res = await fetch(`${BASE}/teams/${teamId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to add member" }));
    throw new Error(err.error ?? "Failed to add member");
  }
  const data = await res.json();
  return data.member;
}

export async function removeTeamMember(
  teamId: string,
  memberId: string,
  token: string
): Promise<void> {
  const res = await fetch(`${BASE}/teams/${teamId}/members/${memberId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to remove member");
}

export async function submitCrawlJob(
  websiteUrl: string,
  instructions: string,
  modelId: string,
  language: string,
  extractionMode: string,
  credentials: import("../types").AuthCredentials | undefined,
  token?: string
): Promise<{ jobId: string; sessionId: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const body: Record<string, unknown> = { websiteUrl, instructions, modelId, language, extractionMode };
  if (credentials && Object.values(credentials).some(Boolean)) {
    body.credentials = credentials;
  }

  const res = await fetch(`${BASE}/scraper/crawl`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(text);
  }
  return res.json();
}

export function pollCrawlJob(
  jobId: string,
  onStep: (step: import("../types").AgentStep) => void,
  onCodeChunk: (chunk: string) => void,
  onStatus: (status: string, progress: number) => void,
  onDone: (result: unknown) => void,
  onError: (message: string) => void,
  token?: string
): () => void {
  let cancelled = false;

  const run = async () => {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${BASE}/scraper/crawl/${jobId}`, { headers });
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
            else if (currentEvent === "status") onStatus(data.status, data.progress);
            else if (currentEvent === "done") onDone(data);
            else if (currentEvent === "error") onError(data.message);
          } catch {
            // ignore
          }
          currentEvent = "";
        }
      }
    }
  };

  run().catch((err) => onError(err instanceof Error ? err.message : String(err)));
  return () => { cancelled = true; };
}

export async function mapWebsite(
  websiteUrl: string,
  token?: string
): Promise<{ siteMap: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/scraper/map`, {
    method: "POST",
    headers,
    body: JSON.stringify({ websiteUrl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(text);
  }
  return res.json();
}

export function startAgentSession(
  websiteUrl: string,
  instructions: string,
  modelId: string,
  language: string,
  extractionMode: string,
  credentials: import("../types").AuthCredentials | undefined,
  onStep: (step: import("../types").AgentStep) => void,
  onCodeChunk: (chunk: string) => void,
  onDone: (sessionId: string | null) => void,
  onError: (message: string) => void,
  token?: string
): () => void {
  let cancelled = false;

  const run = async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const body: Record<string, unknown> = { websiteUrl, instructions, modelId, language, extractionMode };
    if (credentials && Object.values(credentials).some(Boolean)) {
      body.credentials = credentials;
    }

    const res = await fetch(`${BASE}/scraper/start`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
