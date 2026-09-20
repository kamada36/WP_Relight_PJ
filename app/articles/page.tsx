import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";
import { ArticleIndexManager } from "@/components/ArticleIndexManager";
import { listArticles } from "@/lib/article-index";
import type { ArticleListItem } from "@/types";

export const dynamic = "force-dynamic";

export default async function ArticlesPage() {
  let articles: ArticleListItem[] = [];
  let loadError: string | null = null;

  try {
    articles = await listArticles();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "記事インデックスの取得に失敗しました。";
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
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

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          記事インデックスを読み込めませんでした: {loadError}
          <br />
          Supabaseで{" "}
          <code className="rounded bg-red-100 px-1 py-0.5 dark:bg-red-900">
            supabase/migrations/20260922000000_create_article_index.sql
          </code>{" "}
          （または <code className="rounded bg-red-100 px-1 py-0.5 dark:bg-red-900">sql/init.sql</code>
          ）を実行してテーブルを作成してください。
        </div>
      )}

      <ArticleIndexManager initialArticles={articles} />
    </div>
  );
}
