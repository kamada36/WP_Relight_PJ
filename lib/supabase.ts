import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppSettings, RewriteLog, RewriteLogInput } from "@/types";

const APP_SETTINGS_ID = 1;

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
    .select("cron_interval_days, last_cron_run_at")
    .eq("id", APP_SETTINGS_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch app settings: ${error.message}`);
  }

  return {
    cronIntervalDays: data?.cron_interval_days ?? 1,
    lastCronRunAt: data?.last_cron_run_at ?? null,
  };
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
