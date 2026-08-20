-- リライト前の記事内容を「確定」するまで保持するテーブル。
-- 記事IDごとに1行のみ持ち、確定（finalize）または元に戻す（revert）操作で削除される。
-- 参照元: lib/supabase.ts (getPendingRewriteState / saveOriginalIfAbsent / clearPendingRewriteState)
--        types/index.ts (PendingRewriteState)
CREATE TABLE IF NOT EXISTS public.post_rewrite_state (
    post_id BIGINT PRIMARY KEY,
    original_content TEXT NOT NULL,
    original_status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- このアプリは Supabase Auth を使わず、anon キー経由で全CRUDを実行する
-- （rewrite_logs / app_settings と同じアクセスパターン）。
-- RLSを有効化しつつ、既存の動作を壊さないよう anon/authenticated に対して
-- 全操作を許可するポリシーを設定する。
ALTER TABLE public.post_rewrite_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for anon/authenticated"
    ON public.post_rewrite_state
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
