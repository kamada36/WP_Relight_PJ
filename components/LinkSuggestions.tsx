"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Link2, Loader2, RefreshCw } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { INTERNAL_LINK_FORMAT_LABELS, isUrlLinkedInHtml } from "@/lib/internal-links";
import {
  INTERNAL_LINK_FORMATS,
  type InternalLinkFormat,
  type InternalLinkRequest,
  type LinkSuggestion,
} from "@/types";

/** Everything the dashboard's per-article link-suggestion panels need, bundled so it can be passed down as one prop. */
export interface InternalLinkControls {
  /** postId -> matched candidates. A missing key means the article hasn't been matched yet. */
  suggestions: Record<number, LinkSuggestion[]>;
  /** Number of articles in the index (null until the first load finishes). 0 = index not built yet. */
  indexedCount: number | null;
  loading: boolean;
  error: string | null;
  /** The post whose candidates are currently being (re)searched, if any. */
  findingPostId: number | null;
  /** postId -> ids of the candidates the user ticked for the next rewrite. */
  selectedIds: Record<number, number[]>;
  format: InternalLinkFormat;
  onToggle: (postId: number, targetId: number) => void;
  onFind: (postId: number) => void;
  onFormatChange: (format: InternalLinkFormat) => void;
  /** The links that will be sent with the next rewrite of this post (ticked and not already in the body). */
  getSelectedLinks: (postId: number) => InternalLinkRequest[];
}

interface LinkSuggestionsPanelProps {
  postId: number;
  /** Current body HTML, used to flag candidates the article already links to. */
  postContent: string;
  controls: InternalLinkControls;
  /** True while a rewrite of this post is running (ticks are locked so the request stays consistent). */
  disabled: boolean;
}

export function LinkSuggestionsPanel({
  postId,
  postContent,
  controls,
  disabled,
}: LinkSuggestionsPanelProps) {
  const suggestions = controls.suggestions[postId];
  const finding = controls.findingPostId === postId;
  const selected = controls.selectedIds[postId] ?? [];
  const selectedCount = controls.getSelectedLinks(postId).length;

  let body: ReactNode;
  if (suggestions === undefined && controls.loading) {
    body = (
      <p className="flex items-center gap-1.5 text-zinc-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        候補を確認しています…
      </p>
    );
  } else if (suggestions === undefined && controls.error) {
    body = <p className="text-zinc-500">候補を取得できませんでした: {controls.error}</p>;
  } else if (controls.indexedCount === 0) {
    body = (
      <p className="text-zinc-600 dark:text-zinc-400">
        記事インデックスが未作成です。
        <Link href="/articles" className="ml-1 font-medium text-sky-700 underline dark:text-sky-300">
          記事インデックスを作成
        </Link>
        すると、関連記事の候補がここに表示されます。
      </p>
    );
  } else if (suggestions === undefined) {
    body = (
      <button
        type="button"
        onClick={() => controls.onFind(postId)}
        disabled={finding}
        className="flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-2 py-1 font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-60 dark:border-sky-800 dark:bg-transparent dark:text-sky-200 dark:hover:bg-sky-900"
      >
        {finding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
        リンク候補を探す
      </button>
    );
  } else if (suggestions.length === 0) {
    body = (
      <p className="text-zinc-500">自然に紹介できる関連記事は見つかりませんでした。</p>
    );
  } else {
    const selectable = suggestions.filter((s) => !isUrlLinkedInHtml(postContent, s.url));
    body = (
      <div className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {suggestions.map((suggestion) => {
            const linked = isUrlLinkedInHtml(postContent, suggestion.url);
            const checked = !linked && selected.includes(suggestion.post_id);
            return (
              <li key={suggestion.post_id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={linked || disabled}
                  onChange={() => controls.onToggle(postId, suggestion.post_id)}
                  aria-label={`「${suggestion.title}」へのリンクをリライトに含める`}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-sky-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a
                      href={suggestion.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      <span className="break-words">{suggestion.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
                    </a>
                    {linked && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        リンク済み
                      </span>
                    )}
                    <CopyButton
                      text={`${suggestion.title}\n${suggestion.url}`}
                      title="タイトルとURLをコピー（指示欄などに貼り付け用）"
                    />
                  </div>
                  {suggestion.reason && (
                    <p className="mt-0.5 text-zinc-500">{suggestion.reason}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {selectable.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-sky-200 pt-2 dark:border-sky-900">
            <label className="flex flex-wrap items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              挿入形式
              <select
                value={controls.format}
                onChange={(event) => controls.onFormatChange(event.target.value as InternalLinkFormat)}
                className="rounded-md border border-sky-300 bg-white px-1.5 py-0.5 text-xs dark:border-sky-800 dark:bg-zinc-900"
              >
                {INTERNAL_LINK_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {INTERNAL_LINK_FORMAT_LABELS[format]}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-zinc-500">
              {selectedCount > 0
                ? `チェックした${selectedCount}件のリンクを、リライト時にAIが自然な位置へ挿入します。`
                : "チェックした記事へのリンクを、リライト時にAIが自然な位置へ挿入します。"}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-2.5 text-xs dark:border-sky-900 dark:bg-sky-950/30">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-sky-800 dark:text-sky-200">
          <Link2 className="h-3.5 w-3.5" />
          内部リンク候補
        </span>
        {suggestions !== undefined && controls.indexedCount !== 0 && (
          <button
            type="button"
            onClick={() => controls.onFind(postId)}
            disabled={finding || disabled}
            title="最新の記事インデックスで候補を探し直します"
            className="flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-60 dark:hover:text-zinc-100"
          >
            <RefreshCw className={`h-3 w-3 ${finding ? "animate-spin" : ""}`} />
            再検索
          </button>
        )}
      </div>
      {body}
    </div>
  );
}
