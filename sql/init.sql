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
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 検索・絞り込み用インデックス
CREATE INDEX IF NOT EXISTS idx_rewrite_logs_post_id ON rewrite_logs(post_id);
CREATE INDEX IF NOT EXISTS idx_rewrite_logs_created_at ON rewrite_logs(created_at DESC);

-- アプリ設定（シングルトン行）。Cronの実行間隔などUIから変更する値を保持する。
CREATE TABLE IF NOT EXISTS app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    cron_interval_days INTEGER NOT NULL DEFAULT 1,
    last_cron_run_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT app_settings_singleton CHECK (id = 1)
);

INSERT INTO app_settings (id, cron_interval_days)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;
