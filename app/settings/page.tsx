import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";
import { CronIntervalSettings } from "@/components/CronIntervalSettings";
import { GeminiModelSettings } from "@/components/GeminiModelSettings";
import { getAppSettings } from "@/lib/supabase";
import { DEFAULT_MODEL_NAME } from "@/lib/gemini";

export const dynamic = "force-dynamic";

function EnvStatus({ label, isSet }: { label: string; isSet: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2 text-sm last:border-0 dark:border-zinc-900">
      <span className="break-all text-zinc-600 dark:text-zinc-400">{label}</span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          isSet
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        }`}
      >
        {isSet ? "設定済み" : "未設定"}
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  let cronIntervalDays = 1;
  let lastCronRunAt: string | null = null;
  let geminiModel = DEFAULT_MODEL_NAME;
  let cronSettingsError: string | null = null;

  try {
    const settings = await getAppSettings();
    cronIntervalDays = settings.cronIntervalDays;
    lastCronRunAt = settings.lastCronRunAt;
    geminiModel = settings.geminiModel;
  } catch (error) {
    cronSettingsError = error instanceof Error ? error.message : "設定の取得に失敗しました。";
  }

  const envChecks = [
    { label: "WORDPRESS_URL", isSet: Boolean(process.env.WORDPRESS_URL) },
    { label: "WORDPRESS_USER", isSet: Boolean(process.env.WORDPRESS_USER) },
    { label: "WORDPRESS_APP_PASS", isSet: Boolean(process.env.WORDPRESS_APP_PASS) },
    { label: "GEMINI_API_KEY", isSet: Boolean(process.env.GEMINI_API_KEY) },
    { label: "NEXT_PUBLIC_SUPABASE_URL", isSet: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    {
      label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      isSet: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    },
    { label: "ADMIN_PASSWORD", isSet: Boolean(process.env.ADMIN_PASSWORD) },
    { label: "CRON_SECRET", isSet: Boolean(process.env.CRON_SECRET) },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          ダッシュボードに戻る
        </Link>
        <LogoutButton />
      </div>

      {cronSettingsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          現在の設定値を取得できませんでした（以下は初期値を表示しています）:{cronSettingsError}
          <br />
          Supabaseで <code className="rounded bg-red-100 px-1 py-0.5 dark:bg-red-900">sql/init.sql</code>{" "}
          を再実行して <code className="rounded bg-red-100 px-1 py-0.5 dark:bg-red-900">app_settings</code>{" "}
          テーブルの列を最新化してください。
        </div>
      )}
      <CronIntervalSettings
        initialIntervalDays={cronIntervalDays}
        initialLastRunAt={lastCronRunAt}
      />
      <GeminiModelSettings initialModel={geminiModel} />

      <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">設定</h1>
        <p className="mb-4 text-sm text-zinc-500">
          環境変数は{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-900">.env.local</code>{" "}
          で管理されています。値そのものはここには表示されません。
        </p>
        <div>
          {envChecks.map((check) => (
            <EnvStatus key={check.label} label={check.label} isSet={check.isSet} />
          ))}
        </div>
      </div>
    </div>
  );
}
