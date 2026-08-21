import { Dashboard } from "@/components/Dashboard";
import { getPosts } from "@/lib/wordpress";
import { getAppSettings, getPendingPostIds, getRewriteLogs } from "@/lib/supabase";
import { DEFAULT_MODEL_NAME } from "@/lib/gemini";
import type { RewriteLog, WordPressPostListItem } from "@/types";

export const dynamic = "force-dynamic";

const PER_PAGE = 10;

export default async function DashboardPage() {
  // These three are independent of each other, so run them concurrently —
  // awaiting them one at a time made the whole page (and therefore
  // navigating back here from Settings) take as long as the sum of all
  // three round-trips instead of the slowest one.
  const [postsResult, logsResult, settingsResult] = await Promise.allSettled([
    getPosts(1, PER_PAGE, ""),
    getRewriteLogs(20),
    getAppSettings(),
  ]);

  let initialPosts: WordPressPostListItem[] = [];
  let initialTotalPages = 1;
  let initialPostsError: string | null = null;
  if (postsResult.status === "fulfilled") {
    initialPosts = postsResult.value.posts;
    initialTotalPages = Math.max(1, postsResult.value.totalPages);
  } else {
    initialPostsError =
      postsResult.reason instanceof Error ? postsResult.reason.message : "記事の取得に失敗しました。";
  }

  let initialLogs: RewriteLog[] = [];
  let initialLogsError: string | null = null;
  if (logsResult.status === "fulfilled") {
    initialLogs = logsResult.value;
  } else {
    initialLogsError =
      logsResult.reason instanceof Error ? logsResult.reason.message : "履歴の取得に失敗しました。";
  }

  const initialGeminiModel =
    settingsResult.status === "fulfilled" ? settingsResult.value.geminiModel : DEFAULT_MODEL_NAME;

  let initialPendingPostIds: number[] = [];
  try {
    initialPendingPostIds = await getPendingPostIds(initialPosts.map((post) => post.id));
  } catch {
    // Non-fatal: pending badges just won't show until the client refetches.
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
