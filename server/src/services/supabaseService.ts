import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  // Support both the legacy SUPABASE_ANON_KEY and the newer SUPABASE_PUBLISHABLE_KEY name
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  avatar_url?: string | null;
  is_owner: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Supabase getUserProfile error:", error.message);
    return null;
  }
  return data;
}

export async function upsertUserProfile(profile: Omit<UserProfile, "is_owner" | "created_at" | "updated_at">): Promise<UserProfile | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("users")
    .upsert({
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    console.error("Supabase upsertUserProfile error:", error.message);
    return null;
  }
  return data;
}

export async function verifyUserToken(token: string): Promise<{ userId: string; email: string } | null> {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? "" };
}

export interface ScraperSession {
  id?: string;
  website_url: string;
  instructions: string;
  model_id: string;
  user_id?: string;
  suggested_schema?: Record<string, unknown>;
  refined_prompt?: string;
  generated_api_file?: string;
  agent_log?: string[];
  created_at?: string;
  updated_at?: string;
}

export async function createSession(session: ScraperSession): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("scraper_sessions")
    .insert({
      website_url: session.website_url,
      instructions: session.instructions,
      model_id: session.model_id,
      ...(session.user_id ? { user_id: session.user_id } : {}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("Supabase createSession error:", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function updateSession(
  id: string,
  updates: Partial<ScraperSession>
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("scraper_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("Supabase updateSession error:", error.message);
  }
}

export async function getSession(id: string): Promise<ScraperSession | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("scraper_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Supabase getSession error:", error.message);
    return null;
  }
  return data;
}

export async function listSessions(limit = 20, userId?: string): Promise<ScraperSession[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  let query = client
    .from("scraper_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Supabase listSessions error:", error.message);
    return [];
  }
  return data ?? [];
}

// ─── Daily Usage Tracking ─────────────────────────────────────────────────────

const DAILY_PROMPT_LIMIT_NORMAL = 1;

export async function getUserDailyUsage(userId: string): Promise<{ used: number; limit: number; isOwner: boolean }> {
  const client = getSupabaseClient();
  if (!client) return { used: 0, limit: 999, isOwner: true };

  const { data, error } = await client
    .from("users")
    .select("daily_prompts_used, last_prompt_date, is_owner")
    .eq("id", userId)
    .single();

  if (error || !data) return { used: 0, limit: 999, isOwner: false };

  const today = new Date().toISOString().slice(0, 10);
  const lastDate = data.last_prompt_date ?? null;
  const used = lastDate === today ? (data.daily_prompts_used ?? 0) : 0;

  if (data.is_owner) return { used, limit: 999, isOwner: true };
  return { used, limit: DAILY_PROMPT_LIMIT_NORMAL, isOwner: false };
}

export async function incrementUserDailyUsage(userId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const today = new Date().toISOString().slice(0, 10);

  // Fetch current state
  const { data } = await client
    .from("users")
    .select("daily_prompts_used, last_prompt_date")
    .eq("id", userId)
    .single();

  const lastDate = data?.last_prompt_date ?? null;
  const currentUsed = lastDate === today ? (data?.daily_prompts_used ?? 0) : 0;

  const { error } = await client
    .from("users")
    .update({
      daily_prompts_used: currentUsed + 1,
      last_prompt_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error("Supabase incrementUserDailyUsage error:", error.message);
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────────

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
  role: "owner" | "editor" | "viewer";
  invited_by?: string | null;
  created_at?: string;
  user?: { email: string; display_name?: string; avatar_url?: string | null };
}

export async function createTeam(name: string, ownerId: string): Promise<Team | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("teams")
    .insert({ name, owner_id: ownerId })
    .select()
    .single();

  if (error) {
    console.error("Supabase createTeam error:", error.message);
    return null;
  }
  return data;
}

export async function listTeams(userId: string): Promise<Team[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  // Teams owned by the user
  const { data: owned, error: e1 } = await client
    .from("teams")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  // Teams the user is a member of
  const { data: memberships, error: e2 } = await client
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);

  if (e1) console.error("listTeams owned error:", e1.message);
  if (e2) console.error("listTeams memberships error:", e2.message);

  const memberTeamIds = (memberships ?? []).map((m) => m.team_id);
  let memberTeams: Team[] = [];
  if (memberTeamIds.length > 0) {
    const { data: mt } = await client
      .from("teams")
      .select("*")
      .in("id", memberTeamIds)
      .order("created_at", { ascending: false });
    memberTeams = mt ?? [];
  }

  // Deduplicate
  const allTeams = [...(owned ?? []), ...memberTeams];
  const seen = new Set<string>();
  return allTeams.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .single();

  if (error) {
    console.error("Supabase getTeam error:", error.message);
    return null;
  }
  return data;
}

export async function deleteTeam(teamId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.from("teams").delete().eq("id", teamId);
  if (error) console.error("Supabase deleteTeam error:", error.message);
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("team_members")
    .select("*, user:users(email, display_name, avatar_url)")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Supabase listTeamMembers error:", error.message);
    return [];
  }
  return data ?? [];
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: "editor" | "viewer",
  invitedBy: string
): Promise<TeamMember | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("team_members")
    .upsert({ team_id: teamId, user_id: userId, role, invited_by: invitedBy }, { onConflict: "team_id,user_id" })
    .select()
    .single();

  if (error) {
    console.error("Supabase addTeamMember error:", error.message);
    return null;
  }
  return data;
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) console.error("Supabase removeTeamMember error:", error.message);
}

export async function getUserByEmail(email: string): Promise<UserProfile | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (error) {
    console.error("Supabase getUserByEmail error:", error.message);
    return null;
  }
  return data;
}

export async function checkDatabaseConnection(): Promise<{ connected: boolean; latencyMs?: number; message?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { connected: false, message: "Supabase not configured (missing SUPABASE_URL or key)" };
  }

  const start = Date.now();
  try {
    const { error } = await client.from("scraper_sessions").select("id").limit(1);
    const latencyMs = Date.now() - start;
    if (error) {
      return { connected: false, latencyMs, message: error.message };
    }
    return { connected: true, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    return { connected: false, latencyMs, message: String(err) };
  }
}
