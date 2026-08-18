import { GoogleGenerativeAI } from "@google/generative-ai";

export const DEFAULT_MODEL_NAME = "gemini-3.6-flash";

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

function buildPrompt(
  title: string,
  contentHtml: string,
  currentDate: string,
  instruction?: string
): string {
  const instructionSection = instruction?.trim()
    ? `\n# この記事固有の追加指示（最優先で反映すること）\n${instruction.trim()}\n`
    : "";

  return `あなたはプロのWebライター兼SEOスペシャリストです。
以下のHTML記事本文をリライトしてください。

# 記事タイトル
${title}

# 記事本文（HTML）
${contentHtml}
${instructionSection}
# リライトのルール（必須）
1. 文章の意味・事実関係は変更せず、HTML構造（見出しタグ<h2>, <h3>, リスト<ul>, <li>など）は保持したまま、自然な言い回し・表現の改善・読みやすさの向上を行うこと。
2. 記事本文の最先端（先頭）に、以下のHTMLフォーマットで最終更新日を挿入すること。
   <p><em>【最終更新日: ${currentDate}】</em></p>
3. HTMLタグは崩さず維持し、Markdownのコードブロック（\`\`\`html ... \`\`\`）等は含めず、直接挿入できる純粋なHTML本文のみを返却すること。
4. 記事のタイトルや「以下がリライト結果です」等の余計な解説文は一切出力に含めないこと。${
    instruction?.trim() ? "\n5. 上記の「この記事固有の追加指示」がある場合は、ルール1〜4と矛盾しない範囲で必ず反映すること。" : ""
  }`;
}

export async function rewriteArticle(
  title: string,
  contentHtml: string,
  instruction?: string,
  modelOverride?: string
): Promise<string> {
  const client = getClient();
  const modelName = getModelName(modelOverride);
  const model = client.getGenerativeModel({ model: modelName });
  const prompt = buildPrompt(title, contentHtml, formatCurrentDate(), instruction);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text.trim()) {
      throw new Error("Gemini API returned an empty response");
    }
    return stripCodeFences(text);
  } catch (error) {
    if (error instanceof GeminiAuthError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("429") || /rate limit|quota/i.test(message)) {
      throw new GeminiRateLimitError();
    }
    if (message.includes("API key not valid") || message.includes("API_KEY_INVALID")) {
      console.error(
        "[gemini] Gemini API rejected GEMINI_API_KEY as invalid. Verify the key in .env.local is a real, active key (not the placeholder from .env.example)."
      );
      throw new GeminiAuthError("Gemini API key is invalid. Check GEMINI_API_KEY in .env.local.");
    }
    if (message.includes("404") && /model/i.test(message)) {
      console.error(
        `[gemini] Model "${modelName}" was rejected by the API. Set GEMINI_MODEL_NAME in .env.local to a currently supported model.`
      );
      throw new Error(
        `Gemini API error: model "${modelName}" is not available. Set GEMINI_MODEL_NAME to a supported model.`
      );
    }
    throw new Error(`Gemini API error: ${message}`);
  }
}
