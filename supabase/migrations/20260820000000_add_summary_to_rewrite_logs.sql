-- リライト履歴に変更概要（ざっくりとした説明）を保持する列を追加する。
-- 参照元: lib/gemini.ts (rewriteArticle の summary)
--        lib/rewrite-service.ts (performRewrite)
--        types/index.ts (RewriteLog.summary)
ALTER TABLE public.rewrite_logs
    ADD COLUMN IF NOT EXISTS summary TEXT;
