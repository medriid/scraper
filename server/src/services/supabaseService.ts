import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
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

export async function listSessions(limit = 20): Promise<ScraperSession[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("scraper_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Supabase listSessions error:", error.message);
    return [];
  }
  return data ?? [];
}
