import { NextResponse, type NextRequest } from "next/server";
import { getPosts } from "@/lib/wordpress";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const perPage = Number(searchParams.get("per_page") ?? "10") || 10;
  const search = searchParams.get("search") ?? "";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";

  try {
    const { posts, total, totalPages } = await getPosts(page, perPage, search, order);
    return NextResponse.json({ success: true, posts, total, totalPages, page });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
