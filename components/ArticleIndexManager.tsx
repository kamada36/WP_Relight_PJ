"use client";

import { useMemo, useRef, useState } from "react";
import { ExternalLink, Link2, Loader2, RefreshCw, Search, Sparkles, Square } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { fetchJson } from "@/lib/api-client";
import type { ArticleListItem, MatchBatchResult, SyncPageResult } from "@/types";

/** Sources per /api/articles/match call (the server allows up to 10; smaller keeps each request short). */
const MATCH_CHUNK = 5;
const PAGE_SIZE = 50;

interface Progress {
  label: string;
  done: number;
  total: number;
}

interface RunReport {
  tone: "success" | "warning" | "error";
  message: string;
  failures: string[];
}

interface ArticleIndexManagerProps {
  initialArticles: ArticleListItem[];
}

function postJson<T extends { success: true }>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}

const BUTTON_BASE =
  "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60";
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`;
const BUTTON_SECONDARY = `${BUTTON_BASE} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900`;
const ROW_BUTTON =
  "flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function ArticleIndexManager({ initialArticles }: ArticleIndexManagerProps) {
  const [articles, setArticles] = useState(initialArticles);
  const [running, setRunning] = useState<"sync" | "match" | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [rowBusy, setRowBusy] = useState<{ postId: number; kind: "summary" | "match" } | null>(null);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const cancelRef = useRef(false);

  const stats = useMemo(() => {
    const published = articles.filter((a) => a.status === "publish");
    return {
      total: published.length,
      summarized: published.filter((a) => a.summary).length,
      matched: published.filter((a) => a.suggestions !== null).length,
      withCandidates: published.filter((a) => a.suggestions && a.suggestions.length > 0).length,
    };
  }, [articles]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return articles;
    return articles.filter((a) =>
      [a.title, a.url, a.summary ?? "", ...a.keywords].some((text) => text.toLowerCase().includes(needle))
    );
  }, [articles, query]);

  async function refresh() {
    const data = await fetchJson<{ success: true; articles: ArticleListItem[] }>("/api/articles");
    setArticles(data.articles);
  }

  async function runSync(force: boolean) {
    if (
      force &&
      !window.confirm(
        "全記事の概要をGeminiで作り直します（記事数に応じてAPI費用がかかります）。よろしいですか？"
      )
    ) {
      return;
    }

    setRunning("sync");
    setReport(null);
    cancelRef.current = false;

    const seenIds: number[] = [];
    const failures: string[] = [];
    let summarized = 0;
    let page = 1;
    let totalPages = 1;
    let completed = false;

    try {
      while (page <= totalPages) {
        setProgress({ label: "記事を取得して概要を作成中…", done: page - 1, total: totalPages });
        const result = await postJson<{ success: true } & SyncPageResult>("/api/articles/sync", {
          action: "page",
          page,
          force,
        });
        totalPages = result.totalPages;
        seenIds.push(...result.postIds);
        summarized += result.summarized;
        failures.push(...result.failed.map((f) => `「${f.title}」: ${f.error}`));
        page++;

        if (cancelRef.current) break;
      }
      completed = page > totalPages;

      // Only a complete pass may drop rows for deleted/unpublished posts.
      if (completed) {
        setProgress({ label: "整理中…", done: totalPages, total: totalPages });
        await postJson("/api/articles/sync", { action: "prune", keepIds: seenIds });
      }
      await refresh();

      setReport({
        tone: failures.length > 0 ? "warning" : "success",
        message: `${completed ? "完了しました" : "中断しました"}: ${seenIds.length}件を確認し、${summarized}件の概要を作成しました。${
          failures.length > 0
            ? `${failures.length}件は失敗しました。もう一度実行すると、概要が無い記事だけ再試行されます。`
            : ""
        }`,
        failures,
      });
    } catch (error) {
      await refresh().catch(() => undefined);
      setReport({
        tone: "error",
        message: `${page}ページ目で中断しました: ${
          error instanceof Error ? error.message : "不明なエラー"
        }。もう一度実行すると、作成済みの概要はそのまま続きから処理されます。`,
        failures,
      });
    } finally {
      setRunning(null);
      setProgress(null);
    }
  }

  async function runMatch(force: boolean) {
    const targets = articles.filter(
      (a) => a.status === "publish" && a.summary && (force || a.suggestions === null)
    );
    if (targets.length === 0) {
      setReport({
        tone: "success",
        message: force
          ? "マッチング対象の記事がありません。先に概要を作成してください。"
          : "未マッチングの記事はありません。",
        failures: [],
      });
      return;
    }
    if (
      force &&
      !window.confirm(
        `${targets.length}件すべてのリンク候補をGeminiで探し直します（API費用がかかります）。よろしいですか？`
      )
    ) {
      return;
    }

    setRunning("match");
    setReport(null);
    cancelRef.current = false;

    const failures: string[] = [];
    const titleById = new Map(articles.map((a) => [a.post_id, a.title]));
    let processed = 0;
    let withCandidates = 0;

    try {
      for (let i = 0; i < targets.length && !cancelRef.current; i += MATCH_CHUNK) {
        setProgress({ label: "リンク候補をマッチング中…", done: i, total: targets.length });
        const ids = targets.slice(i, i + MATCH_CHUNK).map((a) => a.post_id);
        const result = await postJson<{ success: true } & MatchBatchResult>("/api/articles/match", {
          postIds: ids,
          force,
        });
        processed += Object.keys(result.results).length;
        withCandidates += Object.values(result.results).filter((r) => r.length > 0).length;
        failures.push(
          ...result.failed.map((f) => `「${titleById.get(f.postId) ?? f.postId}」: ${f.error}`)
        );
      }
      await refresh();
      setReport({
        tone: failures.length > 0 ? "warning" : "success",
        message: `${cancelRef.current ? "中断しました" : "完了しました"}: ${processed}件をマッチングし、${withCandidates}件でリンク候補が見つかりました。${
          failures.length > 0 ? `${failures.length}件は失敗しました（再実行で未処理分のみ再試行されます）。` : ""
        }`,
        failures,
      });
    } catch (error) {
      await refresh().catch(() => undefined);
      setReport({
        tone: "error",
        message: `マッチングを中断しました: ${
          error instanceof Error ? error.message : "不明なエラー"
        }。再実行すると、マッチング済みの記事はスキップして続きから処理されます。`,
        failures,
      });
    } finally {
      setRunning(null);
      setProgress(null);
    }
  }

  async function runRowAction(postId: number, kind: "summary" | "match") {
    setRowBusy({ postId, kind });
    setReport(null);
    try {
      if (kind === "summary") {
        const result = await postJson<{ success: true; error?: string }>("/api/articles/sync", {
          action: "post",
          postId,
        });
        if (result.error) throw new Error(result.error);
      } else {
        const result = await postJson<{ success: true } & MatchBatchResult>("/api/articles/match", {
          postIds: [postId],
          force: true,
        });
        if (result.failed.length > 0) throw new Error(result.failed[0].error);
      }
      await refresh();
    } catch (error) {
      setReport({
        tone: "error",
        message: error instanceof Error ? error.message : "処理に失敗しました。",
        failures: [],
      });
    } finally {
      setRowBusy(null);
    }
  }

  const busy = running !== null || rowBusy !== null;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const unmatchedCount = articles.filter(
    (a) => a.status === "publish" && a.summary && a.suggestions === null
  ).length;

  return (
    <>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">記事インデックス</h1>
        <p className="mb-4 text-sm text-zinc-500">
          公開中の全記事のURLと概要を一覧化し、記事ごとに「自然な流れで紹介できる関連記事」をマッチングします。
          マッチング結果はダッシュボードの各記事の指示欄に表示され、チェックするだけでリライト時にリンクが挿入されます。
        </p>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="公開記事" value={stats.total} />
          <Stat label="概要あり" value={stats.summarized} />
          <Stat label="マッチング済み" value={stats.matched} />
          <Stat label="候補あり" value={stats.withCandidates} />
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              ① 全記事の概要を作成
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => runSync(false)} disabled={busy} className={BUTTON_PRIMARY}>
                {running === "sync" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                概要を作成・更新
              </button>
              <button onClick={() => runSync(true)} disabled={busy} className={BUTTON_SECONDARY}>
                全件作り直す
              </button>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              新しい記事・概要が未作成の記事だけをGeminiで要約します（作成済みの概要は再利用するので低コストです）。
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              ② リンク候補をマッチング
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => runMatch(false)}
                disabled={busy || stats.summarized === 0}
                className={BUTTON_PRIMARY}
              >
                {running === "match" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                未マッチングの記事を処理{unmatchedCount > 0 ? `（${unmatchedCount}件）` : ""}
              </button>
              <button
                onClick={() => runMatch(true)}
                disabled={busy || stats.summarized === 0}
                className={BUTTON_SECONDARY}
              >
                全件やり直す
              </button>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              新しい記事を追加した後は「全件やり直す」で、既存記事の候補にも反映できます。
            </p>
          </div>

          {progress && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  {progress.label}（{progress.done} / {progress.total}）
                </span>
                <button
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  <Square className="h-3 w-3" />
                  中断
                </button>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-sky-600 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="text-xs text-zinc-500">
                処理中はこのページを閉じないでください（中断しても、処理済み分は保存されています）。
              </p>
            </div>
          )}

          {report && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                report.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                  : report.tone === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              }`}
            >
              <p>{report.message}</p>
              {report.failures.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs">失敗の詳細（{report.failures.length}件）</summary>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {report.failures.slice(0, 30).map((failure, index) => (
                      <li key={index} className="break-words">
                        {failure}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="relative border-b border-zinc-200 p-3 sm:p-4 dark:border-zinc-800">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 sm:left-7" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="タイトル・URL・概要・キーワードで絞り込み"
            className="w-full rounded-lg border border-zinc-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
        </div>

        {articles.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            まだ記事インデックスがありません。「① 全記事の概要を作成」を実行してください。
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">該当する記事がありません。</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {filtered.slice(0, visibleCount).map((article) => {
              const summaryBusy = rowBusy?.postId === article.post_id && rowBusy.kind === "summary";
              const matchBusy = rowBusy?.postId === article.post_id && rowBusy.kind === "match";
              return (
                <li key={article.post_id} className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-start gap-1 font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      <span className="break-words">{article.title || "(無題)"}</span>
                      <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    </a>
                    {article.status !== "publish" && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {article.status === "draft" ? "下書き" : article.status}（リンク候補にはなりません）
                      </span>
                    )}
                    <span className="text-xs text-zinc-400">#{article.post_id}</span>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 break-all text-xs text-zinc-500">{article.url}</span>
                    <CopyButton text={article.url} title="URLをコピー" label="URLコピー" />
                  </div>

                  {article.summary ? (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{article.summary}</p>
                  ) : (
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      概要が未作成です（「概要を作成・更新」で作成されます）。
                    </p>
                  )}

                  {article.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {article.keywords.map((keyword) => (
                        <span
                          key={keyword}
                          className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-2.5 text-xs dark:border-sky-900 dark:bg-sky-950/30">
                    <p className="mb-1 flex items-center gap-1.5 font-medium text-sky-800 dark:text-sky-200">
                      <Link2 className="h-3.5 w-3.5" />
                      内部リンク候補
                    </p>
                    {article.suggestions === null ? (
                      <p className="text-zinc-500">未マッチング</p>
                    ) : article.suggestions.length === 0 ? (
                      <p className="text-zinc-500">自然に紹介できる関連記事は見つかりませんでした。</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {article.suggestions.map((suggestion) => (
                          <li key={suggestion.post_id}>
                            <a
                              href={suggestion.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                            >
                              {suggestion.title}
                            </a>
                            {suggestion.reason && (
                              <span className="text-zinc-500"> — {suggestion.reason}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => runRowAction(article.post_id, "summary")}
                      disabled={busy}
                      className={ROW_BUTTON}
                    >
                      {summaryBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      概要を再作成
                    </button>
                    {article.status === "publish" && article.summary && (
                      <button
                        onClick={() => runRowAction(article.post_id, "match")}
                        disabled={busy}
                        className={ROW_BUTTON}
                      >
                        {matchBusy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Link2 className="h-3 w-3" />
                        )}
                        候補を再検索
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > visibleCount && (
          <div className="border-t border-zinc-200 p-3 text-center dark:border-zinc-800">
            <button onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className={BUTTON_SECONDARY}>
              さらに表示（残り{filtered.length - visibleCount}件）
            </button>
          </div>
        )}
      </div>
    </>
  );
}
