import { NextResponse, type NextRequest } from "next/server";
import { getRewriteLogs } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "20") || 20;

  try {
    const logs = await getRewriteLogs(limit);
    return NextResponse.json({ success: true, logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
