import type { Chord, KeyInfo, RawNote } from '../types';
import { chordName, voiceChord } from './chords';
import { isBlackKey, makeKey } from './theory';

/**
 * Pick the transposition that puts the fewest notes on black keys, so beginner
 * stages can be learned on white keys. Ties go to the smallest shift, and the
 * original key wins unless a shift removes at least a tenth of the black keys.
 */
export function easyTransposition(notes: { midi: number; durationBeats: number }[], key: KeyInfo): { semitones: number; key: KeyInfo } {
  if (notes.length === 0) return { semitones: 0, key };
  const cost = (shift: number) => notes.reduce((s, n) => s + (isBlackKey(n.midi + shift) ? Math.max(n.durationBeats, 0.25) : 0), 0);
  const base = cost(0);
  let best = 0, bestCost = base;
  for (let shift = -6; shift <= 5; shift++) {
    if (shift === 0) continue;
    const c = cost(shift);
    if (c < bestCost - 1e-9 || (Math.abs(c - bestCost) < 1e-9 && Math.abs(shift) < Math.abs(best))) { best = shift; bestCost = c; }
  }
  if (best === 0 || bestCost > base * 0.9) return { semitones: 0, key };
  return { semitones: best, key: makeKey(((key.tonic + best) % 12 + 12) % 12, key.mode) };
}

export function transposeNotes<T extends RawNote>(notes: T[], semitones: number): T[] {
  if (semitones === 0) return notes;
  return notes.map((n) => ({ ...n, midi: n.midi + semitones }));
}

/** Shift chord roots and rename them in the new key. Voicings are rebuilt in the left-hand range. */
export function transposeChords(chords: Chord[], semitones: number, key: KeyInfo): Chord[] {
  if (semitones === 0) return chords;
  return chords.map((c) => {
    const root = ((c.root + semitones) % 12 + 12) % 12;
    return { ...c, root, name: chordName(root, c.quality, key), pitches: voiceChord(root, c.quality) };
  });
}
