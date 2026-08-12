import { NextResponse, type NextRequest } from "next/server";
import { getOldestPost } from "@/lib/wordpress";
import { performRewrite } from "@/lib/rewrite-service";
import { verifyCronSecret } from "@/lib/auth";
import { getAppSettings, markCronRun } from "@/lib/supabase";

// Gemini + WordPress round-trip can exceed the platform's default function timeout.
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

async function handle(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const querySecret = request.nextUrl.searchParams.get("secret");

  if (!verifyCronSecret(bearerToken ?? querySecret)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Vercel invokes this endpoint on a fixed schedule (vercel.json), but the
    // actual rewrite cadence is user-configurable from the Settings page, so
    // skip here if the configured interval hasn't elapsed yet.
    const settings = await getAppSettings();
    if (settings.lastCronRunAt) {
      const intervalMs = settings.cronIntervalDays * DAY_MS;
      const elapsedMs = Date.now() - new Date(settings.lastCronRunAt).getTime();
      if (elapsedMs < intervalMs) {
        const remainingHours = Math.ceil((intervalMs - elapsedMs) / (60 * 60 * 1000));
        return NextResponse.json({
          success: true,
          skipped: true,
          message: `設定された間隔(${settings.cronIntervalDays}日)にまだ達していないためスキップしました。次回実行まで約${remainingHours}時間です。`,
        });
      }
    }

    const oldestPost = await getOldestPost();
    if (!oldestPost) {
      await markCronRun();
      return NextResponse.json({ success: true, message: "対象記事がありません。" });
    }

    const result = await performRewrite(oldestPost.id, "draft");
    await markCronRun();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
