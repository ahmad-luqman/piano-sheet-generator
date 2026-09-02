import type { Note } from '../types';
import { isBlackKey } from './theory';

/** Count white keys between two midi notes (used as a rough "finger distance"). */
function whiteKeysBetween(a: number, b: number): number {
  let count = 0;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let m = lo + 1; m <= hi; m++) if (!isBlackKey(m)) count++;
  return count;
}

/**
 * Five-finger-position heuristic. For each phrase (notes separated by a rest of
 * a beat or more, or exceeding a sixth in range) the hand is placed so that the
 * lowest note is under the thumb (RH) or the highest note is under the thumb (LH),
 * and other notes get the finger that many white keys away, clamped to 1..5.
 * These are suggestions for absolute beginners, not authoritative fingering.
 */
export function suggestFingers(notes: Note[]): void {
  for (const hand of ['rh', 'lh'] as const) {
    const hn = notes.filter((n) => n.hand === hand).sort((a, b) => a.startBeat - b.startBeat);
    // Only finger single-voice lines; chords get 1-3-5 / 5-3-1.
    const onsets = new Map<number, Note[]>();
    for (const n of hn) {
      const k = Math.round(n.startBeat * 100);
      if (!onsets.has(k)) onsets.set(k, []);
      onsets.get(k)!.push(n);
    }
    const groups = [...onsets.values()];
    let phrase: Note[] = [];
    const flush = () => {
      if (phrase.length === 0) return;
      const pitches = phrase.map((n) => n.midi);
      const anchor = hand === 'rh' ? Math.min(...pitches) : Math.max(...pitches);
      for (const n of phrase) {
        const dist = whiteKeysBetween(anchor, n.midi);
        n.finger = Math.min(5, 1 + dist);
      }
      phrase = [];
    };
    let lastEnd = -Infinity;
    for (const g of groups) {
      if (g.length > 1) {
        flush();
        const sorted = [...g].sort((a, b) => a.midi - b.midi);
        const fingers = sorted.length === 2 ? [1, 5] : sorted.length === 3 ? [1, 3, 5] : [1, 2, 3, 5, 5];
        sorted.forEach((n, i) => { n.finger = hand === 'rh' ? fingers[Math.min(i, fingers.length - 1)] : fingers[Math.min(sorted.length - 1 - i, fingers.length - 1)]; });
        lastEnd = g[0].startBeat + g[0].durationBeats;
        continue;
      }
      const n = g[0];
      const candidate = [...phrase, n].map((x) => x.midi);
      const span = whiteKeysBetween(Math.min(...candidate), Math.max(...candidate));
      if (n.startBeat - lastEnd >= 1 || span > 5) flush();
      phrase.push(n);
      lastEnd = n.startBeat + n.durationBeats;
    }
    flush();
  }
}
