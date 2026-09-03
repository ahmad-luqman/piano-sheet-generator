/**
 * Turn the messy names that MIDI sites use into something comparable.
 *
 *   "THE BEATLES.Let it be K.mid"                           → title "let it be",  artist "the beatles"
 *   "Baby D - Let Me Be Your Fantasy (Rank 1 Remix).mid"    → title "let me be your fantasy", artist "baby d"
 *   "Let-It-Be-3.mid" / "let_it_be.mid" / "Let It Be.mid"   → title "let it be"
 *   "Let It Snow! (1DX Only) (Xmas) (Seq Harry Todd) letitsnow_ht.mid" → title "let it snow"
 *
 * Everything here is pure string work so it can be unit-tested against fixtures.
 */

export interface NormalizedName {
  /** Lower-case, accent-folded, punctuation-free title. */
  title: string;
  /** Same treatment for the artist, when the name carried one. */
  artist?: string;
  /** Tokens of the title. */
  tokens: string[];
  /** Tokens of title and artist together. */
  allTokens: string[];
}

/** Lower-case, fold accents, collapse punctuation into spaces, squeeze whitespace. */
export function fold(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/['’`]/g, '')                       // don't → dont, so both spellings match
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokensOf(s: string): string[] {
  return fold(s).split(' ').filter(Boolean);
}

const EXT_RE = /\.(mid|midi|kar|rmi)$/i;
// Sequencer credits and format tags that bitmidi uploaders put in brackets.
const BRACKET_RE = /\s*[([{][^)\]}]*[)\]}]/g;
// "K" and "k" are karaoke markers on a large batch of uploads: "Let it be K.mid".
const TRAILING_K_RE = /\s+k$/i;
// Version suffixes: "-1", " 2", "v2", "(2)", "_ht" (sequencer initials), "part1".
const VERSION_RE = /[\s_-]+(?:v|ver|version|part|pt)?\s*\d{1,2}$/i;
// Sequencer tags glued to the end after a space: "letitsnow_ht", "S1006_10".
const GLUED_TAG_RE = /\s+[a-z0-9]*_[a-z0-9_]*$/i;

/** Strip the extension, bracketed metadata, karaoke flags and version suffixes from a raw file name. */
export function cleanFileName(raw: string): string {
  let s = raw.trim().replace(EXT_RE, '');
  s = s.replace(BRACKET_RE, ' ');
  s = s.replace(GLUED_TAG_RE, '');
  s = s.replace(TRAILING_K_RE, '');
  // "No. 25" / "Opus.82" are part of a title; only strip a trailing number when it follows a separator
  // and the preceding word is not a numbering word.
  const m = VERSION_RE.exec(s);
  if (m && !/(no|op|opus|nr|number|vol|book|bwv|k|kv|hob|d)\.?\s*$/i.test(s.slice(0, m.index))) {
    s = s.slice(0, m.index);
  }
  return s.trim();
}

/**
 * Split "ARTIST.Title", "Artist - Title" and "artist-title_with_underscores" into parts.
 * Returns the parts still raw (not folded) so the caller can choose how to normalize.
 */
export function splitArtistTitle(name: string): { title: string; artist?: string } {
  // "THE BEATLES.Let it be" — upper-case artist ending in a dot, first letter of the title anything.
  let m = /^([A-Z][A-Z0-9 .&'’-]{1,40})\.(?=[A-Za-z0-9(])(.+)$/.exec(name);
  if (m && /[A-Z]{2}/.test(m[1]) && m[1] === m[1].toUpperCase()) return { artist: m[1].replace(/\.$/, ''), title: m[2] };
  // "Baby D - Let Me Be Your Fantasy"; "Peat Jr & Fernando - Let It Be Love"
  m = /^(.+?)[\s_]+[-–—][\s_]+(.+)$/.exec(name);
  if (m) return { artist: m[1], title: m[2] };
  // "beatles-let_it_be": single word, hyphen, then an underscore-joined title.
  m = /^([a-z0-9]+)-([a-z0-9_]+)$/i.exec(name);
  if (m && m[2].includes('_')) return { artist: m[1], title: m[2] };
  return { title: name };
}

/** Full normalization of a raw file name or display name. */
export function normalizeName(raw: string): NormalizedName {
  const cleaned = cleanFileName(raw);
  const { title, artist } = splitArtistTitle(cleaned);
  const t = fold(title);
  const a = artist ? fold(artist) : undefined;
  const tokens = t ? t.split(' ') : [];
  return { title: t, artist: a || undefined, tokens, allTokens: a ? [...tokens, ...a.split(' ')] : tokens };
}

/** Words that carry no signal on their own for a MIDI-site token search. */
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'by', 'from', 'with', 'it', 'is', 'be', 'me', 'my', 'you', 'your', 'i']);

export interface NormalizedQuery {
  folded: string;
  tokens: string[];
  /** Tokens minus stopwords; falls back to all tokens when that would drop most of the query. */
  significant: string[];
  /** When the user typed "title - artist" or "title by artist", the split parts. */
  title?: string;
  artist?: string;
}

export function normalizeQuery(q: string): NormalizedQuery {
  const raw = q.trim();
  let title: string | undefined;
  let artist: string | undefined;
  let m = /^(.+?)\s+(?:by|-|–|—)\s+(.+)$/i.exec(raw);
  if (m) { title = fold(m[1]); artist = fold(m[2]); }
  const folded = fold(raw);
  const tokens = folded ? folded.split(' ') : [];
  // Stopwords go, unless that would drop more than half the query ("let it be" → "let" is worse, not better).
  const sig = tokens.filter((t) => !STOPWORDS.has(t));
  const significant = sig.length && sig.length >= tokens.length / 2 ? sig : tokens;
  return { folded, tokens, significant, title, artist };
}

/** Key used to group different uploads of the same song: the normalized title alone. */
export function songKey(n: NormalizedName): string {
  return n.title;
}
