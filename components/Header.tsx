"use client";

import Link from "next/link";
import { RefreshCw, Settings, Zap } from "lucide-react";

interface HeaderProps {
  onRefresh: () => void;
  refreshing: boolean;
  onBulkShortcut: () => void;
  bulkRunning: boolean;
}

export function Header({ onRefresh, refreshing, onBulkShortcut, bulkRunning }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">WP Relight</h1>
        <p className="text-sm text-zinc-500">WordPress記事のAIリライト管理</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onBulkShortcut}
          disabled={bulkRunning}
          title="最も更新日が古い記事をリライトして下書き保存します"
          className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Zap className={`h-4 w-4 ${bulkRunning ? "animate-pulse" : ""}`} />
          最古記事を自動リライト
        </button>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          更新
        </button>
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <Settings className="h-4 w-4" />
          設定
        </Link>
      </div>
    </header>
  );
}
