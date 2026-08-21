// WordPress

export type WordPressPostStatus =
  | "publish"
  | "draft"
  | "pending"
  | "private"
  | "future";

export interface WordPressPostListItem {
  id: number;
  title: string;
  content: string;
  modified: string;
  status: string;
  link: string;
}

export interface WordPressPost {
  id: number;
  title: string;
  content: string;
  status: WordPressPostStatus;
  modified: string;
  link: string;
}

export interface PostsListResponse {
  success: true;
  posts: WordPressPostListItem[];
  total: number;
  totalPages: number;
  page: number;
}

// Supabase rewrite_logs

export type RewriteStatus = "pending" | "success" | "failed" | "reverted";

export interface RewriteLog {
  id: string;
  post_id: number;
  post_title: string;
  post_url: string | null;
  status: RewriteStatus;
  original_content_snippet: string | null;
  rewritten_content_snippet: string | null;
  /** Rough, non-detailed description of what changed, in Japanese (e.g. "見出しの言い回しを整理した"). */
  summary: string | null;
  error_message: string | null;
  created_at: string;
}

export interface RewriteLogInput {
  post_id: number;
  post_title: string;
  post_url?: string | null;
  status: RewriteStatus;
  original_content_snippet?: string | null;
  rewritten_content_snippet?: string | null;
  summary?: string | null;
  error_message?: string | null;
}

// API

export type PublishStatus = "draft" | "publish";

export interface RewriteRequestBody {
  postId: number;
  publishStatus: PublishStatus;
  instruction?: string;
}

export interface RewriteResponse {
  success: boolean;
  postId?: number;
  updatedUrl?: string;
  summary?: string | null;
  error?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

// App settings (Cron interval / Gemini model)

export const CRON_INTERVAL_OPTIONS = [1, 2, 3, 7] as const;
export type CronIntervalDays = (typeof CRON_INTERVAL_OPTIONS)[number];

// Pro is intentionally excluded (cost).
export const GEMINI_MODEL_OPTIONS = ["gemini-3.6-flash", "gemini-3.6-flash-lite"] as const;
export type GeminiModelName = (typeof GEMINI_MODEL_OPTIONS)[number];

export interface AppSettings {
  cronIntervalDays: number;
  lastCronRunAt: string | null;
  geminiModel: string;
}

// Pending rewrite state (original content kept until the user finalizes or reverts)

export interface PendingRewriteState {
  post_id: number;
  original_content: string;
  original_status: string;
}
