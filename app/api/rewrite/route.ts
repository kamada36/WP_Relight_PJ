import { NextResponse, type NextRequest } from "next/server";
import { performRewrite } from "@/lib/rewrite-service";
import type { PublishStatus, RewriteRequestBody } from "@/types";

// Gemini + WordPress round-trip can exceed the platform's default function timeout.
export const maxDuration = 60;

function isPublishStatus(value: unknown): value is PublishStatus {
  return value === "draft" || value === "publish";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Partial<RewriteRequestBody> | null;
  const postId = body?.postId;
  const publishStatus = body?.publishStatus;
  const instruction = typeof body?.instruction === "string" ? body.instruction : undefined;

  if (typeof postId !== "number" || !isPublishStatus(publishStatus)) {
    return NextResponse.json(
      { success: false, error: "postId と publishStatus は必須です。" },
      { status: 400 }
    );
  }

  try {
    const result = await performRewrite(postId, publishStatus, instruction);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
