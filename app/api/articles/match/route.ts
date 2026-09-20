import { NextResponse, type NextRequest } from "next/server";
import { MAX_MATCH_BATCH, matchPosts } from "@/lib/article-index";
import { describeGeminiError } from "@/lib/gemini";

// Each source costs one WordPress read + one Gemini call; up to MAX_MATCH_BATCH run in parallel.
export const maxDuration = 300;

/** Matches each of the given posts with 0-3 articles that could be linked to naturally. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const postIds: unknown = body?.postIds;

  if (
    !Array.isArray(postIds) ||
    postIds.length === 0 ||
    postIds.length > MAX_MATCH_BATCH ||
    !postIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  ) {
    return NextResponse.json(
      { success: false, error: `postIds は1〜${MAX_MATCH_BATCH}件の記事IDの配列で指定してください。` },
      { status: 400 }
    );
  }

  try {
    const result = await matchPosts(postIds, body?.force === true);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: describeGeminiError(error) }, { status: 502 });
  }
}
