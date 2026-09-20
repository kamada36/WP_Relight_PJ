import { NextResponse, type NextRequest } from "next/server";
import { pruneIndex, reindexPost, syncIndexPage } from "@/lib/article-index";
import { describeGeminiError } from "@/lib/gemini";

// One call summarizes at most SYNC_PER_PAGE posts in parallel; this leaves ample headroom for WordPress/Supabase I/O.
export const maxDuration = 300;

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Builds/refreshes the article index. The client drives it in steps so no single request runs long:
 *   { action: "page", page, force? }  index one page of published posts
 *   { action: "post", postId }        re-index (re-summarize) one post
 *   { action: "prune", keepIds }      drop index rows for posts a full sync no longer saw
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  try {
    switch (body?.action) {
      case "page": {
        if (!isPositiveInt(body.page)) break;
        const result = await syncIndexPage(body.page, body.force === true);
        return NextResponse.json({ success: true, ...result });
      }
      case "post": {
        if (!isPositiveInt(body.postId)) break;
        const result = await reindexPost(body.postId);
        return NextResponse.json({ success: true, ...result });
      }
      case "prune": {
        if (!Array.isArray(body.keepIds) || !body.keepIds.every(isPositiveInt)) break;
        const removed = await pruneIndex(body.keepIds);
        return NextResponse.json({ success: true, removed });
      }
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: describeGeminiError(error) }, { status: 502 });
  }

  return NextResponse.json({ success: false, error: "リクエストの形式が正しくありません。" }, { status: 400 });
}
