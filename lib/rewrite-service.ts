import { getPost, updatePost } from "@/lib/wordpress";
import { rewriteArticle, GeminiRateLimitError } from "@/lib/gemini";
import { logRewriteResult } from "@/lib/supabase";
import type { PublishStatus } from "@/types";

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
}

/**
 * Shared flow used by both /api/rewrite and /api/cron/rewrite-oldest:
 * fetch the latest post from WordPress, rewrite it via Gemini, push the
 * update back to WordPress, and record the outcome in Supabase either way.
 */
export async function performRewrite(
  postId: number,
  publishStatus: PublishStatus
): Promise<RewriteResult> {
  const post = await getPost(postId);

  try {
    const rewrittenContent = await rewriteArticle(post.title, post.content);
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
    });

    return { postId: updated.id, updatedUrl: updated.link };
  } catch (error) {
    const message =
      error instanceof GeminiRateLimitError
        ? "Gemini APIのレート制限に達しました。しばらく待ってから再試行してください。"
        : error instanceof Error
          ? error.message
          : "不明なエラーが発生しました。";

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
