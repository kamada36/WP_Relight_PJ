import { NextResponse, type NextRequest } from "next/server";
import { getAppSettings, updateCronIntervalDays } from "@/lib/supabase";
import { CRON_INTERVAL_OPTIONS, type CronIntervalDays } from "@/types";

function isCronIntervalDays(value: unknown): value is CronIntervalDays {
  return (
    typeof value === "number" &&
    (CRON_INTERVAL_OPTIONS as readonly number[]).includes(value)
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
  const cronIntervalDays = body?.cronIntervalDays;

  if (!isCronIntervalDays(cronIntervalDays)) {
    return NextResponse.json(
      {
        success: false,
        error: `cronIntervalDays は ${CRON_INTERVAL_OPTIONS.join(", ")} のいずれかである必要があります。`,
      },
      { status: 400 }
    );
  }

  try {
    await updateCronIntervalDays(cronIntervalDays);
    return NextResponse.json({ success: true, cronIntervalDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
