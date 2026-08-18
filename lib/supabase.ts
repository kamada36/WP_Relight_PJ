import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MODEL_NAME } from "@/lib/gemini";
import type { AppSettings, PendingRewriteState, RewriteLog, RewriteLogInput } from "@/types";

const APP_SETTINGS_ID = 1;
const POST_REWRITE_STATE_TABLE = "post_rewrite_state";

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase credentials are not configured");
  }

  cachedClient = createClient(url, key);
  return cachedClient;
}

export async function logRewriteResult(data: RewriteLogInput): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from("rewrite_logs").insert(data);
  if (error) {
    console.error("Failed to write rewrite log:", error.message);
  }
}

export async function getRewriteLogs(limit = 20): Promise<RewriteLog[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("rewrite_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch rewrite logs: ${error.message}`);
  }

  return (data ?? []) as RewriteLog[];
}

export async function getAppSettings(): Promise<AppSettings> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("cron_interval_days, last_cron_run_at, gemini_model")
    .eq("id", APP_SETTINGS_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch app settings: ${error.message}`);
  }

  return {
    cronIntervalDays: data?.cron_interval_days ?? 1,
    lastCronRunAt: data?.last_cron_run_at ?? null,
    geminiModel: data?.gemini_model ?? DEFAULT_MODEL_NAME,
  };
}

export async function updateGeminiModel(model: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: APP_SETTINGS_ID, gemini_model: model });

  if (error) {
    throw new Error(`Failed to update app settings: ${error.message}`);
  }
}

export async function updateCronIntervalDays(days: number): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: APP_SETTINGS_ID, cron_interval_days: days });

  if (error) {
    throw new Error(`Failed to update app settings: ${error.message}`);
  }
}

/** Records that the cron endpoint ran just now, regardless of whether it actually rewrote a post. */
export async function markCronRun(): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: APP_SETTINGS_ID, last_cron_run_at: new Date().toISOString() });

  if (error) {
    console.error("Failed to update last_cron_run_at:", error.message);
  }
}

export async function getPendingRewriteState(postId: number): Promise<PendingRewriteState | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from(POST_REWRITE_STATE_TABLE)
    .select("post_id, original_content, original_status")
    .eq("post_id", postId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch pending rewrite state: ${error.message}`);
  }

  return (data as PendingRewriteState | null) ?? null;
}

/** Returns the subset of postIds that currently have an unfinalized (revertible) rewrite. */
export async function getPendingPostIds(postIds: number[]): Promise<number[]> {
  if (postIds.length === 0) return [];

  const supabase = getClient();
  const { data, error } = await supabase
    .from(POST_REWRITE_STATE_TABLE)
    .select("post_id")
    .in("post_id", postIds);

  if (error) {
    throw new Error(`Failed to fetch pending rewrite states: ${error.message}`);
  }

  return (data ?? []).map((row) => row.post_id as number);
}

/**
 * Backs up the pre-rewrite content/status for a post, but only the first time
 * it's called for that post since its last finalize/revert — later rewrites
 * must not overwrite the original that "元に戻す" restores to.
 */
export async function saveOriginalIfAbsent(
  postId: number,
  originalContent: string,
  originalStatus: string
): Promise<void> {
  const existing = await getPendingRewriteState(postId);
  if (existing) return;

  const supabase = getClient();
  const { error } = await supabase.from(POST_REWRITE_STATE_TABLE).insert({
    post_id: postId,
    original_content: originalContent,
    original_status: originalStatus,
  });

  // Ignore unique-violation races (another request already saved the original).
  if (error && error.code !== "23505") {
    console.error("Failed to save original content backup:", error.message);
  }
}

/** Discards the saved original for a post, whether because it was finalized or already reverted. */
export async function clearPendingRewriteState(postId: number): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from(POST_REWRITE_STATE_TABLE).delete().eq("post_id", postId);

  if (error) {
    console.error("Failed to clear pending rewrite state:", error.message);
  }
}
