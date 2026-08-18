import { NextResponse, type NextRequest } from "next/server";
import { clearPendingRewriteState } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { postId?: unknown } | null;
  const postId = body?.postId;

  if (typeof postId !== "number") {
    return NextResponse.json({ success: false, error: "postId は必須です。" }, { status: 400 });
  }

  try {
    await clearPendingRewriteState(postId);
    return NextResponse.json({ success: true, postId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
