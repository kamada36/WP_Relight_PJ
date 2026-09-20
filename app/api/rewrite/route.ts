import { type NextRequest } from "next/server";
import { performRewrite } from "@/lib/rewrite-service";
import { RESULT_MARKER, TTFB_GUARD_BYTE } from "@/lib/rewrite-stream";
import { MAX_INTERNAL_LINKS_PER_REWRITE, normalizeUrl } from "@/lib/internal-links";
import {
  INTERNAL_LINK_FORMATS,
  type InternalLinkFormat,
  type InternalLinkRequest,
  type PublishStatus,
  type RewriteRequestBody,
} from "@/types";

// Long rewrites (large articles + Gemini auto-continuation + WordPress sync)
// can run well past Vercel's default function timeout. Keep this comfortably
// above lib/gemini's SOFT_DEADLINE_MS (280s) plus WordPress/Supabase I/O.
export const maxDuration = 300;

function isPublishStatus(value: unknown): value is PublishStatus {
  return value === "draft" || value === "publish";
}

function isInternalLinkFormat(value: unknown): value is InternalLinkFormat {
  return (
    typeof value === "string" && (INTERNAL_LINK_FORMATS as readonly string[]).includes(value)
  );
}

/** Returns the cleaned link list, or null if the payload is malformed (never trust client input into the prompt). */
function parseInternalLinks(value: unknown): InternalLinkRequest[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_INTERNAL_LINKS_PER_REWRITE) return null;

  const links: InternalLinkRequest[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { url, title, reason } = item as Record<string, unknown>;
    if (typeof url !== "string" || url.length > 500 || normalizeUrl(url) === null) return null;
    if (typeof title !== "string" || title.length > 300) return null;
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) return null;
    links.push({ url: url.trim(), title, ...(reason ? { reason } : {}) });
  }
  return links;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Partial<RewriteRequestBody> | null;
  const postId = body?.postId;
  const publishStatus = body?.publishStatus;
  const instruction = typeof body?.instruction === "string" ? body.instruction : undefined;
  const internalLinks = parseInternalLinks(body?.internalLinks);
  const internalLinkFormat = isInternalLinkFormat(body?.internalLinkFormat)
    ? body.internalLinkFormat
    : undefined;

  if (typeof postId !== "number" || !isPublishStatus(publishStatus)) {
    return new Response(
      JSON.stringify({ success: false, error: "postId と publishStatus は必須です。" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (internalLinks === null) {
    return new Response(
      JSON.stringify({ success: false, error: "internalLinks の形式が正しくありません。" }),
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
        const result = await performRewrite(postId, publishStatus, {
          instruction,
          internalLinks,
          internalLinkFormat,
          onDelta: (delta) => {
            controller.enqueue(encoder.encode(delta));
          },
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
