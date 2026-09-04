import type { SearchResult } from './bitmidi';
import { normalizeName, normalizeQuery, songKey, type NormalizedName, type NormalizedQuery } from './normalize';

export interface RankedResult extends SearchResult {
  norm: NormalizedName;
  score: number;
}

/** One card in the results list: every upload that normalizes to the same title. */
export interface SongGroup {
  key: string;
  title: string;                 // normalized title, for matching
  displayTitle: string;          // title-cased for the card
  artist?: string;               // most common artist among the versions
  best: RankedResult;
  versions: RankedResult[];      // sorted best first, includes `best`
  score: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — what makes a MIDI search hit "relevant"?
 *
 *  bitmidi returns anything sharing a token with the query, ordered by its own
 *  popularity, so "Let It Be" starts with six "Let It Snow" files. This local
 *  re-rank decides the order the user actually sees. Tiers, strongest first:
 *    exact title match  > query as a contiguous phrase in the title
 *    > fraction of query tokens present > artist match > popularity (log views)
 *  with a small penalty for every extra word in the title ("Let It Be Me").
 *  Catalog matches carry a flat bonus above all of that, plus the fuzzy score the
 *  catalog lookup gave them: it already vetted them, and a bundled piece should
 *  never sit under a popular upload of the same tune. With hundreds of Mutopia
 *  entries that score is what orders "sonata" sensibly; their display names are
 *  "Title — Composer", which the file-name normalizer would read the wrong way round.
 *
 *  Change the weights here and both the order and the grouping follow. Popularity
 *  only ever breaks ties between otherwise equal titles; it never lifts a wrong
 *  song above a right one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const WEIGHTS = {
  exactTitle: 10,
  phrase: 5,
  coverage: 3,       // × fraction of query tokens found
  artist: 2,         // × fraction of artist tokens found (only when the query names one)
  extraWord: -0.6,   // per title word beyond the query, capped at 3
  popularity: 0.3,   // × log10(views + 1)
  catalog: 16,       // built-in songs already passed the fuzzy catalog lookup; they lead
};

export function scoreResult(norm: NormalizedName, q: NormalizedQuery, views = 0): number {
  if (q.tokens.length === 0) return Math.log10(views + 1) * WEIGHTS.popularity;
  const artistTokens = new Set(norm.artist ? norm.artist.split(' ') : []);
  const titleTokens = new Set(norm.tokens);

  // Which query tokens describe the title? Everything the file's artist does not already explain,
  // unless the user separated title and artist themselves.
  const qTitle = q.title ? q.title.split(' ') : q.tokens.filter((t) => !artistTokens.has(t) || titleTokens.has(t));
  const qArtist = q.artist ? q.artist.split(' ') : q.tokens.filter((t) => artistTokens.has(t) && !titleTokens.has(t));

  let score = 0;
  const qTitleStr = qTitle.join(' ');
  if (qTitleStr && norm.title === qTitleStr) score += WEIGHTS.exactTitle;
  else if (qTitleStr && ` ${norm.title} `.includes(` ${qTitleStr} `)) score += WEIGHTS.phrase;

  const found = qTitle.filter((t) => titleTokens.has(t)).length;
  score += WEIGHTS.coverage * (qTitle.length ? found / qTitle.length : 0);

  if (qArtist.length) {
    const hit = qArtist.filter((t) => artistTokens.has(t) || titleTokens.has(t)).length;
    score += WEIGHTS.artist * (hit / qArtist.length);
  }

  const extra = Math.max(0, norm.tokens.length - qTitle.length);
  score += WEIGHTS.extraWord * Math.min(3, extra);

  score += WEIGHTS.popularity * Math.log10(Math.max(0, views) + 1);
  return score;
}

export function rankResults(results: SearchResult[], query: string): RankedResult[] {
  const q = normalizeQuery(query);
  return results
    .map((r) => {
      const norm = normalizeName(r.name);
      const bonus = r.source === 'catalog' ? WEIGHTS.catalog : 0;
      return { ...r, norm, score: bonus + (r.relevance ?? scoreResult(norm, q, r.views ?? 0)) };
    })
    .sort((a, b) => b.score - a.score || (b.views ?? 0) - (a.views ?? 0));
}

/** Collapse ranked results into one group per normalized title, best group first. */
export function groupResults(ranked: RankedResult[]): SongGroup[] {
  const groups = new Map<string, SongGroup>();
  for (const r of ranked) {
    const key = r.source === 'catalog' ? `catalog:${r.id}` : songKey(r.norm) || r.name.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { key, title: r.norm.title, displayTitle: titleCase(r.norm.title || r.name), best: r, versions: [], score: r.score };
      groups.set(key, g);
    }
    g.versions.push(r);
  }
  for (const g of groups.values()) {
    g.versions.sort((a, b) => b.score - a.score || (b.views ?? 0) - (a.views ?? 0));
    g.best = g.versions[0];
    g.score = g.best.score;
    g.artist = commonest(g.versions.map((v) => v.norm.artist).filter((a): a is string => !!a));
  }
  return [...groups.values()].sort((a, b) => b.score - a.score);
}

/** Rank and group in one call: what the UI asks for. */
export function searchGroups(results: SearchResult[], query: string): SongGroup[] {
  return groupResults(rankResults(results, query));
}

function commonest(xs: string[]): string | undefined {
  if (xs.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

export function titleCase(s: string): string {
  return s.split(' ').filter(Boolean).map((w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}
