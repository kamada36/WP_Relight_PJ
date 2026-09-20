import { GoogleGenerativeAI, FinishReason } from "@google/generative-ai";
import { SUMMARY_DIVIDER } from "@/lib/rewrite-stream";
import { buildInternalLinkPromptSection } from "@/lib/internal-links";
import type { InternalLinkFormat, InternalLinkRequest } from "@/types";

export const DEFAULT_MODEL_NAME = "gemini-3.6-flash";

/** Safety budget for the whole Gemini generation phase of a rewrite (ms). */
export const SOFT_DEADLINE_MS = 280_000;
/** Stop attempting further continuations once less than this remains before the deadline (ms). */
const DEADLINE_MARGIN_MS = 12_000;
/** Cap on auto-continuation calls when Gemini stops early with finishReason MAX_TOKENS. */
const MAX_CONTINUATIONS = 2;
/** How much trailing context to hand back to Gemini when asking it to continue. */
const CONTINUATION_TAIL_CHARS = 1500;

/** Thrown when the upstream Gemini API reports a rate limit (HTTP 429). */
export class GeminiRateLimitError extends Error {
  constructor(message = "Gemini API rate limit exceeded") {
    super(message);
    this.name = "GeminiRateLimitError";
  }
}

/** Thrown when the Gemini API key is missing or rejected as invalid. */
export class GeminiAuthError extends Error {
  constructor(message = "Gemini API key is missing or invalid") {
    super(message);
    this.name = "GeminiAuthError";
  }
}

function getModelName(modelOverride?: string): string {
  const override = modelOverride?.trim();
  if (override) return override;
  const modelName = process.env.GEMINI_MODEL_NAME?.trim();
  return modelName || DEFAULT_MODEL_NAME;
}

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "[gemini] GEMINI_API_KEY is not set. Add a valid key to .env.local (see .env.example)."
    );
    throw new GeminiAuthError("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenerativeAI(apiKey);
}

function formatCurrentDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}年${m}月${d}日`;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/** Splits the model output into the rewritten HTML body and the trailing change summary section. */
function splitContentAndSummary(text: string): { content: string; summary: string | null } {
  const match = text.match(SUMMARY_DIVIDER);
  if (!match || match.index === undefined) {
    return { content: text.trim(), summary: null };
  }
  const content = text.slice(0, match.index).trim();
  const summary = text.slice(match.index + match[0].length).trim() || null;
  return { content, summary };
}

function buildPrompt(
  title: string,
  contentHtml: string,
  currentDate: string,
  instruction?: string,
  internalLinks: InternalLinkRequest[] = [],
  internalLinkFormat: InternalLinkFormat = "blogcard"
): string {
  const instructionSection = instruction?.trim()
    ? `\n# この記事固有の追加指示（最優先で反映すること）\n${instruction.trim()}\n`
    : "";
  const internalLinkSection = buildInternalLinkPromptSection(internalLinks, internalLinkFormat);

  return `あなたはプロのWebライター兼SEOスペシャリストです。
以下のHTML記事本文をリライトしてください。

# 記事タイトル
${title}

# 記事本文（HTML）
${contentHtml}
${instructionSection}${internalLinkSection}
# リライトのルール（必須）
1. 文章の意味・事実関係は変更せず、HTML構造（見出しタグ<h2>, <h3>, リスト<ul>, <li>など）は保持したまま、自然な言い回し・表現の改善・読みやすさの向上を行うこと。
2. 記事本文の最先端（先頭）に、以下のHTMLフォーマットで最終更新日を挿入すること。
   <p><em>【最終更新日: ${currentDate}】</em></p>
3. HTMLタグは崩さず維持し、Markdownのコードブロック（\`\`\`html ... \`\`\`）等は含めず、直接挿入できる純粋なHTML本文のみを返却すること。
4. 記事のタイトルや「以下がリライト結果です」等の余計な解説文は一切出力に含めないこと。
5. HTML本文の出力が終わったら、必ず単独の行に "===SUMMARY===" とだけ書き、その次の行から今回のリライトでどのような変更を加えたかの概要を日本語1〜2文で書くこと。変更前後の具体的な文言の引用や詳細な差分は書かず、「専門用語をかみ砕いて説明を追加した」「見出しの言い回しを整理した」のようなざっくりとした説明にすること。${
    instruction?.trim() ? "\n6. 上記の「この記事固有の追加指示」がある場合は、ルール1〜4と矛盾しない範囲で必ず反映すること。" : ""
  }${
    internalLinks.length > 0
      ? `\n${instruction?.trim() ? "7" : "6"}. 上記の「挿入する内部リンク」は必ず全件挿入すること。リンクの案内文や<p>タグの追加は、ルール1（HTML構造の保持）の例外として認める。`
      : ""
  }`;
}

