import type { Level, LevelId } from '../types';
import { fingerprint, type DifficultyFingerprint } from './difficulty';

const METRIC_WORDS: Record<keyof Omit<DifficultyFingerprint, 'overall' | 'noteCount'>, string> = {
  density: 'many more notes',
  ioi: 'faster notes',
  range: 'a wider reach',
  stretch: 'left-hand stretches beyond a sixth',
  displacement: 'bigger hand jumps',
  tempo: 'a fast tempo',
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — how hard may the first stage be?
 *
 *  Walk up the ladder and stop at the last stage whose fingerprint stays under
 *  `maxOverall`, with no single metric pinned at `maxSingle`. The reason names
 *  the metric that grows most at the next stage, so the hint reads
 *  "start at stage 3: stage 4 adds faster notes".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function suggestStartLevel(levels: Record<LevelId, Level>, bpm: number, maxOverall = 0.35, maxSingle = 0.8): { level: LevelId; reason: string } {
  const ids: LevelId[] = [1, 2, 3, 4, 5, 6];
  const fps = ids.map((id) => fingerprint(levels[id].notes, bpm));
  const ok = (fp: DifficultyFingerprint) => fp.overall <= maxOverall && metrics(fp).every(([, m]) => m.score < maxSingle);
  let level: LevelId = 1;
  for (const id of ids) {
    if (!ok(fps[id - 1])) break;
    level = id;
  }
  if (level === 6) return { level, reason: 'every stage looks manageable, so start with the original' };
  const cur = fps[level - 1], next = fps[level];
  const [name] = metrics(next).sort((a, b) => (b[1].score - cur[b[0]].score) - (a[1].score - cur[a[0]].score))[0];
  const nextId = (level + 1) as LevelId;
  return { level, reason: `stage ${nextId} (${levels[nextId].name}) adds ${METRIC_WORDS[name]}` };
}

function metrics(fp: DifficultyFingerprint): [keyof typeof METRIC_WORDS, { score: number }][] {
  return (Object.keys(METRIC_WORDS) as (keyof typeof METRIC_WORDS)[]).map((k) => [k, fp[k]]);
}
