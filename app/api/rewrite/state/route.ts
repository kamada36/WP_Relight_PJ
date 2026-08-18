import { NextResponse, type NextRequest } from "next/server";
import { getPendingPostIds } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const postIds = (searchParams.get("postIds") ?? "")
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  try {
    const pendingPostIds = await getPendingPostIds(postIds);
    return NextResponse.json({ success: true, pendingPostIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
