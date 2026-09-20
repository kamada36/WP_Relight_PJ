import { NextResponse } from "next/server";
import { listArticles } from "@/lib/article-index";

export const dynamic = "force-dynamic";

/** All indexed articles (URL / summary / keywords) with their stored link suggestions. */
export async function GET() {
  try {
    const articles = await listArticles();
    return NextResponse.json({ success: true, articles });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
