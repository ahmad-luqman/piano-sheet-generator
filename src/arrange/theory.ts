import type { KeyInfo } from '../types';

export const PC_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PC_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Number of sharps (+) or flats (-) in the key signature, indexed by major tonic pitch class. */
const MAJOR_SHARPS: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

export function makeKey(tonic: number, mode: 'major' | 'minor'): KeyInfo {
  const majorTonic = mode === 'major' ? tonic : (tonic + 3) % 12;
  const sharps = MAJOR_SHARPS[majorTonic] ?? 0;
  const useFlats = sharps < 0;
  const names = useFlats ? PC_NAMES_FLAT : PC_NAMES_SHARP;
  return { tonic, mode, sharps, useFlats, name: `${names[tonic]} ${mode}` };
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** Scientific octave: C4 = 60. */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function spell(midi: number, key: KeyInfo): { letter: string; octave: number } {
  const names = key.useFlats ? PC_NAMES_FLAT : PC_NAMES_SHARP;
  return { letter: names[pitchClass(midi)], octave: octaveOf(midi) };
}

export function midiToName(midi: number, useFlats = false): string {
  const names = useFlats ? PC_NAMES_FLAT : PC_NAMES_SHARP;
  return `${names[pitchClass(midi)]}${octaveOf(midi)}`;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(midi));
}

/** Krumhansl–Schmuckler key profiles. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** Detect the key from a duration-weighted pitch-class histogram. */
export function detectKey(notes: { midi: number; durationBeats: number }[]): KeyInfo {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pitchClass(n.midi)] += Math.max(n.durationBeats, 0.1);
  let best = { score: -Infinity, tonic: 0, mode: 'major' as 'major' | 'minor' };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = hist.map((_, i) => hist[(i + tonic) % 12]);
    const sMaj = correlation(rotated, MAJOR_PROFILE);
    const sMin = correlation(rotated, MINOR_PROFILE);
    if (sMaj > best.score) best = { score: sMaj, tonic, mode: 'major' };
    if (sMin > best.score) best = { score: sMin, tonic, mode: 'minor' };
  }
  return makeKey(best.tonic, best.mode);
}

/** Quantize a beat position to a grid (e.g. 0.5 = eighth notes). */
export function quantize(beat: number, grid: number): number {
  return Math.round(beat / grid) * grid;
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
