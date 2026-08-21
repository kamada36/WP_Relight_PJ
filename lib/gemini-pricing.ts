import { GEMINI_MODEL_OPTIONS, type GeminiModelName } from "@/types";

/**
 * Google's published Gemini API pricing (USD per 1M tokens), introductory rate
 * through 2026-12-31. See https://ai.google.dev/gemini-api/docs/pricing.
 * gemini-3.6-flash-lite has no separately published rate yet, so this reuses
 * the closest published Flash-Lite tier (gemini-3.5-flash-lite) as a stand-in.
 */
const PRICING_USD_PER_MILLION_TOKENS: Record<GeminiModelName, { input: number; output: number }> = {
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash-lite": { input: 0.3, output: 2.5 },
};

/** Fixed display-only USD→JPY rate. Not a live exchange rate — adjust here if it drifts far off. */
const USD_TO_JPY = 155;

/**
 * There's no client-side Gemini tokenizer, so token counts are approximated
 * from character counts. Gemini's tokenizer averages roughly 2 characters per
 * token for this app's mixed Japanese-text/HTML-markup content — this is an
 * estimate for budgeting purposes, not the exact amount that will be billed.
 */
const CHARS_PER_TOKEN = 2;

/** Length of the static Japanese instruction text in buildPrompt() (lib/gemini.ts), counted once per call. */
const PROMPT_TEMPLATE_CHARS = 650;

/** Rough allowance for the auto-generated 1-2 sentence change summary appended after the rewritten body. */
const SUMMARY_CHARS = 120;

export interface RewriteCostEstimate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costJpy: number;
}

function resolvePricing(model: string) {
  return (
    PRICING_USD_PER_MILLION_TOKENS[model as GeminiModelName] ??
    PRICING_USD_PER_MILLION_TOKENS[GEMINI_MODEL_OPTIONS[0]]
  );
}

/**
 * Estimates the Gemini API cost of rewriting one article, from the article's
 * (title + HTML content) character count and any per-article instruction text.
 * Output length is assumed to be roughly the same as the input article, since
 * the rewrite rules require preserving structure and meaning.
 */
export function estimateRewriteCost(
  articleCharCount: number,
  model: string,
  instructionCharCount = 0
): RewriteCostEstimate {
  const pricing = resolvePricing(model);
  const inputChars = articleCharCount + instructionCharCount + PROMPT_TEMPLATE_CHARS;
  const outputChars = articleCharCount + SUMMARY_CHARS;

  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(outputChars / CHARS_PER_TOKEN);

  const costUsd =
    (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

  return { inputTokens, outputTokens, costUsd, costJpy: costUsd * USD_TO_JPY };
}

export function formatJpy(amountJpy: number): string {
  return `¥${amountJpy < 1 ? amountJpy.toFixed(2) : amountJpy.toFixed(1)}`;
}
