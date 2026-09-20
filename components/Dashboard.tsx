"use client";

import { useCallback, useState } from "react";
import { Header } from "@/components/Header";
import { PostsTable } from "@/components/PostsTable";
import { HistoryPanel } from "@/components/HistoryPanel";
import type { InternalLinkControls } from "@/components/LinkSuggestions";
import { ToastStack, type ToastMessage } from "@/components/Toast";
import { fetchJson, streamRewrite } from "@/lib/api-client";
import { isUrlLinkedInHtml, normalizeUrl } from "@/lib/internal-links";
import { useInternalLinkFormat } from "@/lib/use-internal-link-format";
import {
  type LinkSuggestion,
  type MatchBatchResult,
  type PublishStatus,
  type RewriteLog,
  type WordPressPostListItem,
} from "@/types";

const PER_PAGE = 10;
const TOAST_DURATION_MS = 5000;

interface DashboardProps {
  initialPosts: WordPressPostListItem[];
  initialTotalPages: number;
  initialPostsError: string | null;
  initialLogs: RewriteLog[];
  initialLogsError: string | null;
  initialPendingPostIds: number[];
  initialGeminiModel: string;
  /** Stored internal-link candidates for the initial posts (postId -> candidates; missing = not matched yet). */
  initialLinkSuggestions: Record<number, LinkSuggestion[]>;
  /** Articles in the index; null when it couldn't be read (see initialLinkSuggestionsError). */
  initialIndexedCount: number | null;
  initialLinkSuggestionsError: string | null;
}

