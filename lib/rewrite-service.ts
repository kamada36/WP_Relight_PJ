import { getPost, updatePost } from "@/lib/wordpress";
import { rewriteArticle, describeGeminiError } from "@/lib/gemini";
import { findMissingLinks } from "@/lib/internal-links";
import { getAppSettings, logRewriteResult, saveOriginalIfAbsent } from "@/lib/supabase";
import type { InternalLinkFormat, InternalLinkRequest, PublishStatus } from "@/types";

const SNIPPET_LENGTH = 300;

function toSnippet(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_LENGTH);
}

export interface RewriteResult {
  postId: number;
  updatedUrl: string;
  summary: string | null;
  /** URLs of requested internal links that don't appear in the rewritten body (Gemini skipped them). */
  missingLinkUrls: string[];
}

export interface PerformRewriteOptions {
  instruction?: string;
  /** Internal links Gemini is asked to weave into the body. */
  internalLinks?: InternalLinkRequest[];
  internalLinkFormat?: InternalLinkFormat;
  /** Called with each raw text delta as Gemini streams the rewrite in. */
  onDelta?: (text: string) => void;
}

/**
 * Shared flow used by both /api/rewrite and /api/cron/rewrite-oldest:
 * fetch the latest post from WordPress, rewrite it via Gemini, push the
 * update back to WordPress, and record the outcome in Supabase either way.
 */
export async function performRewrite(
  postId: number,
  publishStatus: PublishStatus,
  options: PerformRewriteOptions = {}
): Promise<RewriteResult> {
  const { instruction, internalLinks = [], internalLinkFormat, onDelta } = options;

  // Independent reads: fetch the post and the configured model in parallel.
  const [post, geminiModel] = await Promise.all([
    getPost(postId),
    getAppSettings()
      .then((settings) => settings.geminiModel)
      .catch(() => undefined), // Fall back to GEMINI_MODEL_NAME / the built-in default.
  ]);

  // Keep the pre-rewrite content around (only on the first rewrite of an
  // unconfirmed cycle) so the user can revert even after rewriting repeatedly.
  await saveOriginalIfAbsent(postId, post.content, post.status);

  try {
    const { content: rewrittenContent, summary } = await rewriteArticle(post.title, post.content, {
      instruction,
      modelOverride: geminiModel,
      internalLinks,
      internalLinkFormat,
      onDelta,
    });
    const updated = await updatePost(postId, {
      content: rewrittenContent,
      status: publishStatus,
    });

    await logRewriteResult({
      post_id: post.id,
      post_title: post.title,
      post_url: updated.link,
      status: "success",
      original_content_snippet: toSnippet(post.content),
      rewritten_content_snippet: toSnippet(rewrittenContent),
      summary,
    });

    const missingLinkUrls = findMissingLinks(rewrittenContent, internalLinks).map((link) => link.url);
    return { postId: updated.id, updatedUrl: updated.link, summary, missingLinkUrls };
  } catch (error) {
    const message = describeGeminiError(error);

    await logRewriteResult({
      post_id: post.id,
      post_title: post.title,
      post_url: post.link,
      status: "failed",
      original_content_snippet: toSnippet(post.content),
      error_message: message,
    });

    throw new Error(message);
  }
}