/** Asks the model to resume HTML output that was cut off mid-article by a MAX_TOKENS finish. */
function buildContinuationPrompt(tailText: string): string {
  return `直前のHTML本文生成が文字数上限で途中に打ち切られました。以下は出力済みテキストの末尾です。
--- 末尾ここから ---
${tailText}
--- 末尾ここまで ---
この続きから自然につながるように、HTML本文の続きだけを出力してください。上記末尾の文言を繰り返さないこと。挨拶や前置きは不要です。
本文が完結したら、必ず単独の行に "===SUMMARY===" とだけ書き、その次の行から今回のリライトでどのような変更を加えたかの概要を日本語1〜2文で書くこと。`;
}

export interface RewriteArticleResult {
  content: string;
  /** Rough, non-detailed description of what changed, in Japanese. Null if the model omitted it. */
  summary: string | null;
}

export interface RewriteArticleOptions {
  instruction?: string;
  modelOverride?: string;
  /** Internal links Gemini must weave into the body (see lib/internal-links). */
  internalLinks?: InternalLinkRequest[];
  internalLinkFormat?: InternalLinkFormat;
  /** Called with each raw text delta as it streams in from Gemini, before any post-processing. */
  onDelta?: (text: string) => void;
}

/**
 * Turns whatever the Gemini SDK threw into this module's typed errors (or a
 * descriptive Error), so every caller reports rate limits / bad keys / bad
 * model names the same way.
 */
function toGeminiError(error: unknown, modelName: string): Error {
  if (error instanceof GeminiAuthError) return error;

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("429") || /rate limit|quota/i.test(message)) {
    return new GeminiRateLimitError();
  }
  if (message.includes("API key not valid") || message.includes("API_KEY_INVALID")) {
    console.error(
      "[gemini] Gemini API rejected GEMINI_API_KEY as invalid. Verify the key in .env.local is a real, active key (not the placeholder from .env.example)."
    );
    return new GeminiAuthError("Gemini API key is invalid. Check GEMINI_API_KEY in .env.local.");
  }
  if (message.includes("404") && /model/i.test(message)) {
    console.error(
      `[gemini] Model "${modelName}" was rejected by the API. Set GEMINI_MODEL_NAME in .env.local to a currently supported model.`
    );
    return new Error(
      `Gemini API error: model "${modelName}" is not available. Set GEMINI_MODEL_NAME to a supported model.`
    );
  }
  return new Error(`Gemini API error: ${message}`);
}

/**
 * One-shot structured generation: asks Gemini for a JSON response and parses it.
 * Used for article summaries and internal-link matching, where the answer is
 * small and must be machine-readable (unlike the streamed HTML rewrite).
 */
export async function generateJson<T>(prompt: string, modelOverride?: string): Promise<T> {
  const client = getClient();
  const modelName = getModelName(modelOverride);
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
  });

  try {
    const result = await model.generateContent(prompt);
    const text = stripCodeFences(result.response.text());
    if (!text) throw new Error("Gemini API returned an empty response");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Gemini API returned malformed JSON");
    }
  } catch (error) {
    throw toGeminiError(error, modelName);
  }
}

export async function rewriteArticle(
  title: string,
  contentHtml: string,
  options: RewriteArticleOptions = {}
): Promise<RewriteArticleResult> {
  const { instruction, modelOverride, internalLinks, internalLinkFormat, onDelta } = options;
  const client = getClient();
  const modelName = getModelName(modelOverride);
  const model = client.getGenerativeModel({ model: modelName });

  const startedAt = Date.now();
  let prompt = buildPrompt(
    title,
    contentHtml,
    formatCurrentDate(),
    instruction,
    internalLinks,
    internalLinkFormat
  );
  let raw = "";
  let continuations = 0;

  try {
    for (;;) {
      const streamResult = await model.generateContentStream(prompt);
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) {
          raw += text;
          onDelta?.(text);
        }
      }
      const finalResponse = await streamResult.response;
      const finishReason = finalResponse.candidates?.[0]?.finishReason;

      const remainingMs = SOFT_DEADLINE_MS - (Date.now() - startedAt);
      const canContinue =
        finishReason === FinishReason.MAX_TOKENS &&
        continuations < MAX_CONTINUATIONS &&
        remainingMs > DEADLINE_MARGIN_MS;

      if (!canContinue) break;

      continuations += 1;
      prompt = buildContinuationPrompt(raw.slice(-CONTINUATION_TAIL_CHARS));
    }

    if (!raw.trim()) {
      throw new Error("Gemini API returned an empty response");
    }
    return splitContentAndSummary(stripCodeFences(raw));
  } catch (error) {
    throw toGeminiError(error, modelName);
  }
}

/** User-facing (Japanese) description of an error thrown by this module, for toasts / logs. */
export function describeGeminiError(error: unknown): string {
  if (error instanceof GeminiRateLimitError) {
    return "Gemini APIのレート制限に達しました。しばらく待ってから再試行してください。";
  }
  if (error instanceof GeminiAuthError) {
    return "Gemini APIキーが未設定または無効です。.env.localのGEMINI_API_KEYを確認してください。";
  }
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
