import type { Hand, Level, Note } from '../types';

/**
 * Personal hand constraints: the keyboard the learner actually owns and how far one hand
 * can stretch. A post-pass on each stage, before fingering: whole hands move by octaves to
 * fit the keyboard, stray notes fold in, and chords wider than the span are revoiced by
 * moving their outer note an octave inward or dropping it. Nothing here changes rhythm.
 */

export type KeyboardSize = 25 | 49 | 61 | 76 | 88;

export interface HandConstraints {
  keys: KeyboardSize;
  /** Largest interval one hand plays at once, in semitones: 12 an octave, 10 a seventh, 9 a sixth. */
  span: number;
}

/** MIDI range of common keyboards, lowest and highest key. */
export const KEYBOARDS: Record<KeyboardSize, { lo: number; hi: number; name: string }> = {
  25: { lo: 48, hi: 72, name: '25 keys (C3–C5)' },
  49: { lo: 36, hi: 84, name: '49 keys (C2–C6)' },
  61: { lo: 36, hi: 96, name: '61 keys (C2–C7)' },
  76: { lo: 28, hi: 103, name: '76 keys (E1–G7)' },
  88: { lo: 21, hi: 108, name: '88 keys (A0–C8)' },
};

export const SPANS: { value: number; name: string }[] = [
  { value: 12, name: 'Octave (average adult)' },
  { value: 10, name: 'Seventh (small hands)' },
  { value: 9, name: 'Sixth (child)' },
];

export const DEFAULT_CONSTRAINTS: HandConstraints = { keys: 88, span: 12 };

const STORAGE = 'psg.hands';

export function loadConstraints(): HandConstraints {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return DEFAULT_CONSTRAINTS;
    const p = JSON.parse(raw) as Partial<HandConstraints>;
    const keys = (p.keys && p.keys in KEYBOARDS ? p.keys : 88) as KeyboardSize;
    const span = typeof p.span === 'number' && p.span >= 5 && p.span <= 24 ? p.span : 12;
    return { keys, span };
  } catch { return DEFAULT_CONSTRAINTS; }
}

export function saveConstraints(c: HandConstraints): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(c)); } catch { /* private mode */ }
}

export function isDefault(c: HandConstraints): boolean {
  return c.keys === DEFAULT_CONSTRAINTS.keys && c.span === DEFAULT_CONSTRAINTS.span;
}

export interface ConstraintReport { moved: number; folded: number; revoiced: number; dropped: number }

/** Apply the constraints to one stage's notes in place. Returns what changed, for the song bar. */
export function applyConstraints(level: Level, c: HandConstraints): ConstraintReport {
  const report: ConstraintReport = { moved: 0, folded: 0, revoiced: 0, dropped: 0 };
  const { lo, hi } = KEYBOARDS[c.keys];
  for (const hand of ['rh', 'lh'] as const) {
    const hn = level.notes.filter((n) => n.hand === hand);
    if (hn.length === 0) continue;
    // 1. Move the whole hand by octaves when it fits but sits outside.
    const min = Math.min(...hn.map((n) => n.midi)), max = Math.max(...hn.map((n) => n.midi));
    let shift = 0;
    if (max - min <= hi - lo) {
      while (min + shift < lo) shift += 12;
      while (max + shift > hi) shift -= 12;
    }
    if (shift !== 0) { for (const n of hn) n.midi += shift; report.moved += hn.length; }
    // 2. Fold whatever is still outside, note by note.
    for (const n of hn) {
      const before = n.midi;
      while (n.midi < lo) n.midi += 12;
      while (n.midi > hi) n.midi -= 12;
      if (n.midi !== before) report.folded++;
    }
  }
  // 3. Chords wider than the span: bring the outer note an octave inward, or drop it.
  const drop = new Set<Note>();
  for (const group of onsetGroups(level.notes)) {
    for (const hand of ['rh', 'lh'] as const) {
      let ns = group.filter((n) => n.hand === hand && !drop.has(n));
      let guard = 8;
      while (ns.length > 1 && guard-- > 0) {
        const sorted = [...ns].sort((a, b) => a.midi - b.midi);
        const width = sorted[sorted.length - 1].midi - sorted[0].midi;
        if (width <= c.span) break;
        // The left hand keeps its bass note and folds the top; the right hand keeps the melody on top and folds the bottom.
        const outer = hand === 'lh' ? sorted[sorted.length - 1] : sorted[0];
        const target = hand === 'lh' ? outer.midi - 12 : outer.midi + 12;
        const inside = hand === 'lh' ? target > sorted[0].midi : target < sorted[sorted.length - 1].midi;
        if (inside && !sorted.some((n) => n.midi === target) && target >= lo && target <= hi) { outer.midi = target; report.revoiced++; }
        else { drop.add(outer); report.dropped++; }
        ns = ns.filter((n) => !drop.has(n));
      }
    }
  }
  if (drop.size) level.notes = level.notes.filter((n) => !drop.has(n));
  level.notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  return report;
}

function onsetGroups(notes: Note[]): Note[][] {
  const out: Note[][] = [];
  let cur: Note[] = [];
  for (const n of [...notes].sort((a, b) => a.startBeat - b.startBeat)) {
    if (cur.length && n.startBeat - cur[0].startBeat >= 0.06) { out.push(cur); cur = []; }
    cur.push(n);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function describeReport(r: ConstraintReport, c: HandConstraints): string {
  const bits: string[] = [];
  if (r.moved || r.folded) bits.push(`${r.moved + r.folded} notes moved into ${c.keys} keys`);
  if (r.revoiced || r.dropped) bits.push(`${r.revoiced + r.dropped} chord notes ${r.dropped ? 'revoiced or dropped' : 'revoiced'} for a ${c.span === 12 ? 'one-octave' : c.span === 10 ? 'seventh' : 'sixth'} span`);
  return bits.join(', ');
}

export function handOf(n: Note): Hand { return n.hand; }
