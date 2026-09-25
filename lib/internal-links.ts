import type { InternalLinkFormat, InternalLinkRequest } from "@/types";

/**
 * Shared (client + server) helpers for the internal-link feature: URL comparison,
 * "is this article already linked?" detection, and the prompt section that asks
 * Gemini to insert the chosen links during a rewrite.
 */

export const MAX_INTERNAL_LINKS_PER_REWRITE = 5;

export const INTERNAL_LINK_FORMAT_LABELS: Record<InternalLinkFormat, string> = {
  blogcard: "ブログカード（「あわせて読みたい」ラベル付き）",
  text: "テキストリンク",
};

/**
 * Frame the blog-card URL sits inside, with the "あわせて読みたい" callout built into the
 * border itself (the classic <fieldset>/<legend> border-interrupt look) rather than floating
 * above the card as a separate chip. This is deliberately background-color-agnostic: because
 * the legend sits directly in the gap the browser cuts into the border, nothing needs to be
 * painted behind the label text, so it reads correctly no matter what the surrounding page's
 * actual background color is (which this app has no way to know). Fixed HTML (not left to
 * Gemini to design) so every inserted card looks the same regardless of theme. Warm
 * cream/coffee-brown palette to read as a café menu-style frame.
 */
const BLOGCARD_FRAME_OPEN_HTML =
  '<fieldset style="margin:0 0 1.5em;padding:20px 20px 16px;border:1.5px solid #a97c50;border-radius:10px;background:#fdf5ea;"><legend style="margin-left:10px;padding:0 10px;font-size:14px;font-weight:600;letter-spacing:.05em;color:#5c3a21;">☕ あわせて読みたい</legend>';
const BLOGCARD_FRAME_CLOSE_HTML = "</fieldset>";

/**
 * Reduces a URL to a comparable key: lowercase host without "www.", no scheme,
 * query, hash, trailing slash or trailing "/embed" (WordPress's oEmbed URL for the same post).
 * Returns null for anything that isn't an http(s) URL.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  let path = decodeURIComponentSafe(url.pathname).replace(/\/+$/, "");
  path = path.replace(/\/embed$/, "");
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Every http(s) URL that appears in the HTML — in href/src attributes and as bare text (blog-card style) alike.
 * URLs may contain raw Japanese slugs, but CJK punctuation / full-width forms (、。」 etc.) end a URL so a bare
 * URL written straight before Japanese text doesn't swallow it.
 */
export function extractUrls(html: string): string[] {
  const matches = html.match(/https?:\/\/[^\s"'<>)\]\u3000-\u303F\uFF00-\uFFEF]+/gi) ?? [];
  return matches.map((match) => match.replace(/[.,;:!?、。]+$/, ""));
}

/** Set of normalized URLs referenced anywhere in the HTML. */
export function collectLinkedUrls(html: string): Set<string> {
  const linked = new Set<string>();
  for (const url of extractUrls(html)) {
    const key = normalizeUrl(url);
    if (key) linked.add(key);
  }
  return linked;
}

/** True when `targetUrl` is already linked (as <a>, embed or bare URL) somewhere in the HTML. */
export function isUrlLinkedInHtml(html: string, targetUrl: string): boolean {
  const key = normalizeUrl(targetUrl);
  return key !== null && collectLinkedUrls(html).has(key);
}

/** Of the requested links, the ones whose URL doesn't appear in the (rewritten) HTML. */
export function findMissingLinks(html: string, links: InternalLinkRequest[]): InternalLinkRequest[] {
  const linked = collectLinkedUrls(html);
  return links.filter((link) => {
    const key = normalizeUrl(link.url);
    return key === null || !linked.has(key);
  });
}

function formatRules(format: InternalLinkFormat): string {
  if (format === "text") {
    return `- 各リンクは、案内文の一部として自然に組み込んだテキストリンク（<a href="URL">語句または記事タイトル</a>）で挿入する。
- 例: <p>〇〇の詳しい手順は、<a href="URL">記事タイトル</a>で解説しています。</p>`;
  }
  return `- 各リンクは「案内文の段落」→「URLを囲む枠」の順で挿入する。案内文は文脈に合わせて自然に書く（例: 「〇〇の詳細については、こちらの記事で解説しています。」）。
- 案内文の直後に、以下の開始タグを一字一句変えずにそのまま挿入する（文言・スタイル・タグを変更・省略しない。左上に「あわせて読みたい」というラベルが枠線に一体化して表示される）:
  ${BLOGCARD_FRAME_OPEN_HTML}
- 開始タグの直後に空行を1行入れ、その次の行にURLだけを単独で書く（前後を空行で区切り、<a>タグや<p>タグで囲まない。他の文字も置かない。WordPressがこのURLをカード表示に変換するため）。
- URLの直後に空行を1行入れ、以下の終了タグを一字一句変えずにそのまま挿入して枠を閉じる:
  ${BLOGCARD_FRAME_CLOSE_HTML}
- 例:
  <p>〇〇の詳細については、こちらの記事で解説しています。</p>

  ${BLOGCARD_FRAME_OPEN_HTML}

  https://example.com/sample-article/

  ${BLOGCARD_FRAME_CLOSE_HTML}`;
}

/**
 * The "insert these links" section of the rewrite prompt. Returns "" when there
 * are no links. Also used client-side to estimate prompt length for the cost hint.
 */
export function buildInternalLinkPromptSection(
  links: InternalLinkRequest[],
  format: InternalLinkFormat
): string {
  if (links.length === 0) return "";

  const list = links
    .map((link, index) => {
      const lines = [`${index + 1}. 記事タイトル: ${link.title}`, `   URL: ${link.url}`];
      if (link.reason) lines.push(`   紹介できる文脈: ${link.reason}`);
      return lines.join("\n");
    })
    .join("\n");

  return `
# 挿入する内部リンク（必須）
以下の自サイト記事へのリンクを、本文中でもっとも自然な位置に1件ずつ挿入すること。
${formatRules(format)}
- 挿入位置は「紹介できる文脈」を手がかりに、その話題を扱っている段落・見出しの直後など、流れが途切れない場所を選ぶ。
- URLは下記のものを一字一句変えずに使う。下記以外のURLを作らない。各リンクは1回だけ挿入する。
- 本文の既存の意味・構成は変えず、リンクの案内として追加する文（または段落）以外の事実を書き足さない。

## 挿入するリンク一覧
${list}
`;
}
