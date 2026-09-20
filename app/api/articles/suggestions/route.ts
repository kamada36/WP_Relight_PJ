import { NextResponse, type NextRequest } from "next/server";
import { getSuggestionsForPosts } from "@/lib/article-index";

export const dynamic = "force-dynamic";

const MAX_IDS = 50;

/** Stored link suggestions for the posts currently shown on the dashboard (?postIds=1,2,3). */
export async function GET(request: NextRequest) {
  const postIds = (request.nextUrl.searchParams.get("postIds") ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, MAX_IDS);

  try {
    const { indexedCount, results } = await getSuggestionsForPosts(postIds);
    return NextResponse.json({ success: true, indexedCount, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
