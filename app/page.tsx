import { Dashboard } from "@/components/Dashboard";
import { getPosts } from "@/lib/wordpress";
import { getAppSettings, getPendingPostIds, getRewriteLogs } from "@/lib/supabase";
import { DEFAULT_MODEL_NAME } from "@/lib/gemini";
import { getSuggestionsForPosts } from "@/lib/article-index";
import type { LinkSuggestion, RewriteLog, WordPressPostListItem } from "@/types";

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

  // Both depend on the posts above but not on each other, so run them side by side.
  const initialPostIds = initialPosts.map((post) => post.id);
  const [pendingResult, suggestionsResult] = await Promise.allSettled([
    getPendingPostIds(initialPostIds),
    initialPostIds.length > 0
      ? getSuggestionsForPosts(initialPostIds)
      : Promise.resolve({ indexedCount: 0, results: {} as Record<number, LinkSuggestion[]> }),
  ]);

  // Non-fatal: pending badges just won't show until the client refetches.
  const initialPendingPostIds = pendingResult.status === "fulfilled" ? pendingResult.value : [];

  // Non-fatal too: without link candidates (e.g. article_index migration not applied yet) the rest works as before.
  const initialLinkSuggestions = suggestionsResult.status === "fulfilled" ? suggestionsResult.value.results : {};
  const initialIndexedCount =
    suggestionsResult.status === "fulfilled" ? suggestionsResult.value.indexedCount : null;
  const initialLinkSuggestionsError =
    suggestionsResult.status === "rejected"
      ? suggestionsResult.reason instanceof Error
        ? suggestionsResult.reason.message
        : "取得に失敗しました。"
      : null;

  return (
    <Dashboard
      initialPosts={initialPosts}
      initialTotalPages={initialTotalPages}
      initialPostsError={initialPostsError}
      initialLogs={initialLogs}
      initialLogsError={initialLogsError}
      initialPendingPostIds={initialPendingPostIds}
      initialGeminiModel={initialGeminiModel}
      initialLinkSuggestions={initialLinkSuggestions}
      initialIndexedCount={initialIndexedCount}
      initialLinkSuggestionsError={initialLinkSuggestionsError}
    />
  );
}
