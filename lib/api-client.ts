import { RESULT_MARKER, SUMMARY_DIVIDER, TTFB_GUARD_BYTE } from "@/lib/rewrite-stream";
import type { PublishStatus } from "@/types";

/**
 * Client-side fetch wrapper for the app's `{ success: boolean, ... }` JSON API.
 *
 * Route handlers normally return JSON even on error, but platform-level
 * failures (function timeout, crash, etc.) can short-circuit that and return
 * plain text instead. Calling `res.json()` directly on such a response
 * throws an unhandled "Unexpected token ... is not valid JSON" error, so this
 * reads the body as text first and only parses it, always surfacing a
 * catchable Error instead of crashing.
 */
export async function fetchJson<T extends { success: true }>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();

  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        res.ok
          ? "サーバーから不正な応答が返されました。"
          : text.slice(0, 200)
      );
    }
  }

  const isSuccess =
    res.ok && !!data && typeof data === "object" && (data as { success?: unknown }).success === true;

  if (!isSuccess) {
    const message =
      data && typeof data === "object" ? (data as { error?: string }).error : undefined;
    throw new Error(message || `リクエストに失敗しました(${res.status})。`);
  }

  return data as T;
}

export interface StreamRewriteResult {
  postId: number;
  updatedUrl: string;
  summary: string | null;
}

/**
 * Calls the streaming /api/rewrite endpoint and reads the rewritten article
 * body as it arrives. `onBodyUpdate` is called with the visible body text
 * accumulated so far (the leading TTFB dummy byte and the trailing
 * "===SUMMARY===" section are stripped out) so callers can render live
 * progress. Resolves with the final result once the stream closes, by which
 * point the WordPress sync has already completed server-side.
 */
export async function streamRewrite(
  postId: number,
  publishStatus: PublishStatus,
  instruction: string | undefined,
  onBodyUpdate: (visibleBody: string) => void
): Promise<StreamRewriteResult> {
  const res = await fetch("/api/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId, publishStatus, instruction }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 200);
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Not JSON; fall back to the raw text above.
    }
    throw new Error(message || `リクエストに失敗しました(${res.status})。`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let strippedDummyByte = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    let chunkText = decoder.decode(value, { stream: true });
    if (!strippedDummyByte) {
      strippedDummyByte = true;
      if (chunkText.startsWith(TTFB_GUARD_BYTE)) chunkText = chunkText.slice(1);
    }
    buffer += chunkText;

    // Cut the visible preview at whichever control marker shows up first —
    // both the model's own summary divider and (rarely, if it lands in the
    // same read as preceding deltas) the trailing result marker.
    const summaryMatch = buffer.match(SUMMARY_DIVIDER);
    const markerIndex = buffer.indexOf(RESULT_MARKER);
    const cutoffCandidates = [summaryMatch?.index, markerIndex === -1 ? undefined : markerIndex];
    const cutoff = cutoffCandidates.reduce<number | undefined>(
      (min, candidate) =>
        candidate === undefined ? min : min === undefined ? candidate : Math.min(min, candidate),
      undefined
    );
    onBodyUpdate(cutoff === undefined ? buffer : buffer.slice(0, cutoff));
  }
  buffer += decoder.decode();

  const markerIndex = buffer.indexOf(RESULT_MARKER);
  if (markerIndex === -1) {
    throw new Error("サーバーからの応答が不完全です。");
  }

  const payload = JSON.parse(buffer.slice(markerIndex + RESULT_MARKER.length)) as
    | ({ ok: true } & StreamRewriteResult)
    | { ok: false; error: string };

  if (!payload.ok) {
    throw new Error(payload.error);
  }
  return { postId: payload.postId, updatedUrl: payload.updatedUrl, summary: payload.summary };
}
