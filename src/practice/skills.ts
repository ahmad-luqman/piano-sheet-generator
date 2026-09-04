import { METRIC_KEYS, metricScore, type MetricKey } from '../arrange/difficulty';
import type { SongProgress } from './progress';

/**
 * The learner's skill profile: per difficulty metric, the hardest value they have played
 * clean, across every song and stage saved in this browser. Everything here is a pure
 * function over stored numbers so "playable for you", the bridge song and the LLM
 * recommendation can share it and be tested with hand-built profiles.
 */

export interface SkillProfile {
  /** Hardest credited value per metric, METRIC_KEYS order; undefined until something was played clean. */
  values?: number[];
  /** Stages that contributed: clean, timed, whole-piece runs with a stored fingerprint. */
  credited: number;
}

export const METRIC_WORDS: Record<MetricKey, string> = {
  density: 'more notes at once',
  ioi: 'faster notes',
  range: 'a wider reach',
  stretch: 'bigger stretches',
  displacement: 'bigger hand jumps',
  tempo: 'a faster tempo',
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — what does a clean run prove, and how far is "a stretch"?
 *
 *  Credit: a clean run at 60% tempo proves the note density, the note speed and the
 *  tempo at 60% of the piece's values; reach, stretches and jumps are proven at face
 *  value because slowing down does not shrink them. Only runs that qualify for
 *  promotion count (timed modes, whole piece), so `bestCleanTempo` is the tempo used.
 *
 *  Readiness: each metric is compared in score space (THRESHOLDS in difficulty.ts).
 *  Within `slack` of the profile is ready. One metric no more than `stretch` above is a
 *  small stretch. Anything else needs the skills it names, hardest gap first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const READINESS = {
  slack: 0.05,
  stretch: 0.2,
  /** Metrics that scale with tempo when crediting a slow clean run. */
  tempoScaled: { density: 1, ioi: -1, tempo: 1 } as Partial<Record<MetricKey, 1 | -1>>,
};

/** The values a clean run at `tempoScale` proves, from the stage's values at full tempo. */
export function creditedValues(values: number[], tempoScale: number): number[] {
  const t = Math.min(1, Math.max(0.1, tempoScale));
  return METRIC_KEYS.map((k, i) => {
    const dir = READINESS.tempoScaled[k];
    return dir === 1 ? values[i] * t : dir === -1 ? values[i] / t : values[i];
  });
}

/** Fold every credited stage into one profile. */
export function skillProfile(songs: Iterable<SongProgress>): SkillProfile {
  let values: number[] | undefined;
  let credited = 0;
  for (const song of songs) {
    for (const stage of Object.values(song.stages)) {
      if (!stage?.fingerprint || stage.bestCleanTempo <= 0) continue;
      const v = creditedValues(stage.fingerprint, stage.bestCleanTempo);
      values = values ? METRIC_KEYS.map((k, i) => harder(k, values![i], v[i])) : v;
      credited++;
    }
  }
  return { values, credited };
}

/** Which of two values is harder on a metric (IOI is inverted: shorter is harder). */
function harder(k: MetricKey, a: number, b: number): number {
  return k === 'ioi' ? Math.min(a, b) : Math.max(a, b);
}

export interface Readiness {
  kind: 'ready' | 'stretch' | 'needs' | 'unknown';
  /** Metrics above the profile, biggest gap first. */
  gaps: { key: MetricKey; delta: number }[];
  label: string;      // "Ready now", "Small stretch", "Needs two skills", "Difficulty 0.3"
  detail: string;     // "faster notes", "a wider reach and bigger hand jumps"
}

/** How far a piece (fingerprint values) sits beyond the profile. */
export function readiness(values: number[], profile: SkillProfile): Readiness {
  if (!profile.values) {
    const overall = METRIC_KEYS.reduce((s, k, i) => s + metricScore(k, values[i]), 0) / METRIC_KEYS.length;
    const word = overall < 0.25 ? 'beginner' : overall < 0.5 ? 'easy' : overall < 0.75 ? 'intermediate' : 'advanced';
    return { kind: 'unknown', gaps: [], label: word[0].toUpperCase() + word.slice(1), detail: 'play something clean in Rhythm or Perform mode to see what fits you' };
  }
  const gaps = METRIC_KEYS
    .map((k, i) => ({ key: k, delta: round2(metricScore(k, values[i]) - metricScore(k, profile.values![i])) }))
    .filter((g) => g.delta > READINESS.slack)
    .sort((a, b) => b.delta - a.delta);
  if (gaps.length === 0) return { kind: 'ready', gaps, label: 'Ready now', detail: 'nothing here is beyond what you have played clean' };
  const words = gaps.map((g) => METRIC_WORDS[g.key]);
  if (gaps.length === 1 && gaps[0].delta <= READINESS.stretch) return { kind: 'stretch', gaps, label: 'Small stretch', detail: words[0] };
  return { kind: 'needs', gaps, label: `Needs ${gaps.length === 1 ? 'one skill' : gaps.length === 2 ? 'two skills' : `${gaps.length} skills`}`, detail: joinWords(words) };
}

export interface BridgeCandidate { id: string; title: string; values: number[]; bars: number }
export interface Bridge { id: string; title: string; teaches: MetricKey; bars: number; reason: string }

/**
 * A shorter piece that teaches exactly one of the skills the target needs: ready on every
 * other metric, a small stretch on one of the target's gaps, and the shortest such piece.
 */
export function bridgeSong(target: Readiness, profile: SkillProfile, candidates: BridgeCandidate[], excludeId?: string): Bridge | undefined {
  if (target.kind !== 'needs' && target.kind !== 'stretch') return undefined;
  const wanted = new Set(target.gaps.map((g) => g.key));
  let best: Bridge | undefined;
  for (const c of candidates) {
    if (c.id === excludeId) continue;
    const r = readiness(c.values, profile);
    if (r.kind !== 'stretch' || !wanted.has(r.gaps[0].key)) continue;
    if (best && c.bars >= best.bars) continue;
    const teaches = r.gaps[0].key;
    best = { id: c.id, title: c.title, teaches, bars: c.bars, reason: `${c.bars} bars that add ${METRIC_WORDS[teaches]} and nothing else new` };
  }
  return best;
}

function joinWords(ws: string[]): string {
  return ws.length <= 1 ? ws.join('') : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`;
}
function round2(x: number): number { return Math.round(x * 100) / 100; }
