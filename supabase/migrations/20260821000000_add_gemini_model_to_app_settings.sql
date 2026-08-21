-- app_settings.gemini_model が sql/init.sql には追加されていたが、
-- 対応するmigrationファイルが漏れていたため追加する（0883d733 の抜け漏れ）。
-- この列が存在しないと getAppSettings() のクエリごと失敗し、設定画面の
-- Cron間隔設定・Geminiモデル選択欄が両方とも表示されなくなる。
-- 参照元: lib/supabase.ts (getAppSettings / updateGeminiModel)
--        types/index.ts (AppSettings.geminiModel)
ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS gemini_model VARCHAR(100) NOT NULL DEFAULT 'gemini-3.6-flash';
