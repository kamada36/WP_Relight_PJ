"use client";

import { CheckCircle2, Clock, History, RotateCcw, XCircle } from "lucide-react";
import type { RewriteLog } from "@/types";

interface HistoryPanelProps {
  logs: RewriteLog[];
  loading: boolean;
}

const STATUS_ICON = {
  success: CheckCircle2,
  failed: XCircle,
  pending: Clock,
  reverted: RotateCcw,
} as const;

const STATUS_COLOR: Record<RewriteLog["status"], string> = {
  success: "text-emerald-500",
  failed: "text-red-500",
  pending: "text-amber-500",
  reverted: "text-sky-500",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryPanel({ logs, loading }: HistoryPanelProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <History className="h-4 w-4 text-zinc-500" />
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">実行履歴</h2>
      </div>

      <div className="max-h-[560px] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
        {loading ? (
          <p className="p-4 text-sm text-zinc-500">読み込み中...</p>
        ) : logs.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">履歴はまだありません。</p>
        ) : (
          logs.map((log) => {
            const Icon = STATUS_ICON[log.status];
            return (
              <div key={log.id} className="flex items-start gap-3 p-4">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${STATUS_COLOR[log.status]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {log.post_title}
                  </p>
                  <p className="text-xs text-zinc-500">
                    #{log.post_id} ・ {formatDate(log.created_at)}
                  </p>
                  {log.status === "success" && log.summary && (
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{log.summary}</p>
                  )}
                  {log.status === "failed" && log.error_message && (
                    <p className="mt-1 text-xs text-red-500">{log.error_message}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
