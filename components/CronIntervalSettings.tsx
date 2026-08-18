"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CRON_INTERVAL_OPTIONS, type CronIntervalDays } from "@/types";

const OPTION_LABELS: Record<CronIntervalDays, string> = {
  1: "毎日",
  2: "2日おき",
  3: "3日おき",
  7: "週1回(7日おき)",
};

interface CronIntervalSettingsProps {
  initialIntervalDays: number;
  initialLastRunAt: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "まだ実行されていません";
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

export function CronIntervalSettings({
  initialIntervalDays,
  initialLastRunAt,
}: CronIntervalSettingsProps) {
  const [intervalDays, setIntervalDays] = useState<number>(initialIntervalDays);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(value: CronIntervalDays) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronIntervalDays: value }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "設定の保存に失敗しました。");
      }

      setIntervalDays(value);
      setMessage("保存しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定の保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        自動リライトの間隔
      </h2>
      <p className="mb-4 text-sm text-zinc-500">
        Vercel Cron自体は1日1回呼び出されますが(vercel.jsonで設定)、実際にリライトを実行する間隔はここから調整できます。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {CRON_INTERVAL_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => handleChange(option)}
            disabled={saving}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
              intervalDays === option
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            }`}
          >
            {OPTION_LABELS[option]}
          </button>
        ))}
        {saving && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {message && (
        <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <p className="mt-4 text-xs text-zinc-500">
        前回の自動実行: {formatDate(initialLastRunAt)}
      </p>
    </div>
  );
}
