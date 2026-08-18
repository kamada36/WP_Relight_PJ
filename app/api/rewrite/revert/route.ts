import { NextResponse, type NextRequest } from "next/server";
import { updatePost } from "@/lib/wordpress";
import { clearPendingRewriteState, getPendingRewriteState, logRewriteResult } from "@/lib/supabase";
import type { WordPressPostStatus } from "@/types";

// WordPress round-trip can exceed the platform's default function timeout.
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { postId?: unknown } | null;
  const postId = body?.postId;

  if (typeof postId !== "number") {
    return NextResponse.json({ success: false, error: "postId は必須です。" }, { status: 400 });
  }

  try {
    const state = await getPendingRewriteState(postId);
    if (!state) {
      return NextResponse.json(
        { success: false, error: "元に戻せるリライト内容が見つかりませんでした。" },
        { status: 404 }
      );
    }

    const updated = await updatePost(postId, {
      content: state.original_content,
      status: state.original_status as WordPressPostStatus,
    });
    await clearPendingRewriteState(postId);

    await logRewriteResult({
      post_id: updated.id,
      post_title: updated.title,
      post_url: updated.link,
      status: "reverted",
    });

    return NextResponse.json({ success: true, postId: updated.id, updatedUrl: updated.link });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
