import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_NAME = "gemini-2.0-flash";

/** Thrown when the upstream Gemini API reports a rate limit (HTTP 429). */
export class GeminiRateLimitError extends Error {
  constructor(message = "Gemini API rate limit exceeded") {
    super(message);
    this.name = "GeminiRateLimitError";
  }
}

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
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

function buildPrompt(title: string, contentHtml: string, currentDate: string): string {
  return `あなたはプロのWebライター兼SEOスペシャリストです。
以下のHTML記事本文をリライトしてください。

# 記事タイトル
${title}

# 記事本文（HTML）
${contentHtml}

# リライトのルール（必須）
1. 文章の意味・事実関係は変更せず、HTML構造（見出しタグ<h2>, <h3>, リスト<ul>, <li>など）は保持したまま、自然な言い回し・表現の改善・読みやすさの向上を行うこと。
2. 記事本文の最先端（先頭）に、以下のHTMLフォーマットで最終更新日を挿入すること。
   <p><em>【最終更新日: ${currentDate}】</em></p>
3. HTMLタグは崩さず維持し、Markdownのコードブロック（\`\`\`html ... \`\`\`）等は含めず、直接挿入できる純粋なHTML本文のみを返却すること。
4. 記事のタイトルや「以下がリライト結果です」等の余計な解説文は一切出力に含めないこと。`;
}

export async function rewriteArticle(title: string, contentHtml: string): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL_NAME });
  const prompt = buildPrompt(title, contentHtml, formatCurrentDate());

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text.trim()) {
      throw new Error("Gemini API returned an empty response");
    }
    return stripCodeFences(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("429") || /rate limit|quota/i.test(message)) {
      throw new GeminiRateLimitError();
    }
    throw new Error(`Gemini API error: ${message}`);
  }
}
