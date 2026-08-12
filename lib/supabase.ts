import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RewriteLog, RewriteLogInput } from "@/types";

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
