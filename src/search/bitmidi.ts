import { normalizeQuery } from './normalize';

export interface SearchResult {
  id: string;
  name: string;
  downloadUrl: string;
  pageUrl?: string;
  views?: number;
  alternateNames?: string[];
  source: 'bitmidi' | 'catalog';
  /** Card tag for catalog entries that came from elsewhere ("Mutopia"); absent means built-in. */
  origin?: string;
  /** Short right-hand text on the card, such as "48 bars · 1:12", when there is no view count. */
  detail?: string;
  /** A score the source's own matcher already computed; the re-ranker uses it instead of the name. */
  relevance?: number;
}

const BASE = 'https://bitmidi.com';

/** Convert one raw bitmidi API record into a SearchResult. */
export function fromBitmidiRecord(r: any): SearchResult {
  return {
    id: String(r.id), name: String(r.name).replace(/\.mid$/i, ''), downloadUrl: BASE + r.downloadUrl,
    pageUrl: BASE + (r.url ?? ''), views: r.views, source: 'bitmidi',
    alternateNames: Array.isArray(r.alternateNames) ? r.alternateNames.map(String) : undefined,
  };
}

/** Search bitmidi.com (CORS-open, undocumented JSON API). One query, one page. */
export async function searchBitmidi(query: string, page = 0, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `${BASE}/api/midi/search?q=${encodeURIComponent(query)}&page=${page}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`bitmidi search failed: HTTP ${res.status}`);
  const json = await res.json();
  const results: any[] = json?.result?.results ?? [];
  return results.map(fromBitmidiRecord);
}

export interface QueryVariant { q: string; page: number }

/**
 * bitmidi's search is a loose token match ordered by its own popularity, and a phrase
 * in quotes is an exact-phrase search. Underscored file names ("let_it_be.mid") are
 * not tokenized at all, so they only surface for an underscored query. Verified 2026-09-03:
 * plain "let it be" puts the Beatles file on page 4; "\"let it be\"" puts it on page 0.
 */
export function buildQueryVariants(query: string): QueryVariant[] {
  const q = normalizeQuery(query);
  const plain = query.trim();
  const out: QueryVariant[] = [{ q: plain, page: 0 }, { q: plain, page: 1 }];
  if (q.tokens.length >= 2) {
    out.push({ q: `"${q.folded}"`, page: 0 });
    out.push({ q: q.tokens.join('_'), page: 0 });
  }
  if (q.title && q.artist) out.push({ q: `"${q.title}" ${q.artist}`, page: 0 });
  // "let it be by the beatles": retrieval-only split; scoring never treats "by" as a separator.
  const by = /^(.+?)\s+by\s+(.+)$/i.exec(plain);
  if (by) out.push({ q: `"${normalizeQuery(by[1]).folded}" ${normalizeQuery(by[2]).folded}`, page: 0 });
  const sig = q.significant.join(' ');
  if (sig && sig !== q.folded) out.push({ q: sig, page: 0 });
  const seen = new Set<string>();
  return out.filter((v) => { const k = `${v.q.toLowerCase()}|${v.page}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Merge result lists by id, keeping the first occurrence. */
export function mergeById(lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const list of lists) for (const r of list) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } }
  return out;
}

/** Run every query variant in parallel and merge. Throws only if all variants fail. */
export async function searchBitmidiAll(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const variants = buildQueryVariants(query);
  const settled = await Promise.allSettled(variants.map((v) => searchBitmidi(v.q, v.page, signal)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<SearchResult[]> => s.status === 'fulfilled').map((s) => s.value);
  if (ok.length === 0) {
    const first = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    throw first?.reason ?? new Error('bitmidi search failed');
  }
  return mergeById(ok);
}

export async function downloadMidi(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  const magic = String.fromCharCode(...head);
  if (magic !== 'MThd' && magic !== 'RIFF') throw new Error('That URL did not return a MIDI file.');
  return buf;
}
