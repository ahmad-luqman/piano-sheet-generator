import type { StageProgress } from './progress';
import { barQuality } from './score';

/**
 * Ghost hand: in Learn mode, the bar-and-hand cells the learner keeps missing are played
 * for them, so the rest of the piece can flow. Learn mode only, because a ghosted run
 * must never count toward promotion, and Learn runs never do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — what gets ghosted, and how does it come back?
 *
 *  A cell is a candidate once it has `minAttempts` attempts and its decayed quality
 *  is under `threshold`. Ghosted notes are not learner steps, so their cell is not
 *  rescored; to avoid a cell that is ghosted forever, every `handBackEvery`-th run of
 *  the session hands the cell back unassisted and lets the score decide. A cell that
 *  comes back clean leaves the set on its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const GHOST = { threshold: 0.6, minAttempts: 2, handBackEvery: 3 };

export interface GhostPlan { ghost: Set<string>; handedBack: Set<string> }

/** Cells are "bar:hand" as in StageProgress.bars. `runs` counts this session's runs per candidate cell. */
export function ghostPlan(stage: StageProgress | undefined, runs: Record<string, number>): GhostPlan {
  const plan: GhostPlan = { ghost: new Set(), handedBack: new Set() };
  if (!stage) return plan;
  for (const [cell, b] of Object.entries(stage.bars)) {
    if (b.attempts < GHOST.minAttempts || barQuality(b) >= GHOST.threshold) continue;
    const n = runs[cell] ?? 0;
    if ((n + 1) % GHOST.handBackEvery === 0) plan.handedBack.add(cell); else plan.ghost.add(cell);
  }
  return plan;
}

/** "Ghost hand: bars 3–4 left hand played for you · bar 7 right hand is yours this run" */
export function describeGhost(plan: GhostPlan): string {
  const part = (cells: Set<string>): string => {
    const by: Record<'rh' | 'lh', number[]> = { rh: [], lh: [] };
    for (const c of cells) { const [bar, hand] = c.split(':'); by[hand as 'rh' | 'lh'].push(parseInt(bar, 10) + 1); }
    return (['lh', 'rh'] as const).filter((h) => by[h].length).map((h) => `${ranges(by[h].sort((a, b) => a - b))} ${h === 'lh' ? 'left' : 'right'} hand`).join(', ');
  };
  const bits: string[] = [];
  if (plan.ghost.size) bits.push(`Ghost hand: ${part(plan.ghost)} played for you`);
  if (plan.handedBack.size) bits.push(`${part(plan.handedBack)} ${plan.handedBack.size === 1 ? 'is' : 'are'} yours this run`);
  return bits.join(' · ');
}

function ranges(bars: number[]): string {
  const out: string[] = [];
  let start = bars[0], prev = bars[0];
  for (const b of bars.slice(1).concat(NaN)) {
    if (b === prev + 1) { prev = b; continue; }
    out.push(start === prev ? `bar ${start}` : `bars ${start}–${prev}`);
    start = prev = b;
  }
  return out.join(', ').replace(/^bar/, out.length > 1 ? 'bars' : 'bar').replace(/^bars (\d+),/, 'bars $1,');
}
