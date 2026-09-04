import type { RawNote, Song } from '../types';
import { inferBeatsPerBar, songFromNotes } from '../midi/parse';

/**
 * From detected notes in seconds to a Song in beats. Pure, so the tempo estimate and the
 * clean-up can be tested without a browser; the model itself runs in input/audio.ts.
 */

export interface DetectedNote { start: number; duration: number; midi: number; amplitude: number }

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — what counts as a note, and how fast can a song be?
 *
 *  A transcription of a full mix is noisy: drums leak in as very short low notes,
 *  reverb tails as quiet ones. Notes shorter than `minDurationSec` or quieter than
 *  `amplitudeFloor` of the loudest note go. The tempo is the strongest period in the
 *  onset autocorrelation between `bpmMin` and `bpmMax`; halving or doubling it is a
 *  judgment call (a slow ballad at 70 reads the same as 140 with a note per beat).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const TRANSCRIBE = {
  minDurationSec: 0.06,
  amplitudeFloor: 0.15,
  bpmMin: 70,
  bpmMax: 160,
  lowest: 28,     // E1: below this the model is reading kick drum and bass rumble
  highest: 100,   // E7
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
};

export function cleanNotes(notes: DetectedNote[]): DetectedNote[] {
  const peak = Math.max(0, ...notes.map((n) => n.amplitude));
  return notes
    .filter((n) => n.duration >= TRANSCRIBE.minDurationSec && n.amplitude >= peak * TRANSCRIBE.amplitudeFloor && n.midi >= TRANSCRIBE.lowest && n.midi <= TRANSCRIBE.highest)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/** Beats per minute from the onset autocorrelation at 10 ms resolution; 100 when there is too little to go on. */
export function estimateTempo(notes: { start: number; amplitude: number }[]): number {
  const onsets = [...new Set(notes.map((n) => Math.round(n.start * 100)))].sort((a, b) => a - b);
  if (onsets.length < 4) return 100;
  const len = onsets[onsets.length - 1] + 1;
  const s = new Float32Array(len);
  for (const n of notes) { const i = Math.round(n.start * 100); s[i] = Math.max(s[i], n.amplitude); }
  const minLag = Math.round(6000 / TRANSCRIBE.bpmMax), maxLag = Math.round(6000 / TRANSCRIBE.bpmMin);
  let bestLag = 0, best = -1;
  for (let lag = minLag; lag <= maxLag && lag < len; lag++) {
    let r = 0;
    for (let t = 0; t + lag < len; t++) r += s[t] * s[t + lag];
    // A hair of preference for shorter lags breaks the tie between a period and its double.
    r *= 1 + (maxLag - lag) / maxLag * 0.05;
    if (r > best) { best = r; bestLag = lag; }
  }
  if (bestLag === 0) return 100;
  return Math.round(6000 / bestLag);
}

const METERS: Record<number, { num: number; den: number }> = { 1.5: { num: 3, den: 8 }, 2: { num: 2, den: 4 }, 3: { num: 3, den: 4 }, 4: { num: 4, den: 4 } };

/** One-track Song in beats. The first note lands on beat 0 so a clip that starts mid-phrase still begins on a bar. */
export function notesToSong(notes: DetectedNote[], bpm: number, title: string, source: string): Song {
  if (notes.length === 0) throw new Error('No notes were heard. Try a clearer recording or a different part of the song.');
  const t0 = notes[0].start;
  const toBeat = (sec: number) => (sec - t0) * bpm / 60;
  const raw: RawNote[] = notes.map((n) => ({ midi: n.midi, startBeat: round3(toBeat(n.start)), durationBeats: Math.max(0.125, round3(n.duration * bpm / 60)), velocity: Math.min(1, Math.max(0.2, n.amplitude)), track: 0 }));
  const bpb = inferBeatsPerBar(raw);
  return songFromNotes(title, raw, bpm, METERS[bpb] ?? { num: 4, den: 4 }, source);
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
