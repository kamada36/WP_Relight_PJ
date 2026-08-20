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
