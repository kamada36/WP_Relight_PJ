-- WP Relight: rewrite_logs table
-- Run this in the Supabase SQL editor to initialize the schema.

CREATE TABLE IF NOT EXISTS rewrite_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id BIGINT NOT NULL,
    post_title TEXT NOT NULL,
    post_url TEXT,
    status VARCHAR(50) NOT NULL, -- 'pending', 'success', 'failed'
    original_content_snippet TEXT,
    rewritten_content_snippet TEXT,
    summary TEXT,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 既存環境向け: テーブルが既にある場合に列を追加する。
ALTER TABLE rewrite_logs
    ADD COLUMN IF NOT EXISTS summary TEXT;

-- 検索・絞り込み用インデックス
CREATE INDEX IF NOT EXISTS idx_rewrite_logs_post_id ON rewrite_logs(post_id);
CREATE INDEX IF NOT EXISTS idx_rewrite_logs_created_at ON rewrite_logs(created_at DESC);

-- アプリ設定（シングルトン行）。Cronの実行間隔やリライトに使うGeminiモデルなどUIから変更する値を保持する。
CREATE TABLE IF NOT EXISTS app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    cron_interval_days INTEGER NOT NULL DEFAULT 1,
    last_cron_run_at TIMESTAMP WITH TIME ZONE,
    gemini_model VARCHAR(100) NOT NULL DEFAULT 'gemini-3.6-flash',
    CONSTRAINT app_settings_singleton CHECK (id = 1)
);

-- 既存環境向け: テーブルが既にある場合に列を追加する。
ALTER TABLE app_settings
    ADD COLUMN IF NOT EXISTS gemini_model VARCHAR(100) NOT NULL DEFAULT 'gemini-3.6-flash';

INSERT INTO app_settings (id, cron_interval_days)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

-- リライト前の記事内容を「確定」するまで保持するテーブル。
-- 記事IDごとに1行のみ持ち、確定（finalize）または元に戻す（revert）操作で削除される。
CREATE TABLE IF NOT EXISTS post_rewrite_state (
    post_id BIGINT PRIMARY KEY,
    original_content TEXT NOT NULL,
    original_status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 内部リンク機能: 公開記事ごとのURL・概要・キーワードの一覧（記事インデックス）。
-- 概要が NULL の行は Gemini での生成に失敗したもので、次回の同期で再試行される。
CREATE TABLE IF NOT EXISTS article_index (
    post_id BIGINT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'publish',
    summary TEXT,
    keywords TEXT[] NOT NULL DEFAULT '{}',
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    summarized_at TIMESTAMP WITH TIME ZONE
);

-- 内部リンク機能: 記事ごとのマッチング結果。
-- suggestions は [{ "post_id": 123, "reason": "..." }] の配列（0〜3件）。
-- 行が無い = 未マッチング / 行があり空配列 = マッチング済みで該当なし。
CREATE TABLE IF NOT EXISTS article_link_suggestions (
    post_id BIGINT PRIMARY KEY,
    suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