export function Dashboard({
  initialPosts,
  initialTotalPages,
  initialPostsError,
  initialLogs,
  initialLogsError,
  initialPendingPostIds,
  initialGeminiModel,
  initialLinkSuggestions,
  initialIndexedCount,
  initialLinkSuggestionsError,
}: DashboardProps) {
  const [posts, setPosts] = useState<WordPressPostListItem[]>(initialPosts);
  const [postsLoading, setPostsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [logs, setLogs] = useState<RewriteLog[]>(initialLogs);
  const [logsLoading, setLogsLoading] = useState(false);

  const [pendingPostIds, setPendingPostIds] = useState<Set<number>>(
    new Set(initialPendingPostIds)
  );
  const [busyPostId, setBusyPostId] = useState<number | null>(null);
  const [liveBody, setLiveBody] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [instructions, setInstructions] = useState<Record<number, string>>({});
  const [geminiModel, setGeminiModel] = useState(initialGeminiModel);

  // Internal-link candidates (matched from the article index) shown under each post's instruction box.
  const [linkSuggestions, setLinkSuggestions] =
    useState<Record<number, LinkSuggestion[]>>(initialLinkSuggestions);
  const [indexedCount, setIndexedCount] = useState<number | null>(initialIndexedCount);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(
    initialLinkSuggestionsError
  );
  const [findingPostId, setFindingPostId] = useState<number | null>(null);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Record<number, number[]>>({});
  const [linkFormat, handleLinkFormatChange] = useInternalLinkFormat();

  const handleInstructionChange = useCallback((postId: number, value: string) => {
    setInstructions((prev) => ({ ...prev, [postId]: value }));
  }, []);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((type: ToastMessage["type"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const fetchPendingStates = useCallback(async (postIds: number[]) => {
    if (postIds.length === 0) {
      setPendingPostIds(new Set());
      return;
    }
    try {
      const data = await fetchJson<{ success: true; pendingPostIds: number[] }>(
        `/api/rewrite/state?postIds=${postIds.join(",")}`
      );
      setPendingPostIds(new Set(data.pendingPostIds));
    } catch {
      // Non-fatal: pending badges just won't reflect the latest state.
    }
  }, []);

  /** Loads stored candidates for the given posts (used after the visible page changes). */
  const fetchSuggestions = useCallback(async (postIds: number[]) => {
    if (postIds.length === 0) return;
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const data = await fetchJson<{
        success: true;
        indexedCount: number;
        results: Record<string, LinkSuggestion[]>;
      }>(`/api/articles/suggestions?postIds=${postIds.join(",")}`);
      setIndexedCount(data.indexedCount);
      setLinkSuggestions((prev) => ({ ...prev, ...data.results }));
    } catch (error) {
      // Non-fatal: the rest of the dashboard works without link candidates
      // (e.g. before the article_index migration has been applied).
      setSuggestionsError(error instanceof Error ? error.message : "取得に失敗しました。");
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  const handleToggleLink = useCallback((postId: number, targetId: number) => {
    setSelectedLinkIds((prev) => {
      const current = prev[postId] ?? [];
      return {
        ...prev,
        [postId]: current.includes(targetId)
          ? current.filter((id) => id !== targetId)
          : [...current, targetId],
      };
    });
  }, []);

  /** Ticked candidates for a post, minus any the body already links to, in the shape the rewrite API takes. */
  const getSelectedLinks = useCallback(
    (postId: number) => {
      const ids = selectedLinkIds[postId];
      if (!ids?.length) return [];
      const content = posts.find((post) => post.id === postId)?.content ?? "";
      return (linkSuggestions[postId] ?? [])
        .filter((s) => ids.includes(s.post_id) && !isUrlLinkedInHtml(content, s.url))
        .map((s) => ({ url: s.url, title: s.title, reason: s.reason || undefined }));
    },
    [selectedLinkIds, linkSuggestions, posts]
  );

  const fetchPosts = useCallback(
    async (nextPage: number, nextSearch: string) => {
      setPostsLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          per_page: String(PER_PAGE),
        });
        if (nextSearch) params.set("search", nextSearch);

        const data = await fetchJson<{
          success: true;
          posts: WordPressPostListItem[];
          totalPages: number;
        }>(`/api/wordpress/posts?${params.toString()}`);

        setPosts(data.posts);
        setTotalPages(Math.max(1, data.totalPages));
        setPage(nextPage);
        setSearch(nextSearch);
        const postIds = (data.posts as WordPressPostListItem[]).map((post) => post.id);
        void fetchSuggestions(postIds);
        await fetchPendingStates(postIds);
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "記事の取得に失敗しました。");
      } finally {
        setPostsLoading(false);
      }
    },
    [pushToast, fetchPendingStates, fetchSuggestions]
  );

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await fetchJson<{ success: true; logs: RewriteLog[] }>("/api/logs?limit=20");
      setLogs(data.logs);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "履歴の取得に失敗しました。");
    } finally {
      setLogsLoading(false);
    }
  }, [pushToast]);

  const fetchGeminiModel = useCallback(async () => {
    try {
      const data = await fetchJson<{ success: true; geminiModel?: string }>("/api/settings");
      if (data.geminiModel) setGeminiModel(data.geminiModel);
    } catch {
      // Non-fatal: cost estimates just keep using the last known model.
    }
  }, []);

  const handleFindSuggestions = useCallback(
    async (postId: number) => {
      setFindingPostId(postId);
      try {
        const data = await fetchJson<{ success: true } & MatchBatchResult>("/api/articles/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postIds: [postId], force: true }),
        });
        if (data.failed.length > 0) throw new Error(data.failed[0].error);

        const found = data.results[postId] ?? [];
        setLinkSuggestions((prev) => ({ ...prev, [postId]: found }));
        // Forget ticks for candidates that are no longer suggested.
        setSelectedLinkIds((prev) => ({
          ...prev,
          [postId]: (prev[postId] ?? []).filter((id) => found.some((s) => s.post_id === id)),
        }));
        setIndexedCount((prev) => prev ?? 1);
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "リンク候補の検索に失敗しました。");
      } finally {
        setFindingPostId(null);
      }
    },
    [pushToast]
  );

  const handleRewrite = useCallback(
    async (postId: number, publishStatus: PublishStatus) => {
      setBusyPostId(postId);
      setLiveBody("");
      try {
        const instruction = instructions[postId]?.trim() || undefined;
        const internalLinks = getSelectedLinks(postId);
        const result = await streamRewrite(
          postId,
          publishStatus,
          {
            instruction,
            internalLinks: internalLinks.length > 0 ? internalLinks : undefined,
            internalLinkFormat: internalLinks.length > 0 ? linkFormat : undefined,
          },
          setLiveBody
        );

        pushToast(
          "success",
          publishStatus === "publish"
            ? "リライトして公開しました。"
            : "リライトして下書き保存しました。"
        );

        // Links that made it into the body are done (the candidate list flags them "リンク済み" after the
        // refetch below); keep only the ones Gemini skipped ticked so a re-run retries just those.
        const missingKeys = new Set(result.missingLinkUrls.map((url) => normalizeUrl(url)));
        if (missingKeys.size > 0) {
          const missing = internalLinks.filter((link) => missingKeys.has(normalizeUrl(link.url)));
          pushToast(
            "warning",
            `内部リンク${missing.length}件が本文に挿入されませんでした（${missing
              .map((link) => `「${link.title}」`)
              .join("、")}）。もう一度リライトすると再試行できます。`
          );
        }
        setSelectedLinkIds((prev) => ({
          ...prev,
          [postId]: (linkSuggestions[postId] ?? [])
            .filter((s) => missingKeys.has(normalizeUrl(s.url)))
            .map((s) => s.post_id),
        }));
        setPendingPostIds((prev) => new Set(prev).add(postId));

        // fetchLogs() below reconciles with the DB, but reflect the summary we
        // already have immediately so the history panel isn't left waiting on
        // a second round-trip to show it.
        if (result.summary) {
          const postTitle = posts.find((p) => p.id === postId)?.title ?? "";
          setLogs((prev) => [
            {
              id: `optimistic-${postId}-${Date.now()}`,
              post_id: postId,
              post_title: postTitle,
              post_url: result.updatedUrl,
              status: "success",
              original_content_snippet: null,
              rewritten_content_snippet: null,
              summary: result.summary ?? null,
              error_message: null,
              created_at: new Date().toISOString(),
            },
            ...prev,
          ]);
        }

        await Promise.all([fetchPosts(page, search), fetchLogs()]);
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "リライトに失敗しました。");
        await fetchLogs();
      } finally {
        setBusyPostId(null);
        setLiveBody("");
      }
    },
    [
      fetchPosts,
      fetchLogs,
      page,
      search,
      pushToast,
      instructions,
      posts,
      getSelectedLinks,
      linkFormat,
      linkSuggestions,
    ]
  );

  const handleRevert = useCallback(
    async (postId: number) => {
      setBusyPostId(postId);
      try {
        await fetchJson("/api/rewrite/revert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId }),
        });

        pushToast("success", "リライト前の記事に戻しました。");
        setPendingPostIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
        await Promise.all([fetchPosts(page, search), fetchLogs()]);
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "元に戻すのに失敗しました。");
      } finally {
        setBusyPostId(null);
      }
    },
    [fetchPosts, fetchLogs, page, search, pushToast]
  );

  const handleFinalize = useCallback(
    async (postId: number) => {
      setBusyPostId(postId);
      try {
        await fetchJson("/api/rewrite/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId }),
        });

        pushToast("success", "リライト内容を確定しました。");
        setPendingPostIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "確定に失敗しました。");
      } finally {
        setBusyPostId(null);
      }
    },
    [pushToast]
  );

  const handleBulkShortcut = useCallback(async () => {
    setBulkRunning(true);
    try {
      const data = await fetchJson<{ success: true; posts: WordPressPostListItem[] }>(
        "/api/wordpress/posts?per_page=1&order=asc"
      );

      const oldest = data.posts[0];
      if (!oldest) {
        pushToast("error", "対象記事が見つかりませんでした。");
        return;
      }

      await handleRewrite(oldest.id, "draft");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "実行に失敗しました。");
    } finally {
      setBulkRunning(false);
    }
  }, [handleRewrite, pushToast]);

  const handleSearchSubmit = useCallback(() => {
    fetchPosts(1, searchInput.trim());
  }, [fetchPosts, searchInput]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      fetchPosts(nextPage, search);
    },
    [fetchPosts, search]
  );

  const handleRefresh = useCallback(() => {
    fetchPosts(page, search);
    fetchLogs();
    fetchGeminiModel();
  }, [fetchPosts, fetchLogs, fetchGeminiModel, page, search]);

  const internalLinkControls: InternalLinkControls = {
    suggestions: linkSuggestions,
    indexedCount,
    loading: suggestionsLoading,
    error: suggestionsError,
    findingPostId,
    selectedIds: selectedLinkIds,
    format: linkFormat,
    onToggle: handleToggleLink,
    onFind: handleFindSuggestions,
    onFormatChange: handleLinkFormatChange,
    getSelectedLinks,
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <Header
        onRefresh={handleRefresh}
        refreshing={postsLoading || logsLoading}
        onBulkShortcut={handleBulkShortcut}
        bulkRunning={bulkRunning}
      />

      {(initialPostsError || initialLogsError) && (
        <div className="flex flex-col gap-2">
          {initialPostsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {initialPostsError}
            </div>
          )}
          {initialLogsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {initialLogsError}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <PostsTable
          posts={posts}
          loading={postsLoading}
          search={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearchSubmit}
          page={page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          busyPostId={busyPostId}
          onRewrite={handleRewrite}
          instructions={instructions}
          onInstructionChange={handleInstructionChange}
          pendingPostIds={pendingPostIds}
          onRevert={handleRevert}
          onFinalize={handleFinalize}
          geminiModel={geminiModel}
          internalLinks={internalLinkControls}
          liveBody={liveBody}
        />
        <HistoryPanel logs={logs} loading={logsLoading} />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
