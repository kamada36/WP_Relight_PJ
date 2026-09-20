import { GeminiAuthError, describeGeminiError, generateJson } from "@/lib/gemini";
import { extractHeadings, htmlToPlainText, truncateText } from "@/lib/article-text";
import { collectLinkedUrls, normalizeUrl } from "@/lib/internal-links";
import { createMatchCorpus, type MatchDoc } from "@/lib/link-matching";
import { getPost, getPublishedPostsPage } from "@/lib/wordpress";
import {
  countSummarizedArticles,
  deleteArticleIndexEntries,
  getAllArticleIndexEntries,
  getAppSettings,
  getArticleIndexEntries,
  getLinkSuggestionRecords,
  saveLinkSuggestions,
  upsertArticleIndexEntries,
} from "@/lib/supabase";
import type {
  ArticleIndexEntry,
  ArticleListItem,
  LinkSuggestion,
  MatchBatchResult,
  StoredLinkSuggestion,
  SyncPageResult,
} from "@/types";

/** Posts handled per /api/articles/sync call: small enough that summarizing them all fits comfortably in one serverless invocation. */
export const SYNC_PER_PAGE = 15;
/** Max source articles matched per /api/articles/match call. */
export const MAX_MATCH_BATCH = 10;

const GEMINI_CONCURRENCY = 5;
/** Characters of article body sent to Gemini for summarizing; the opening + headings carry the topic, the tail rarely adds to it. */
const SUMMARY_BODY_CHARS = 6000;
const MAX_KEYWORDS = 10;
const MAX_SUGGESTIONS = 3;
/** Candidates that survive the lexical pre-filter and are shown to Gemini for the final pick. */
const SHORTLIST_SIZE = 12;

type IndexRow = Omit<ArticleIndexEntry, "synced_at">;

interface PostForIndex {
  id: number;
  title: string;
  link: string;
  status: string;
  content: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Runs `fn` over `items` with bounded parallelism. On the first throw, stops starting new items and rethrows. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;

