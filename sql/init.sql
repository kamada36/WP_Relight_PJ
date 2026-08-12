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
