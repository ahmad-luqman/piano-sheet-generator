import { cleanFileName, editDistance, fold, normalizeQuery, tokensOf } from './normalize';

/**
 * "yesturday beetles" → "Yesterday", "The Beatles". A canonical title lookup for queries
 * that a MIDI site cannot match: misspellings, nicknames, descriptions. iTunes Search is
 * CORS-open, tolerant of typos and free (about twenty requests a minute); MusicBrainz is
 * CORS-open too but only fuzzy per field, so it is the fallback and works best when the
 * query already separates title and artist. Claude fills the same slot when a key is set
 * (llm/claude.ts, understandQuery). Everything that parses a response is pure and tested
 * against saved fixtures.
 */

export interface QueryCandidate {
  title: string;
  artist?: string;
  reason?: string;
  source: 'itunes' | 'musicbrainz' | 'claude';
}

export const SOURCE_LABEL: Record<QueryCandidate['source'], string> = { itunes: 'iTunes', musicbrainz: 'MusicBrainz', claude: 'Claude' };

export const MAX_CANDIDATES = 4;

/** The search string for a candidate: "Title - Artist", the split the query normalizer understands. */
export function candidateQuery(c: QueryCandidate): string {
  return c.artist ? `${c.title} - ${c.artist}` : c.title;
}

/** True when the candidate is just the query again, so offering it would be circular. */
export function sameAsQuery(c: QueryCandidate, query: string): boolean {
  const q = fold(query);
  return q === fold(candidateQuery(c)) || q === fold(c.title) || q === fold(`${c.title} ${c.artist ?? ''}`);
}

/** Tokens the query shares with a candidate, with the typo tolerance of the catalog lookup ("yesturday" ~ "yesterday"). */
export function overlap(query: string, c: QueryCandidate): number {
  const q = normalizeQuery(query).significant;
  const have = tokensOf(`${c.title} ${c.artist ?? ''}`);
  return q.filter((t) => have.some((h) => t === h || (t.length >= 5 && editDistance(t, h) <= 1) || (t.length >= 8 && editDistance(t, h) <= 2))).length;
}

/**
 * Order raw candidates by how many query words they explain, drop duplicates, and when the
 * best one explains every word keep only the ones that do: "yesturday beetles" should not
 * come back with nine Beatles songs. Otherwise anything that explains at least one word stays.
 */
export function rankCandidates(raw: QueryCandidate[], query: string): QueryCandidate[] {
  const total = normalizeQuery(query).significant.length;
  const seen = new Set<string>();
  const scored: { c: QueryCandidate; n: number; len: number }[] = [];
  for (const c of raw) {
    if (!c.title.trim()) continue;
    const key = `${fold(c.title)}|${fold(c.artist ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ c, n: overlap(query, c), len: tokensOf(`${c.title} ${c.artist ?? ''}`).length });
  }
  const best = Math.max(0, ...scored.map((s) => s.n));
  const floor = best > 0 && best >= total ? best : best > 0 ? 1 : 0;
  // Ties go to the shorter candidate: the same two words explain more of "Interstellar" than of "Another Sad Love Song".
  return scored.filter((s) => s.n >= floor).sort((a, b) => b.n - a.n || a.len - b.len).map((s) => s.c).slice(0, MAX_CANDIDATES);
}

// ───────────────────────── iTunes ─────────────────────────

/** "Yesterday (Remastered 2009)" → "Yesterday"; "Let It Be - Single Version" → "Let It Be". */
export function cleanTrackTitle(name: string): string {
  return cleanFileName(name).replace(/\s+-\s+(?:remaster|live|single|mono|stereo|version|edit|demo|radio|acoustic|instrumental|from|feat|bonus|deluxe|edition)\b.*$/i, '').trim();
}

export function candidatesFromItunes(json: unknown): QueryCandidate[] {
  const results = (json as { results?: unknown[] })?.results ?? [];
  const out: QueryCandidate[] = [];
  for (const r of results as { kind?: string; trackName?: string; artistName?: string }[]) {
    if (r.kind && r.kind !== 'song') continue;
    if (typeof r.trackName !== 'string') continue;
    const title = cleanTrackTitle(r.trackName);
    if (title) out.push({ title, artist: typeof r.artistName === 'string' ? r.artistName : undefined, source: 'itunes' });
  }
  return out;
}

export async function lookupItunes(query: string, signal?: AbortSignal): Promise<QueryCandidate[]> {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`iTunes lookup failed: HTTP ${res.status}`);
  return rankCandidates(candidatesFromItunes(await res.json()), query);
}

// ───────────────────────── MusicBrainz ─────────────────────────

/** Lucene query with a fuzzy term per word; a "title - artist" or "title by artist" split gets its own fields. */
export function musicBrainzQuery(query: string): string {
  const q = normalizeQuery(query);
  const by = /^(.+?)\s+by\s+(.+)$/i.exec(query.trim());
  const title = q.title ?? (by ? fold(by[1]) : undefined);
  const artist = q.artist ?? (by ? fold(by[2]) : undefined);
  const fuzzy = (s: string) => tokensOf(s).map((t) => `${t}~`).join(' ');
  if (title && artist) return `recording:(${fuzzy(title)}) AND artist:(${fuzzy(artist)})`;
  return `recording:(${fuzzy(q.folded)})`;
}

export function candidatesFromMusicBrainz(json: unknown): QueryCandidate[] {
  const recs = (json as { recordings?: unknown[] })?.recordings ?? [];
  const out: QueryCandidate[] = [];
  for (const r of recs as { title?: string; 'artist-credit'?: { name?: string }[] }[]) {
    if (typeof r.title !== 'string') continue;
    const artist = (r['artist-credit'] ?? []).map((a) => a.name).filter((n): n is string => !!n).join(' & ') || undefined;
    out.push({ title: cleanTrackTitle(r.title), artist, source: 'musicbrainz' });
  }
  return out;
}

export async function lookupMusicBrainz(query: string, signal?: AbortSignal): Promise<QueryCandidate[]> {
  const url = `https://musicbrainz.org/ws/2/recording?fmt=json&limit=10&query=${encodeURIComponent(musicBrainzQuery(query))}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`MusicBrainz lookup failed: HTTP ${res.status}`);
  return rankCandidates(candidatesFromMusicBrainz(await res.json()), query);
}

/** iTunes first; MusicBrainz when iTunes fails or finds nothing. Throws only when both fail. */
export async function lookupCanonical(query: string, signal?: AbortSignal): Promise<QueryCandidate[]> {
  let firstError: unknown;
  try {
    const hits = await lookupItunes(query, signal);
    if (hits.length) return hits;
  } catch (err) { if (signal?.aborted) throw err; firstError = err; }
  try {
    return await lookupMusicBrainz(query, signal);
  } catch (err) { throw firstError ?? err; }
}
