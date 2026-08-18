"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { GEMINI_MODEL_OPTIONS, type GeminiModelName } from "@/types";

const MODEL_LABELS: Record<GeminiModelName, string> = {
  "gemini-3.6-flash": "Flash(標準・バランス型)",
  "gemini-3.6-flash-lite": "Flash-Lite(高速・低コスト)",
};

interface GeminiModelSettingsProps {
  initialModel: string;
}

export function GeminiModelSettings({ initialModel }: GeminiModelSettingsProps) {
  const [model, setModel] = useState(initialModel);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(value: GeminiModelName) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiModel: value }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "設定の保存に失敗しました。");
      }

      setModel(value);
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
        リライトに使用するGeminiモデル
      </h2>
      <p className="mb-4 text-sm text-zinc-500">
        Flash-Liteはより高速・低コストです。Flashの方が品質が高い傾向があります(Proは費用が高いため選択肢に含めていません)。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {GEMINI_MODEL_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => handleChange(option)}
            disabled={saving}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
              model === option
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            }`}
          >
            {MODEL_LABELS[option] ?? option}
          </button>
        ))}
        {saving && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {message && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </div>
  );
}
