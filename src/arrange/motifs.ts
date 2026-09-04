import type { Hand, Note } from '../types';

/**
 * Pattern-first learning: the melody's most repeated motif and the left hand's few
 * recurring shapes. A motif is an interval-and-rhythm n-gram, so a repeat that starts on
 * a different note still counts. Shapes are the interval stacks the left hand plays at
 * once. Both are pure functions over one stage's notes, used by the how-to-play steps.
 */

export interface MotifOccurrence { bar: number; startBeat: number; endBeat: number; midi: number; transposed: boolean }

export interface Motif {
  hand: Hand;
  length: number;                // notes
  letters: string;               // "E D C D E E E" of the first occurrence
  occurrences: MotifOccurrence[];
  coverage: number;              // fraction of the hand's onsets inside an occurrence
}

export interface Shape {
  key: string;                   // "0,4,7"
  name: string;                  // "major triad"
  count: number;                 // onsets with this shape
  share: number;                 // of all left-hand onsets
  bars: number[];                // first few bars where it appears (0-based)
}

export const MOTIF = {
  minLength: 4,
  maxLength: 10,
  minOccurrences: 2,
  /** Rhythm is compared at this resolution, in beats. */
  grid: 0.25,
  /** Notes closer than this start together; the top note represents the onset. */
  onsetTol: 0.06,
};

interface Onset { beat: number; midi: number; letter: string; notes: Note[] }

function onsets(notes: Note[], hand: Hand): Onset[] {
  const out: Onset[] = [];
  for (const n of [...notes].filter((x) => x.hand === hand).sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi)) {
    const cur = out[out.length - 1];
    if (cur && n.startBeat - cur.beat < MOTIF.onsetTol) { cur.notes.push(n); continue; }
    out.push({ beat: n.startBeat, midi: n.midi, letter: n.letter, notes: [n] });
  }
  return out;
}

/** Most repeated interval-and-rhythm n-gram of one hand's top voice; undefined when nothing repeats. */
export function findMotif(notes: Note[], beatsPerBar: number, hand: Hand = 'rh'): Motif | undefined {
  const seq = onsets(notes, hand);
  if (seq.length < MOTIF.minLength * 2) return undefined;
  const q = (x: number) => Math.round(x / MOTIF.grid);
  const keyAt = (i: number, n: number): string | undefined => {
    if (i + n > seq.length) return undefined;
    const parts: string[] = [];
    for (let j = i + 1; j < i + n; j++) parts.push(`${seq[j].midi - seq[j - 1].midi}/${q(seq[j].beat - seq[j - 1].beat)}`);
    return parts.join(' ');
  };
  let best: { n: number; starts: number[]; covered: number } | undefined;
  for (let n = MOTIF.minLength; n <= Math.min(MOTIF.maxLength, Math.floor(seq.length / 2)); n++) {
    const byKey = new Map<string, number[]>();
    for (let i = 0; i + n <= seq.length; i++) { const k = keyAt(i, n)!; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(i); }
    for (const starts of byKey.values()) {
      // Non-overlapping occurrences, greedy from the left.
      const kept: number[] = [];
      for (const s of starts) if (kept.length === 0 || s >= kept[kept.length - 1] + n) kept.push(s);
      if (kept.length < MOTIF.minOccurrences) continue;
      const covered = kept.length * n;
      if (!best || covered > best.covered || (covered === best.covered && n > best.n)) best = { n, starts: kept, covered };
    }
  }
  if (!best) return undefined;
  const first = seq[best.starts[0]];
  const occurrences: MotifOccurrence[] = best.starts.map((s) => {
    const last = seq[s + best!.n - 1];
    return { bar: Math.floor(seq[s].beat / beatsPerBar), startBeat: seq[s].beat, endBeat: last.beat + Math.max(...last.notes.map((x) => x.durationBeats)), midi: seq[s].midi, transposed: seq[s].midi !== first.midi };
  });
  return {
    hand, length: best.n,
    letters: seq.slice(best.starts[0], best.starts[0] + best.n).map((o) => o.letter).join(' '),
    occurrences, coverage: best.covered / seq.length,
  };
}

const SHAPE_NAMES: Record<string, string> = {
  '0': 'a single bass note', '0,12': 'an octave', '0,7': 'root and fifth', '0,5': 'root and fourth', '0,7,12': 'root, fifth and octave',
  '0,4,7': 'a major triad', '0,3,7': 'a minor triad', '0,3,6': 'a diminished triad', '0,4,8': 'an augmented triad',
  '0,4,7,10': 'a dominant seventh', '0,4,7,11': 'a major seventh', '0,3,7,10': 'a minor seventh',
  '0,3,8': 'a major triad, first inversion', '0,5,9': 'a major triad, second inversion', '0,4,9': 'a minor triad, first inversion', '0,5,8': 'a minor triad, second inversion',
};

/** The left hand's recurring interval stacks, most common first. */
export function findShapes(notes: Note[], beatsPerBar: number, hand: Hand = 'lh', max = 3): Shape[] {
  const seq = onsets(notes, hand);
  if (seq.length === 0) return [];
  const byKey = new Map<string, { count: number; bars: number[] }>();
  for (const o of seq) {
    const ps = [...new Set(o.notes.map((n) => n.midi))].sort((a, b) => a - b);
    const key = ps.map((p) => p - ps[0]).join(',');
    const e = byKey.get(key) ?? { count: 0, bars: [] };
    e.count++;
    const bar = Math.floor(o.beat / beatsPerBar);
    if (!e.bars.includes(bar)) e.bars.push(bar);
    byKey.set(key, e);
  }
  return [...byKey.entries()]
    .map(([key, e]) => ({ key, name: SHAPE_NAMES[key] ?? describeShape(key), count: e.count, share: e.count / seq.length, bars: e.bars.slice(0, 4) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

function describeShape(key: string): string {
  const iv = key.split(',').map(Number);
  return `a ${iv.length}-note chord spanning ${iv[iv.length - 1]} semitones`;
}
