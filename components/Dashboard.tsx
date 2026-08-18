"use client";

import { useCallback, useState } from "react";
import { Header } from "@/components/Header";
import { PostsTable } from "@/components/PostsTable";
import { HistoryPanel } from "@/components/HistoryPanel";
import { ToastStack, type ToastMessage } from "@/components/Toast";
import type { PublishStatus, RewriteLog, WordPressPostListItem } from "@/types";

const PER_PAGE = 10;
const TOAST_DURATION_MS = 5000;

interface DashboardProps {
  initialPosts: WordPressPostListItem[];
  initialTotalPages: number;
  initialPostsError: string | null;
  initialLogs: RewriteLog[];
  initialLogsError: string | null;
  initialPendingPostIds: number[];
}

export function Dashboard({
  initialPosts,
  initialTotalPages,
  initialPostsError,
  initialLogs,
  initialLogsError,
  initialPendingPostIds,
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
  const [bulkRunning, setBulkRunning] = useState(false);
  const [instructions, setInstructions] = useState<Record<number, string>>({});

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
      const res = await fetch(`/api/rewrite/state?postIds=${postIds.join(",")}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setPendingPostIds(new Set(data.pendingPostIds));
      }
    } catch {
      // Non-fatal: pending badges just won't reflect the latest state.
    }
  }, []);

  const fetchPosts = useCallback(
    async (nextPage: number, nextSearch: string) => {
      setPostsLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          per_page: String(PER_PAGE),
        });
        if (nextSearch) params.set("search", nextSearch);

        const res = await fetch(`/api/wordpress/posts?${params.toString()}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "記事の取得に失敗しました。");
        }

        setPosts(data.posts);
        setTotalPages(Math.max(1, data.totalPages));
        setPage(nextPage);
        setSearch(nextSearch);
        await fetchPendingStates(
          (data.posts as WordPressPostListItem[]).map((post) => post.id)
        );
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "記事の取得に失敗しました。");
      } finally {
        setPostsLoading(false);
      }
    },
    [pushToast, fetchPendingStates]
  );

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/logs?limit=20");
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "履歴の取得に失敗しました。");
      }

      setLogs(data.logs);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "履歴の取得に失敗しました。");
    } finally {
      setLogsLoading(false);
    }
  }, [pushToast]);

  const handleRewrite = useCallback(
    async (postId: number, publishStatus: PublishStatus) => {
      setBusyPostId(postId);
      try {
        const instruction = instructions[postId]?.trim() || undefined;
        const res = await fetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, publishStatus, instruction }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "リライトに失敗しました。");
        }

        pushToast(
          "success",
          publishStatus === "publish"
            ? "リライトして公開しました。"
            : "リライトして下書き保存しました。"
        );
        await Promise.all([fetchPosts(page, search), fetchLogs()]);
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "リライトに失敗しました。");
        await fetchLogs();
      } finally {
        setBusyPostId(null);
      }
    },
    [fetchPosts, fetchLogs, page, search, pushToast, instructions]
  );

  const handleRevert = useCallback(
    async (postId: number) => {
      setBusyPostId(postId);
      try {
        const res = await fetch("/api/rewrite/revert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "元に戻すのに失敗しました。");
        }

        pushToast("success", "リライト前の記事に戻しました。");
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
        const res = await fetch("/api/rewrite/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "確定に失敗しました。");
        }

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
      const res = await fetch("/api/wordpress/posts?per_page=1&order=asc");
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "記事の取得に失敗しました。");
      }

      const oldest = data.posts[0] as WordPressPostListItem | undefined;
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
  }, [fetchPosts, fetchLogs, page, search]);

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
        />
        <HistoryPanel logs={logs} loading={logsLoading} />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
