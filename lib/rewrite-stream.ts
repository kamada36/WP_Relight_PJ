/**
 * Framing constants for the /api/rewrite streaming response. The server
 * (app/api/rewrite/route.ts, lib/gemini.ts) and the client
 * (lib/api-client.ts) must agree on these exactly.
 */

/** Single whitespace byte sent immediately on stream start so the platform registers TTFB before Gemini responds. */
export const TTFB_GUARD_BYTE = " ";

/** Boundary between the streamed article body and the trailing result JSON. */
export const RESULT_MARKER = "\n__REWRITE_RESULT__\n";

/** Boundary between the rewritten HTML body and the model's own change summary. */
export const SUMMARY_DIVIDER = /\n?===\s*SUMMARY\s*===\n?/i;
