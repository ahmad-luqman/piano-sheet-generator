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

// ───────────────────────── theory on demand (rule-based) ─────────────────────────

const MAJOR_DEGREES: [number, string][] = [[0, 'I'], [2, 'ii'], [4, 'iii'], [5, 'IV'], [7, 'V'], [9, 'vi'], [11, 'vii°']];
const MINOR_DEGREES: [number, string][] = [[0, 'i'], [2, 'ii°'], [3, 'III'], [5, 'iv'], [7, 'v'], [8, 'VI'], [10, 'VII']];
const QUALITY_INTERVALS: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
};

/** Roman numeral of a chord in the key, or undefined when its root is outside the scale. */
export function romanNumeral(root: number, quality: string, key: KeyInfo): string | undefined {
  const degrees = key.mode === 'major' ? MAJOR_DEGREES : MINOR_DEGREES;
  const offset = ((root - key.tonic) % 12 + 12) % 12;
  const hit = degrees.find(([o]) => o === offset);
  if (!hit) return undefined;
  const base = hit[1].replace('°', '');
  const minorish = quality === 'min' || quality === 'min7' || quality === 'dim';
  let numeral = minorish ? base.toLowerCase() : base.toUpperCase();
  if (quality === 'dim') numeral += '°';
  if (quality === 'aug') numeral += '+';
  if (quality === '7' || quality === 'min7' || quality === 'maj7') numeral += '7';
  return numeral;
}

/**
 * Fallback for "why this chord here?": the chord tones, its degree in the key, and which
 * melody notes in the bar belong to it. Pure text, no model.
 */
export function explainChordRuleBased(
  level: { key: KeyInfo; notes: { midi: number; hand: string; startBeat: number; letter: string }[] },
  chord: { root: number; quality: string; name: string }, bar: number, beatsPerBar: number,
): string {
  const key = level.key;
  const names = key.useFlats ? PC_NAMES_FLAT : PC_NAMES_SHARP;
  const intervals = QUALITY_INTERVALS[chord.quality] ?? [0, 4, 7];
  const tonePcs = new Set(intervals.map((iv) => (chord.root + iv) % 12));
  const tones = [...tonePcs].map((pc) => names[pc]).join(' ');
  const numeral = romanNumeral(chord.root, chord.quality, key);
  const a = bar * beatsPerBar, b = a + beatsPerBar;
  const melody = level.notes.filter((n) => n.hand === 'rh' && n.startBeat >= a && n.startBeat < b);
  const letters = [...new Set(melody.map((n) => n.letter))];
  let text = `${chord.name} is ${tones}${numeral ? `, the ${numeral} chord in ${key.name}` : `, a chord from outside ${key.name}`}.`;
  if (letters.length === 0) return `${text} No melody note starts in bar ${bar + 1}.`;
  const inChord = letters.filter((l) => tonePcs.has(pitchClass(nameToPc(l))));
  const passing = letters.filter((l) => !inChord.includes(l));
  text += ` In bar ${bar + 1} the melody plays ${letters.join(' ')}: ${inChord.length} of ${letters.length} ${inChord.length === 1 ? 'is a chord tone' : 'are chord tones'}`;
  text += passing.length ? `, and ${passing.join(', ')} ${passing.length === 1 ? 'is a passing note' : 'are passing notes'}.` : '.';
  return text;
}

function nameToPc(letter: string): number {
  const i = PC_NAMES_SHARP.indexOf(letter);
  return i >= 0 ? i : Math.max(0, PC_NAMES_FLAT.indexOf(letter));
}
