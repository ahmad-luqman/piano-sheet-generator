import type { Hand } from '../types';

/**
 * Difficulty fingerprint: six separate sub-scores, not one badge.
 *
 * Pure function over a note list so it can describe a raw MIDI upload (Phase B,
 * "which version is the clean piano one?") or a generated level (Phase D, "is this
 * arrangement ready for this learner?"). Each metric keeps its raw value in a human
 * unit next to a 0..1 score where 1 is hardest.
 */

export interface FingerprintNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  hand?: Hand;
}

export interface Metric {
  value: number;
  unit: string;
  /** 0 = trivial, 1 = beyond a beginner. Clamped. */
  score: number;
}

export interface DifficultyFingerprint {
  /** Onsets per second across both hands; a chord counts once, its spread shows up in `stretch`. */
  density: Metric;
  /** Median gap between successive onsets, in seconds. Shorter is harder. */
  ioi: Metric;
  /** Semitones from lowest to highest note. */
  range: Metric;
  /** Largest interval played at once within one hand, in semitones. */
  stretch: Metric;
  /** Median jump of a hand's centre between successive onsets, in semitones. */
  displacement: Metric;
  /** Beats per minute. */
  tempo: Metric;
  /** Mean of the six scores. */
  overall: number;
  noteCount: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — where does "easy" end and "hard" begin?
 *
 *  Each metric maps linearly from an easy value (score 0) to a hard value (score 1).
 *  The defaults are tuned so Twinkle and Mary Had a Little Lamb sit near 0.1–0.2 and
 *  Für Elise's opening around 0.4–0.5; a dense band arrangement pins several at 1.
 *  Change a pair here and every badge, sort and readiness check follows.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const THRESHOLDS = {
  density: { easy: 1, hard: 8 },         // onsets / second
  ioi: { easy: 0.6, hard: 0.12 },        // seconds (inverted: smaller is harder)
  range: { easy: 12, hard: 48 },         // semitones
  stretch: { easy: 5, hard: 14 },        // semitones within one hand at once
  displacement: { easy: 2, hard: 12 },   // semitones between successive onsets
  tempo: { easy: 60, hard: 180 },        // bpm
};

const ONSET_TOL = 0.06; // beats: notes closer than this start "together"

export function fingerprint(notes: FingerprintNote[], bpm: number): DifficultyFingerprint {
  const secPerBeat = 60 / Math.max(1, bpm);
  const n = notes.length;
  if (n === 0) {
    const zero = (unit: string): Metric => ({ value: 0, unit, score: 0 });
    return {
      density: zero('notes/s'), ioi: zero('s'), range: zero('semitones'), stretch: zero('semitones'),
      displacement: zero('semitones'), tempo: metric(bpm, 'bpm', THRESHOLDS.tempo), overall: 0, noteCount: 0,
    };
  }
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  const first = sorted[0].startBeat;
  const last = sorted.reduce((m, x) => Math.max(m, x.startBeat + x.durationBeats), 0);
  const seconds = Math.max(secPerBeat, (last - first) * secPerBeat);

  const onsets = groupOnsets(sorted);
  const iois = onsets.slice(1).map((o, i) => (o.beat - onsets[i].beat) * secPerBeat);

  const lo = Math.min(...sorted.map((x) => x.midi));
  const hi = Math.max(...sorted.map((x) => x.midi));

  let stretch = 0;
  const centres: Record<Hand, number[]> = { rh: [], lh: [] };
  for (const o of onsets) {
    for (const hand of ['rh', 'lh'] as const) {
      const ns = o.notes.filter((x) => handOf(x) === hand);
      if (ns.length === 0) continue;
      const ps = ns.map((x) => x.midi);
      stretch = Math.max(stretch, Math.max(...ps) - Math.min(...ps));
      centres[hand].push(ps.reduce((s, p) => s + p, 0) / ps.length);
    }
  }
  const jumps = [...centres.rh, ...centres.lh].length
    ? [...diffs(centres.rh), ...diffs(centres.lh)]
    : [];

  const fp = {
    density: metric(onsets.length / seconds, 'notes/s', THRESHOLDS.density),
    ioi: metric(iois.length ? median(iois) : seconds, 's', THRESHOLDS.ioi),
    range: metric(hi - lo, 'semitones', THRESHOLDS.range),
    stretch: metric(stretch, 'semitones', THRESHOLDS.stretch),
    displacement: metric(jumps.length ? median(jumps) : 0, 'semitones', THRESHOLDS.displacement),
    tempo: metric(bpm, 'bpm', THRESHOLDS.tempo),
  };
  const scores = Object.values(fp).map((m) => m.score);
  return { ...fp, overall: scores.reduce((s, x) => s + x, 0) / scores.length, noteCount: n };
}

/** Short labels for a badge row: only the metrics that say something. */
export function describeFingerprint(fp: DifficultyFingerprint): string[] {
  const out: string[] = [];
  const level = fp.overall < 0.25 ? 'beginner' : fp.overall < 0.5 ? 'easy' : fp.overall < 0.75 ? 'intermediate' : 'advanced';
  out.push(level);
  if (fp.density.score >= 0.6) out.push('dense');
  if (fp.ioi.score >= 0.6) out.push('fast notes');
  if (fp.range.score >= 0.6) out.push('wide range');
  if (fp.stretch.score >= 0.6) out.push('big stretches');
  if (fp.displacement.score >= 0.6) out.push('hand jumps');
  if (fp.tempo.score >= 0.7) out.push('fast tempo');
  return out;
}

export type MetricKey = 'density' | 'ioi' | 'range' | 'stretch' | 'displacement' | 'tempo';
/** Fixed order of the six metrics when a fingerprint is stored as a plain number list. */
export const METRIC_KEYS: readonly MetricKey[] = ['density', 'ioi', 'range', 'stretch', 'displacement', 'tempo'];
const UNITS: Record<MetricKey, string> = { density: 'notes/s', ioi: 's', range: 'semitones', stretch: 'semitones', displacement: 'semitones', tempo: 'bpm' };

/** The raw values in METRIC_KEYS order: what the catalog index and saved progress keep. */
export function fingerprintValues(fp: DifficultyFingerprint): number[] {
  return METRIC_KEYS.map((k) => fp[k].value);
}

/** Rebuild a fingerprint from stored values, scoring them against the current THRESHOLDS. */
export function fingerprintFromValues(values: number[], noteCount = 0): DifficultyFingerprint {
  const m = Object.fromEntries(METRIC_KEYS.map((k, i) => [k, metric(values[i] ?? 0, UNITS[k], THRESHOLDS[k])])) as Record<MetricKey, Metric>;
  const scores = METRIC_KEYS.map((k) => m[k].score);
  return { ...m, overall: scores.reduce((s, x) => s + x, 0) / scores.length, noteCount };
}

/** 0..1 score of one raw value on one metric. */
export function metricScore(key: MetricKey, value: number): number {
  return metric(value, UNITS[key], THRESHOLDS[key]).score;
}

function metric(value: number, unit: string, t: { easy: number; hard: number }): Metric {
  const raw = (value - t.easy) / (t.hard - t.easy);
  return { value: round2(value), unit, score: round2(Math.min(1, Math.max(0, raw))) };
}

function handOf(x: FingerprintNote): Hand {
  return x.hand ?? (x.midi < 60 ? 'lh' : 'rh');
}

function groupOnsets(sorted: FingerprintNote[]): { beat: number; notes: FingerprintNote[] }[] {
  const out: { beat: number; notes: FingerprintNote[] }[] = [];
  for (const x of sorted) {
    const cur = out[out.length - 1];
    if (cur && x.startBeat - cur.beat < ONSET_TOL) cur.notes.push(x);
    else out.push({ beat: x.startBeat, notes: [x] });
  }
  return out;
}

function diffs(xs: number[]): number[] {
  return xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
