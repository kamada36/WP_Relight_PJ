import { NextResponse, type NextRequest } from "next/server";
import { getAppSettings, updateCronIntervalDays, updateGeminiModel } from "@/lib/supabase";
import {
  CRON_INTERVAL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  type CronIntervalDays,
  type GeminiModelName,
} from "@/types";

function isCronIntervalDays(value: unknown): value is CronIntervalDays {
  return (
    typeof value === "number" &&
    (CRON_INTERVAL_OPTIONS as readonly number[]).includes(value)
  );
}

function isGeminiModelName(value: unknown): value is GeminiModelName {
  return (
    typeof value === "string" &&
    (GEMINI_MODEL_OPTIONS as readonly string[]).includes(value)
  );
}

export async function GET() {
  try {
    const settings = await getAppSettings();
    return NextResponse.json({ success: true, ...settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const hasCronIntervalDays = body?.cronIntervalDays !== undefined;
  const hasGeminiModel = body?.geminiModel !== undefined;

  if (!hasCronIntervalDays && !hasGeminiModel) {
    return NextResponse.json(
      { success: false, error: "更新する項目がありません。" },
      { status: 400 }
    );
  }

  if (hasCronIntervalDays && !isCronIntervalDays(body.cronIntervalDays)) {
    return NextResponse.json(
      {
        success: false,
        error: `cronIntervalDays は ${CRON_INTERVAL_OPTIONS.join(", ")} のいずれかである必要があります。`,
      },
      { status: 400 }
    );
  }

  if (hasGeminiModel && !isGeminiModelName(body.geminiModel)) {
    return NextResponse.json(
      {
        success: false,
        error: `geminiModel は ${GEMINI_MODEL_OPTIONS.join(", ")} のいずれかである必要があります。`,
      },
      { status: 400 }
    );
  }

  try {
    if (hasCronIntervalDays) await updateCronIntervalDays(body.cronIntervalDays);
    if (hasGeminiModel) await updateGeminiModel(body.geminiModel);
    return NextResponse.json({
      success: true,
      ...(hasCronIntervalDays ? { cronIntervalDays: body.cronIntervalDays } : {}),
      ...(hasGeminiModel ? { geminiModel: body.geminiModel } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
