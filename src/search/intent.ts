import type { SongGroup } from './rank';
import { WEIGHTS } from './rank';
import { normalizeQuery } from './normalize';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — when should search ask for help instead of trusting the results?
 *
 *  Two questions, two knobs:
 *
 *  1. Does the query read as a description rather than a title? ("that sad piano song
 *     from Interstellar", "the Beatles one that goes let it be"). When it does and a
 *     Claude key is set, the model is asked to name the song in parallel with the MIDI
 *     search. Cue words are the signal: title-like phrases rarely contain "that", "goes"
 *     or "song"; long queries and questions count too. "I Want to Hold Your Hand" is six
 *     words and has no cue word, so it stays a title.
 *
 *  2. Are the results weak enough to offer a "did you mean"? No result at all, or the best
 *     card matched neither the whole title nor the query as a phrase. Tune `weakScore`
 *     against rank.ts WEIGHTS: a phrase hit scores 5, coverage alone tops out at 3.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const INTENT = {
  cueWords: ['that', 'this', 'which', 'what', 'goes', 'song', 'tune', 'piece', 'theme', 'sounds', 'like', 'movie', 'film', 'show', 'game', 'one', 'about', 'lyrics', 'called', 'something', 'remember', 'know', 'the one', 'from the'],
  minWordsForProse: 7,
  weakScore: WEIGHTS.phrase,
};

export function looksLikeProse(query: string): boolean {
  const q = normalizeQuery(query);
  if (q.tokens.length < 3) return false;
  if (q.tokens.length >= INTENT.minWordsForProse) return true;
  if (/\?\s*$/.test(query.trim())) return true;
  const padded = ` ${q.folded} `;
  return INTENT.cueWords.some((w) => padded.includes(` ${w} `));
}

/** Empty results, or a best card that only shares a few words with the query. */
export function resultsAreWeak(groups: SongGroup[]): boolean {
  if (groups.length === 0) return true;
  return groups[0].score < INTENT.weakScore;
}
