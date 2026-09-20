/** Small HTML → text helpers for summarizing / matching articles. No server-only imports so tests can load it directly. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Block-level tags whose boundaries should read as a line break once tags are stripped. */
const BLOCK_TAGS = "p|div|h[1-6]|li|ul|ol|br|tr|table|blockquote|figure|section|article";

/**
 * Strips a WordPress post body (rendered or raw block-editor HTML) down to readable text:
 * drops scripts/styles/HTML comments (Gutenberg block delimiters) and `[shortcodes]`, and keeps paragraph breaks.
 */
export function htmlToPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/\[\/?[a-z_][\w-]*(?:\s[^\]]*)?\]/gi, " ")
      .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t　]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Text of the article's h2/h3 headings, in document order. */
export function extractHeadings(html: string, limit = 20): string[] {
  const headings: string[] = [];
  const pattern = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi;
  for (const match of html.matchAll(pattern)) {
    const text = htmlToPlainText(match[1]).replace(/\s+/g, " ");
    if (text) headings.push(text);
    if (headings.length >= limit) break;
  }
  return headings;
}

/** Truncates to a character budget, cutting at a line boundary when one is reasonably close. */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  return `${lastBreak > maxChars * 0.7 ? cut.slice(0, lastBreak) : cut}…`;
}
