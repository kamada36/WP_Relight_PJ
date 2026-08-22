"use client";

import { ExternalLink, Loader2, RotateCcw, Search } from "lucide-react";
import type { PublishStatus, WordPressPostListItem } from "@/types";
import { estimateRewriteCost, formatJpy } from "@/lib/gemini-pricing";

interface PostsTableProps {
  posts: WordPressPostListItem[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  busyPostId: number | null;
  onRewrite: (postId: number, publishStatus: PublishStatus) => void;
  instructions: Record<number, string>;
  onInstructionChange: (postId: number, value: string) => void;
  pendingPostIds: Set<number>;
  onRevert: (postId: number) => void;
  onFinalize: (postId: number) => void;
  geminiModel: string;
  /** Live text streamed back from Gemini for the currently busy post's rewrite, if any. */
  liveBody: string;
}

const LIVE_PREVIEW_TAIL_CHARS = 800;

function LiveRewritePreview({ text }: { text: string }) {
  if (!text) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        生成を開始しています…
      </div>
    );
  }
  return (
    <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {text.length > LIVE_PREVIEW_TAIL_CHARS ? `…${text.slice(-LIVE_PREVIEW_TAIL_CHARS)}` : text}
    </pre>
  );
}

const STATUS_LABELS: Record<string, string> = {
  publish: "公開中",
  draft: "下書き",
  pending: "承認待ち",
  private: "非公開",
  future: "予約投稿",
};

const STATUS_STYLES: Record<string, string> = {
  publish: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  private: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  future: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
};

const MODEL_SHORT_LABELS: Record<string, string> = {
  "gemini-3.6-flash": "Flash",
  "gemini-3.6-flash-lite": "Flash-Lite",
};

function RewriteCostHint({
  post,
  instruction,
  geminiModel,
}: {
  post: WordPressPostListItem;
  instruction: string;
  geminiModel: string;
}) {
  const estimate = estimateRewriteCost(
    post.title.length + post.content.length,
    geminiModel,
    instruction.length
  );
  return (
    <p className="text-xs text-zinc-400">
      推定コスト: 約{formatJpy(estimate.costJpy)}（入出力合計約{" "}
      {(estimate.inputTokens + estimate.outputTokens).toLocaleString("ja-JP")} トークン）
    </p>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PostsTable({
  posts,
  loading,
  search,
  onSearchChange,
  onSearchSubmit,
  page,
  totalPages,
  onPageChange,
  busyPostId,
  onRewrite,
  instructions,
  onInstructionChange,
  pendingPostIds,
  onRevert,
  onFinalize,
  geminiModel,
  liveBody,
}: PostsTableProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-2 border-b border-zinc-200 p-3 sm:flex-row sm:items-center sm:p-4 dark:border-zinc-800">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearchSubmit();
            }}
            placeholder="タイトルで検索"
            className="w-full rounded-lg border border-zinc-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
        </div>
        <button
          onClick={onSearchSubmit}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          検索
        </button>
      </div>
      <p className="border-b border-zinc-200 px-3 py-2 text-xs text-zinc-400 sm:px-4 dark:border-zinc-800">
        コスト概算の基準モデル: {MODEL_SHORT_LABELS[geminiModel] ?? geminiModel}
        （変更は設定ページから）
      </p>

      {/* Mobile: card list (avoids squeezing a 5-column table into a narrow screen) */}
      <div className="divide-y divide-zinc-100 sm:hidden dark:divide-zinc-900">
        {loading ? (
          <div className="px-4 py-10 text-center text-zinc-500">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="px-4 py-10 text-center text-zinc-500">記事が見つかりませんでした。</div>
        ) : (
          posts.map((post) => {
            const isBusy = busyPostId === post.id;
            const isPending = pendingPostIds.has(post.id);
            return (
              <div key={post.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={post.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-start gap-1 font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                  >
                    <span className="break-words">{post.title || "(無題)"}</span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  </a>
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[post.status] ?? STATUS_STYLES.draft
                    }`}
                  >
                    {STATUS_LABELS[post.status] ?? post.status}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  #{post.id} ・ {formatDate(post.modified)}
                </p>
                {isPending && (
                  <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      未確定のリライトがあります。確定するまで元の記事に戻せます。
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => onRevert(post.id)}
                        disabled={isBusy}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 px-2.5 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        元に戻す
                      </button>
                      <button
                        onClick={() => onFinalize(post.id)}
                        disabled={isBusy}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-60"
                      >
                        {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        この内容で確定
                      </button>
                    </div>
                  </div>
                )}
                <textarea
                  value={instructions[post.id] ?? ""}
                  onChange={(event) => onInstructionChange(post.id, event.target.value)}
                  placeholder="この記事だけの指示（任意）例: もっとカジュアルな口調にする"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
                />
                <RewriteCostHint
                  post={post}
                  instruction={instructions[post.id] ?? ""}
                  geminiModel={geminiModel}
                />
                {isBusy && <LiveRewritePreview text={liveBody} />}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => onRewrite(post.id, "draft")}
                    disabled={isBusy}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    リライトして下書き保存
                  </button>
                  <button
                    onClick={() => onRewrite(post.id, "publish")}
                    disabled={isBusy}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    リライトして即時公開
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop / tablet: table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">タイトル</th>
              <th className="px-4 py-3 font-medium">最終更新日</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : posts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                  記事が見つかりませんでした。
                </td>
              </tr>
            ) : (
              posts.map((post) => {
                const isBusy = busyPostId === post.id;
                const isPending = pendingPostIds.has(post.id);
                return (
                  <tr
                    key={post.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <td className="px-4 py-3 text-zinc-500">{post.id}</td>
                    <td className="max-w-xs px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <a
                          href={post.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-1 font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                        >
                          <span className="truncate">{post.title || "(無題)"}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                        </a>
                        {isPending && (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            未確定
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                      {formatDate(post.modified)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[post.status] ?? STATUS_STYLES.draft
                        }`}
                      >
                        {STATUS_LABELS[post.status] ?? post.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-[220px] flex-col gap-2">
                        {isPending && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => onRevert(post.id)}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              元に戻す
                            </button>
                            <button
                              onClick={() => onFinalize(post.id)}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-60"
                            >
                              {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              この内容で確定
                            </button>
                          </div>
                        )}
                        <textarea
                          value={instructions[post.id] ?? ""}
                          onChange={(event) => onInstructionChange(post.id, event.target.value)}
                          placeholder="この記事だけの指示（任意）"
                          rows={2}
                          className="w-full resize-none rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
                        />
                        <RewriteCostHint
                          post={post}
                          instruction={instructions[post.id] ?? ""}
                          geminiModel={geminiModel}
                        />
                        {isBusy && <LiveRewritePreview text={liveBody} />}
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => onRewrite(post.id, "draft")}
                            disabled={isBusy}
                            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                          >
                            {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            リライトして下書き保存
                          </button>
                          <button
                            onClick={() => onRewrite(post.id, "publish")}
                            disabled={isBusy}
                            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                          >
                            {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            リライトして即時公開
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
        <span className="text-zinc-500">
          {totalPages > 0 ? `${page} / ${totalPages} ページ` : "-"}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            前へ
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            次へ
          </button>
        </div>
      </div>
    </div>
  );
}
