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
  /** 本文に挿入してほしい内部リンク（記事インデックスのマッチング結果から選んだもの）。 */
  internalLinks?: InternalLinkRequest[];
  internalLinkFormat?: InternalLinkFormat;
}

export interface RewriteResponse {
  success: boolean;
  postId?: number;
  updatedUrl?: string;
  summary?: string | null;
  /** 挿入を依頼したが、リライト結果の本文に見当たらなかった内部リンクのURL。 */
  missingLinkUrls?: string[];
  error?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

// App settings (Cron interval / Gemini model)

// 0 = 自動リライトを行わない（Cronが呼ばれても何もしない）
export const CRON_INTERVAL_OPTIONS = [1, 2, 3, 7, 0] as const;
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

// Internal links (article index / link suggestions)

/** blogcard = 単独行のURL(WordPress・主要テーマが自動でカード化する) / text = <a>によるテキストリンク */
export const INTERNAL_LINK_FORMATS = ["blogcard", "text"] as const;
export type InternalLinkFormat = (typeof INTERNAL_LINK_FORMATS)[number];

/** リライト時にプロンプトへ含める内部リンク1件。 */
export interface InternalLinkRequest {
  url: string;
  title: string;
  /** どの文脈で紹介できるか（マッチング時にGeminiが書いた説明）。 */
  reason?: string;
}

export interface ArticleIndexEntry {
  post_id: number;
  title: string;
  url: string;
  status: string;
  /** Gemini失敗時などは null（次回の同期で再試行される）。 */
  summary: string | null;
  keywords: string[];
  synced_at: string;
  summarized_at: string | null;
}

/** DBに保存する形。タイトル・URLは表示時に article_index から引く。 */
export interface StoredLinkSuggestion {
  post_id: number;
  reason: string;
}

/** 表示用に article_index のタイトル・URLを結合した形。 */
export interface LinkSuggestion extends StoredLinkSuggestion {
  title: string;
  url: string;
}

export interface ArticleListItem extends ArticleIndexEntry {
  /** null = 未マッチング、[] = マッチング済みだが該当なし。 */
  suggestions: LinkSuggestion[] | null;
}

export interface SyncPageResult {
  page: number;
  totalPages: number;
  total: number;
  /** このページで処理した公開記事のID（最後に prune へ渡す）。 */
  postIds: number[];
  summarized: number;
  skipped: number;
  failed: { postId: number; title: string; error: string }[];
}

export interface MatchBatchResult {
  /** postId -> 候補（0〜3件）。 */
  results: Record<number, LinkSuggestion[]>;
  failed: { postId: number; error: string }[];
}
