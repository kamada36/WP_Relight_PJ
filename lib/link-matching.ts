/**
 * Cheap lexical pre-filter for internal-link matching. Sending every article's
 * summary to Gemini for every source article would be wasteful, so this ranks
 * the corpus by character-bigram TF-IDF cosine similarity (works for Japanese
 * without a tokenizer) and only the top few candidates go to the LLM, which
 * makes the final "can this be introduced naturally?" call.
 */

export interface MatchDoc {
  id: number;
  title: string;
  summary: string;
  keywords: string[];
  /** Extra text that only sharpens matching (e.g. the source article's headings). */
  extra?: string;
}

/** Bigram of "の" / "です" style particles is noise; TF-IDF down-weights it, but punctuation & spaces are dropped outright. */
function normalizeForBigrams(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigramCounts(text: string): Map<string, number> {
  const normalized = normalizeForBigrams(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** Title and keywords are the strongest topical signal, so they're repeated to weight them above the summary. */
function docText(doc: MatchDoc): string {
  const keywords = doc.keywords.join(" ");
  return [doc.title, doc.title, keywords, keywords, doc.summary, doc.extra ?? ""].join(" ");
}

function haystack(doc: MatchDoc): string {
  return normalizeForBigrams([doc.title, doc.keywords.join(" "), doc.summary].join(" "));
}

interface IndexedDoc {
  doc: MatchDoc;
  vector: Map<string, number>;
  norm: number;
  haystack: string;
}

const MIN_KEYWORD_CHARS = 2;
const KEYWORD_HIT_BONUS = 0.04;
const MAX_KEYWORD_HITS = 6;

export interface MatchCorpus {
  /** Ranks corpus docs by relevance to `source`, best first. Never returns the source itself or anything in `excludeIds`. */
  shortlist(source: MatchDoc, limit: number, excludeIds?: ReadonlySet<number>): MatchDoc[];
}

/** Builds the IDF weights once for a corpus, so a batch of sources can be ranked against it cheaply. */
export function createMatchCorpus(docs: MatchDoc[]): MatchCorpus {
  const documentFrequency = new Map<string, number>();
  const rawVectors = docs.map((doc) => bigramCounts(docText(doc)));
  for (const vector of rawVectors) {
    for (const gram of vector.keys()) {
      documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);
    }
  }

  const totalDocs = docs.length;
  const idf = (gram: string) => Math.log((totalDocs + 1) / ((documentFrequency.get(gram) ?? 0) + 1)) + 1;

  function weigh(counts: Map<string, number>): { vector: Map<string, number>; norm: number } {
    const vector = new Map<string, number>();
    let sumSquares = 0;
    for (const [gram, count] of counts) {
      const weight = (1 + Math.log(count)) * idf(gram);
      vector.set(gram, weight);
      sumSquares += weight * weight;
    }
    return { vector, norm: Math.sqrt(sumSquares) };
  }

  const indexed: IndexedDoc[] = docs.map((doc, i) => ({
    doc,
    ...weigh(rawVectors[i]),
    haystack: haystack(doc),
  }));

  function keywordHits(source: MatchDoc, sourceHaystack: string, target: IndexedDoc): number {
    let hits = 0;
    for (const keyword of source.keywords) {
      const key = normalizeForBigrams(keyword);
      if (key.length >= MIN_KEYWORD_CHARS && target.haystack.includes(key)) hits++;
    }
    for (const keyword of target.doc.keywords) {
      const key = normalizeForBigrams(keyword);
      if (key.length >= MIN_KEYWORD_CHARS && sourceHaystack.includes(key)) hits++;
    }
    return Math.min(hits, MAX_KEYWORD_HITS);
  }

  return {
    shortlist(source, limit, excludeIds) {
      const { vector: sourceVector, norm: sourceNorm } = weigh(bigramCounts(docText(source)));
      const sourceHaystack = haystack(source);
      if (sourceNorm === 0) return [];

      const scored: { doc: MatchDoc; score: number }[] = [];
      for (const target of indexed) {
        if (target.doc.id === source.id || excludeIds?.has(target.doc.id)) continue;
        if (target.norm === 0) continue;

        let dot = 0;
        for (const [gram, weight] of sourceVector) {
          const other = target.vector.get(gram);
          if (other) dot += weight * other;
        }
        const cosine = dot / (sourceNorm * target.norm);
        const score = cosine + KEYWORD_HIT_BONUS * keywordHits(source, sourceHaystack, target);
        if (score > 0) scored.push({ doc: target.doc, score });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((entry) => entry.doc);
    },
  };
}
