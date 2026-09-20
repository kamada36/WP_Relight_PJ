-- 内部リンク機能用のテーブル。
--   article_index            : 公開記事ごとのURL・概要・キーワードの一覧（記事インデックス）
--   article_link_suggestions : 記事ごとの「自然な文脈で紹介できる関連記事」のマッチング結果
-- 参照元: lib/supabase.ts (article_index / article_link_suggestions 関連の関数)
--        lib/article-index.ts
--        types/index.ts (ArticleIndexEntry / StoredLinkSuggestion)
-- ※ app_settings は変更しない（列追加漏れで設定画面が壊れた過去事例があるため）。

CREATE TABLE IF NOT EXISTS public.article_index (
    post_id BIGINT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'publish',
    -- 概要。Gemini失敗時は NULL のままにして、次回の同期で再試行する。
    summary TEXT,
    keywords TEXT[] NOT NULL DEFAULT '{}',
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    summarized_at TIMESTAMP WITH TIME ZONE
);

-- 各記事に対するマッチング結果。suggestions は [{ "post_id": 123, "reason": "..." }] の配列（0〜3件）。
-- タイトル・URLは表示時に article_index から引くため、ここには持たない。
-- 行が無い = 未マッチング / 行があり空配列 = マッチング済みで該当なし。
CREATE TABLE IF NOT EXISTS public.article_link_suggestions (
    post_id BIGINT PRIMARY KEY,
    suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- このアプリは Supabase Auth を使わず、anon キー経由で全CRUDを実行する
-- （rewrite_logs / app_settings / post_rewrite_state と同じアクセスパターン）。
ALTER TABLE public.article_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_link_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for anon/authenticated"
    ON public.article_index
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow all access for anon/authenticated"
    ON public.article_link_suggestions
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
