import type { WordPressPost, WordPressPostListItem, WordPressPostStatus } from "@/types";

interface WpApiPost {
  id: number;
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
  modified: string;
  status: string;
  link: string;
}

function getBaseUrl(): string {
  const url = process.env.WORDPRESS_URL;
  if (!url) {
    throw new Error("WORDPRESS_URL is not configured");
  }
  return url.replace(/\/+$/, "");
}

function getAuthHeader(): string {
  const user = process.env.WORDPRESS_USER;
  const appPassword = process.env.WORDPRESS_APP_PASS;
  if (!user || !appPassword) {
    throw new Error("WORDPRESS_USER / WORDPRESS_APP_PASS is not configured");
  }
  const token = Buffer.from(`${user}:${appPassword}`).toString("base64");
  return `Basic ${token}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function wpFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${getBaseUrl()}/wp-json/wp/v2${path}`, {
    ...init,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  return res;
}

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WordPress API error (${res.status}): ${body || res.statusText}`);
  }
}

function toListItem(post: WpApiPost): WordPressPostListItem {
  return {
    id: post.id,
    title: decodeHtmlEntities(post.title.rendered),
    content: post.content.rendered,
    modified: post.modified,
    status: post.status,
    link: post.link,
  };
}

function toPost(post: WpApiPost): WordPressPost {
  return {
    id: post.id,
    title: decodeHtmlEntities(post.title.rendered),
    content: post.content.raw ?? post.content.rendered,
    status: post.status as WordPressPostStatus,
    modified: post.modified,
    link: post.link,
  };
}

export async function getPosts(
  page = 1,
  perPage = 10,
  search = "",
  order: "asc" | "desc" = "desc"
): Promise<{ posts: WordPressPostListItem[]; total: number; totalPages: number }> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
    status: "any",
    orderby: "modified",
    order,
    _fields: "id,title,content,modified,status,link",
  });
  if (search) params.set("search", search);

  const res = await wpFetch(`/posts?${params.toString()}`);
  await assertOk(res);

  const data = (await res.json()) as WpApiPost[];
  const total = Number(res.headers.get("X-WP-Total") ?? data.length);
  const totalPages = Number(res.headers.get("X-WP-TotalPages") ?? 1);

  return { posts: data.map(toListItem), total, totalPages };
}

export async function getPost(id: number): Promise<WordPressPost> {
  const res = await wpFetch(`/posts/${id}?context=edit`);
  await assertOk(res);
  const post = (await res.json()) as WpApiPost;
  return toPost(post);
}

export async function updatePost(
  id: number,
  data: { content: string; status?: "draft" | "publish" }
): Promise<WordPressPost> {
  const res = await wpFetch(`/posts/${id}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  await assertOk(res);
  const post = (await res.json()) as WpApiPost;
  return toPost(post);
}

/** Returns the single oldest published post by last-modified date, or null if none exist. */
export async function getOldestPost(): Promise<WordPressPostListItem | null> {
  const params = new URLSearchParams({
    per_page: "1",
    status: "publish",
    orderby: "modified",
    order: "asc",
    _fields: "id,title,content,modified,status,link",
  });

  const res = await wpFetch(`/posts?${params.toString()}`);
  await assertOk(res);

  const data = (await res.json()) as WpApiPost[];
  return data.length > 0 ? toListItem(data[0]) : null;
}
