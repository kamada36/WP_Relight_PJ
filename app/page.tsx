import { Dashboard } from "@/components/Dashboard";
import { getPosts } from "@/lib/wordpress";
import { getAppSettings, getPendingPostIds, getRewriteLogs } from "@/lib/supabase";
import { DEFAULT_MODEL_NAME } from "@/lib/gemini";
import type { RewriteLog, WordPressPostListItem } from "@/types";

export const dynamic = "force-dynamic";

const PER_PAGE = 10;

export default async function DashboardPage() {
  let initialPosts: WordPressPostListItem[] = [];
  let initialTotalPages = 1;
  let initialPostsError: string | null = null;

  try {
    const result = await getPosts(1, PER_PAGE, "");
    initialPosts = result.posts;
    initialTotalPages = Math.max(1, result.totalPages);
  } catch (error) {
    initialPostsError = error instanceof Error ? error.message : "記事の取得に失敗しました。";
  }

  let initialLogs: RewriteLog[] = [];
  let initialLogsError: string | null = null;

  try {
    initialLogs = await getRewriteLogs(20);
  } catch (error) {
    initialLogsError = error instanceof Error ? error.message : "履歴の取得に失敗しました。";
  }

  let initialPendingPostIds: number[] = [];
  try {
    initialPendingPostIds = await getPendingPostIds(initialPosts.map((post) => post.id));
  } catch {
    // Non-fatal: pending badges just won't show until the client refetches.
  }

  let initialGeminiModel = DEFAULT_MODEL_NAME;
  try {
    initialGeminiModel = (await getAppSettings()).geminiModel;
  } catch {
    // Non-fatal: cost estimates just fall back to the default model's pricing.
  }

  return (
    <Dashboard
      initialPosts={initialPosts}
      initialTotalPages={initialTotalPages}
      initialPostsError={initialPostsError}
      initialLogs={initialLogs}
      initialLogsError={initialLogsError}
      initialPendingPostIds={initialPendingPostIds}
      initialGeminiModel={initialGeminiModel}
    />
  );
}