  async function worker() {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}

function getConfiguredModel(): Promise<string | undefined> {
  // Fall back to GEMINI_MODEL_NAME / the built-in default if settings can't be read.
  return getAppSettings()
    .then((settings) => settings.geminiModel)
    .catch(() => undefined);
}

function toMatchDoc(entry: ArticleIndexEntry, extra?: string): MatchDoc {
  return {
    id: entry.post_id,
    title: entry.title,
    summary: entry.summary ?? "",
    keywords: entry.keywords,
    extra,
  };
}

/** Attaches title/URL from the index to stored suggestions, dropping targets that are gone or no longer published. */
function resolveSuggestions(
  stored: StoredLinkSuggestion[],
  byId: Map<number, ArticleIndexEntry>
): LinkSuggestion[] {
  const resolved: LinkSuggestion[] = [];
  for (const item of stored) {
    const target = byId.get(item.post_id);
    if (!target || target.status !== "publish") continue;
    resolved.push({ post_id: item.post_id, reason: item.reason, title: target.title, url: target.url });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// summaries
// ---------------------------------------------------------------------------

function buildSummaryPrompt(title: string, headings: string[], body: string): string {
  const headingList = headings.length > 0 ? headings.map((h) => `- ${h}`).join("\n") : "（見出しなし）";
  return `あなたはWebメディアの編集者です。以下の記事について、他の記事から内部リンクを張る際に「この記事が何を解説していて、どんな読者の疑問に答えるか」を判断するための概要を作成してください。

# 記事タイトル
${title}

# 記事の見出し
${headingList}

# 記事本文（テキスト。長い場合は冒頭のみ）
${body}

# 出力ルール
- summary: 記事の主題・扱っている範囲・読者が得られることを、日本語で120〜200字程度にまとめる。宣伝調の表現や「この記事では」といった前置きは省く。
- keywords: 記事の主題を表す語句を5〜10個。固有名詞・専門用語・検索されそうな言葉を優先する（日本語）。
- 本文に書かれていないことは書かない。

次のJSONのみを出力してください:
{"summary": "...", "keywords": ["...", "..."]}`;
}

async function summarizeArticle(
  title: string,
  html: string,
  model: string | undefined
): Promise<{ summary: string; keywords: string[] }> {
  const body = truncateText(htmlToPlainText(html), SUMMARY_BODY_CHARS);
  if (body.length < 20) {
    throw new Error("本文が短すぎるため概要を作成できませんでした。");
  }

  const raw = await generateJson<{ summary?: unknown; keywords?: unknown }>(
    buildSummaryPrompt(title, extractHeadings(html), body),
    model
  );

  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 500) : "";
  if (!summary) throw new Error("Geminiが概要を返しませんでした。");

  const keywords = Array.isArray(raw.keywords)
    ? [
        ...new Set(
          raw.keywords
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim())
            .filter((k) => k.length > 0 && k.length <= 40)
        ),
      ].slice(0, MAX_KEYWORDS)
    : [];

  return { summary, keywords };
}

/**
 * Builds the index row for one post. Title/URL/status are always refreshed; the
 * (billable) Gemini summary is only regenerated when it's missing or `force` is
 * set — rewrites preserve an article's meaning, so an old summary stays valid.
 * A Gemini failure keeps whatever summary existed and is reported via `error`
 * (auth failures are rethrown: every remaining article would fail the same way).
 */
async function buildIndexRow(
  post: PostForIndex,
  existing: ArticleIndexEntry | undefined,
  force: boolean,
  model: string | undefined
): Promise<{ row: IndexRow; summarized: boolean; error?: string }> {
  const row: IndexRow = {
    post_id: post.id,
    title: post.title,
    url: post.link,
    status: post.status,
    summary: existing?.summary ?? null,
    keywords: existing?.keywords ?? [],
    summarized_at: existing?.summarized_at ?? null,
  };

  if (existing?.summary && !force) return { row, summarized: false };

  try {
    const { summary, keywords } = await summarizeArticle(post.title, post.content, model);
    return {
      row: { ...row, summary, keywords, summarized_at: new Date().toISOString() },
      summarized: true,
    };
  } catch (error) {
    if (error instanceof GeminiAuthError) throw error;
    return { row, summarized: false, error: describeGeminiError(error) };
  }
}

// ---------------------------------------------------------------------------
// index sync
// ---------------------------------------------------------------------------

/** Indexes one page of published posts. The client calls this page by page so no single request runs long. */
export async function syncIndexPage(page: number, force: boolean): Promise<SyncPageResult> {
  const [{ posts, total, totalPages }, model] = await Promise.all([
    getPublishedPostsPage(page, SYNC_PER_PAGE),
    getConfiguredModel(),
  ]);

  const existing = new Map(
    (await getArticleIndexEntries(posts.map((post) => post.id))).map((entry) => [entry.post_id, entry])
  );

  const outcomes = await mapWithConcurrency(posts, GEMINI_CONCURRENCY, (post) =>
    buildIndexRow(
      { id: post.id, title: post.title, link: post.link, status: post.status, content: post.content },
      existing.get(post.id),
      force,
      model
    )
  );
  await upsertArticleIndexEntries(outcomes.map((outcome) => outcome.row));

  return {
    page,
    totalPages,
    total,
    postIds: posts.map((post) => post.id),
    summarized: outcomes.filter((outcome) => outcome.summarized).length,
    skipped: outcomes.filter((outcome) => !outcome.summarized && !outcome.error).length,
    failed: outcomes.flatMap((outcome) =>
      outcome.error
        ? [{ postId: outcome.row.post_id, title: outcome.row.title, error: outcome.error }]
        : []
    ),
  };
}

/** Re-indexes a single post (any status), always regenerating its summary. */
export async function reindexPost(postId: number): Promise<{ error?: string }> {
  const [post, model, existing] = await Promise.all([
    getPost(postId),
    getConfiguredModel(),
    getArticleIndexEntries([postId]),
  ]);

  const { row, error } = await buildIndexRow(
    { id: post.id, title: post.title, link: post.link, status: post.status, content: post.content },
    existing[0],
    true,
    model
  );
  await upsertArticleIndexEntries([row]);
  return error ? { error } : {};
}

/**
 * Deletes index rows for published posts that a full sync no longer saw (deleted or unpublished
 * since). Refuses when `seenPostIds` is empty so a failed/empty fetch can never wipe the index.
 */
export async function pruneIndex(seenPostIds: number[]): Promise<number> {
  if (seenPostIds.length === 0) return 0;

  const seen = new Set(seenPostIds);
  const stale = (await getAllArticleIndexEntries())
    .filter((entry) => entry.status === "publish" && !seen.has(entry.post_id))
    .map((entry) => entry.post_id);

  await deleteArticleIndexEntries(stale);
  return stale.length;
}

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

function buildMatchPrompt(
  source: { title: string; summary: string; headings: string[] },
  candidates: MatchDoc[]
): string {
  const headingList =
    source.headings.length > 0 ? source.headings.map((h) => `- ${h}`).join("\n") : "（見出しなし）";
  const candidateList = candidates
    .map((c) => `[id=${c.id}] ${c.title}\n概要: ${c.summary}`)
    .join("\n\n");

  return `あなたはWebメディアの編集者です。「元記事」の本文中に、内部リンクとして自然に紹介できる記事を「候補記事」から選んでください。
「〇〇の詳細はこちらの記事で解説しています」のように、文章の流れの中で違和感なく案内できるものだけが対象です。

# 元記事
タイトル: ${source.title}
概要: ${source.summary}
見出し:
${headingList}

# 候補記事
${candidateList}

# 選定ルール
- 元記事の話題を補足・深掘りする記事、読者が次に知りたくなる記事を優先する。
- 元記事と同じ内容の重複記事や、キーワードが似ているだけで文脈がつながらない記事は選ばない。
- 最大${MAX_SUGGESTIONS}件。自然に紹介できる記事がなければ空配列にする（無理に選ばない）。
- reason: 元記事のどの話題（見出し）の流れで、どのように紹介できるかを日本語1文（60字程度）で書く。
- id は候補記事の [id=…] の数値をそのまま使う。

次のJSONのみを出力してください:
{"suggestions": [{"id": 123, "reason": "..."}]}`;
}

async function pickSuggestions(
  source: { title: string; summary: string; headings: string[] },
  shortlist: MatchDoc[],
  model: string | undefined
): Promise<StoredLinkSuggestion[]> {
  const raw = await generateJson<{ suggestions?: unknown }>(buildMatchPrompt(source, shortlist), model);
  if (!Array.isArray(raw.suggestions)) return [];

  const allowed = new Set(shortlist.map((doc) => doc.id));
  const picked: StoredLinkSuggestion[] = [];
  for (const item of raw.suggestions) {
    if (!item || typeof item !== "object") continue;
    const { id, reason } = item as { id?: unknown; reason?: unknown };
    // The model may echo the id as a string or invent one that wasn't offered; only accept shortlisted ids.
    const postId = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
    if (!allowed.has(postId) || picked.some((p) => p.post_id === postId)) continue;
    picked.push({
      post_id: postId,
      reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "",
    });
    if (picked.length >= MAX_SUGGESTIONS) break;
  }
  return picked;
}

/**
 * Finds 0-3 articles that could be introduced naturally from each source post and stores the result.
 * The source's live content is re-read from WordPress so articles it already links to are excluded,
 * and a source missing from the index (e.g. a new post or a draft) is indexed on the spot.
 * With `force` false, sources that already have a stored result are returned as-is.
 */
export async function matchPosts(postIds: number[], force: boolean): Promise<MatchBatchResult> {
  const ids = [...new Set(postIds)].slice(0, MAX_MATCH_BATCH);

  const [entries, model, stored] = await Promise.all([
    getAllArticleIndexEntries(),
    getConfiguredModel(),
    getLinkSuggestionRecords(ids),
  ]);
  const byId = new Map(entries.map((entry) => [entry.post_id, entry]));
  const pool = entries.filter((entry) => entry.status === "publish" && entry.summary);
  const corpus = createMatchCorpus(pool.map((entry) => toMatchDoc(entry)));

  const results: Record<number, LinkSuggestion[]> = {};
  const failed: { postId: number; error: string }[] = [];
  let fatal: unknown = null;

  await mapWithConcurrency(ids, GEMINI_CONCURRENCY, async (postId) => {
    try {
      const cached = stored.get(postId);
      if (cached && !force) {
        results[postId] = resolveSuggestions(cached, byId);
        return;
      }

      const post = await getPost(postId);
      const headings = extractHeadings(post.content);

      let source = byId.get(postId);
      if (!source?.summary) {
        const { row, error } = await buildIndexRow(
          { id: post.id, title: post.title, link: post.link, status: post.status, content: post.content },
          source,
          false,
          model
        );
        if (!row.summary) throw new Error(error ?? "概要を作成できませんでした。");
        await upsertArticleIndexEntries([row]);
        source = { ...row, synced_at: new Date().toISOString() };
      }

      // Don't suggest an article the source already links to (as <a>, embed or bare URL).
      const linked = collectLinkedUrls(post.content);
      const alreadyLinkedIds = new Set(
        pool.filter((entry) => linked.has(normalizeUrl(entry.url) ?? "")).map((entry) => entry.post_id)
      );

      const sourceInfo = { title: source.title, summary: source.summary ?? "", headings };
      const shortlist = corpus.shortlist(
        toMatchDoc(source, headings.join(" ")),
        SHORTLIST_SIZE,
        alreadyLinkedIds
      );
      const picked = shortlist.length > 0 ? await pickSuggestions(sourceInfo, shortlist, model) : [];

      await saveLinkSuggestions(postId, picked);
      results[postId] = resolveSuggestions(picked, byId);
    } catch (error) {
      if (error instanceof GeminiAuthError) {
        fatal ??= error;
        return;
      }
      failed.push({ postId, error: describeGeminiError(error) });
    }
  });

  if (fatal) throw fatal;
  return { results, failed };
}

// ---------------------------------------------------------------------------
// reads for the UI
// ---------------------------------------------------------------------------

/** Every indexed article with its resolved link suggestions, newest post first. */
export async function listArticles(): Promise<ArticleListItem[]> {
  const [entries, records] = await Promise.all([getAllArticleIndexEntries(), getLinkSuggestionRecords()]);
  const byId = new Map(entries.map((entry) => [entry.post_id, entry]));

  return entries
    .map((entry) => {
      const stored = records.get(entry.post_id);
      return { ...entry, suggestions: stored ? resolveSuggestions(stored, byId) : null };
    })
    .sort((a, b) => b.post_id - a.post_id);
}

/**
 * Stored suggestions for the given posts (the dashboard's visible page). Posts
 * absent from `results` haven't been matched yet. `indexedCount` lets the UI
 * tell "no index built yet" apart from "matched, nothing suitable".
 */
export async function getSuggestionsForPosts(
  postIds: number[]
): Promise<{ indexedCount: number; results: Record<number, LinkSuggestion[]> }> {
  const [records, indexedCount] = await Promise.all([
    getLinkSuggestionRecords(postIds),
    countSummarizedArticles(),
  ]);

  const targetIds = [
    ...new Set([...records.values()].flatMap((items) => items.map((item) => item.post_id))),
  ];
  const byId = new Map(
    (await getArticleIndexEntries(targetIds)).map((entry) => [entry.post_id, entry])
  );

  const results: Record<number, LinkSuggestion[]> = {};
  for (const [postId, stored] of records) results[postId] = resolveSuggestions(stored, byId);
  return { indexedCount, results };
}
