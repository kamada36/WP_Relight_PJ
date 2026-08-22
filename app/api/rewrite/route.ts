import { type NextRequest } from "next/server";
import { performRewrite } from "@/lib/rewrite-service";
import { RESULT_MARKER, TTFB_GUARD_BYTE } from "@/lib/rewrite-stream";
import type { PublishStatus, RewriteRequestBody } from "@/types";

// Long rewrites (large articles + Gemini auto-continuation + WordPress sync)
// can run well past Vercel's default function timeout. Keep this comfortably
// above lib/gemini's SOFT_DEADLINE_MS (280s) plus WordPress/Supabase I/O.
export const maxDuration = 300;

function isPublishStatus(value: unknown): value is PublishStatus {
  return value === "draft" || value === "publish";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Partial<RewriteRequestBody> | null;
  const postId = body?.postId;
  const publishStatus = body?.publishStatus;
  const instruction = typeof body?.instruction === "string" ? body.instruction : undefined;

  if (typeof postId !== "number" || !isPublishStatus(publishStatus)) {
    return new Response(
      JSON.stringify({ success: false, error: "postId と publishStatus は必須です。" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Flush a dummy byte immediately so the platform sees a response has
      // started before the (potentially slow) Gemini call returns anything,
      // avoiding a TTFB-triggered connection drop.
      controller.enqueue(encoder.encode(TTFB_GUARD_BYTE));

      try {
        // performRewrite awaits the WordPress update and the Supabase log
        // internally, so by the time it resolves the sync is already done —
        // nothing runs after controller.close() below.
        const result = await performRewrite(postId, publishStatus, instruction, (delta) => {
          controller.enqueue(encoder.encode(delta));
        });

        controller.enqueue(
          encoder.encode(`${RESULT_MARKER}${JSON.stringify({ ok: true, ...result })}`)
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
        controller.enqueue(
          encoder.encode(`${RESULT_MARKER}${JSON.stringify({ ok: false, error: message })}`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
