import { NextResponse, type NextRequest } from "next/server";
import { getOldestPost } from "@/lib/wordpress";
import { performRewrite } from "@/lib/rewrite-service";
import { verifyCronSecret } from "@/lib/auth";

async function handle(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const querySecret = request.nextUrl.searchParams.get("secret");

  if (!verifyCronSecret(bearerToken ?? querySecret)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const oldestPost = await getOldestPost();
    if (!oldestPost) {
      return NextResponse.json({ success: true, message: "対象記事がありません。" });
    }

    const result = await performRewrite(oldestPost.id, "draft");
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
