import type { Arrangement, Hand, LevelId } from '../types';
import type { StepAction } from '../sheet/steps';
import type { Hands } from './player';
import type { StageProgress } from './progress';
import { barQuality, PROMOTION } from './score';

/**
 * The adaptive next action. Replaces the fixed tempo ramp once a stage has attempts:
 * code builds a short list of candidate drills from the bar statistics, the rule
 * below picks one, and the optional Claude call (llm/claude.ts) may pick a different
 * one from the same list. Nothing here or there invents bars or tempos.
 */

export interface Candidate {
  id: 'first' | 'drill' | 'drill-timed' | 'through' | 'perform' | 'next-stage';
  action: StepAction;
  title: string;      // "Practise bars 3–4, right hand, at 55%"
  reason: string;     // "the G4→D5 jump caused 4 of your 6 errors"
}

export interface NextAction extends Candidate {
  candidates: Candidate[];
}

export interface WeakSpot { startBar: number; endBar: number; hand: Hands; quality: number }

export function handsNeeded(arr: Arrangement, levelId: LevelId): Hands {
  return arr.levels[levelId].notes.some((n) => n.hand === 'lh') ? 'both' : 'rh';
}

/** The two-bar window with the lowest decayed quality, and which hand drags it down. */
export function weakestSpot(stage: StageProgress, totalBars: number, needed: Hands): WeakSpot | undefined {
  const q = (bar: number, hand: Hand): number | undefined => { const b = stage.bars[`${bar}:${hand}`]; return b ? barQuality(b) : undefined; };
  let best: WeakSpot | undefined;
  for (let start = 0; start < totalBars; start++) {
    const end = Math.min(totalBars - 1, start + 1);
    const per: Record<Hand, number[]> = { rh: [], lh: [] };
    for (let bar = start; bar <= end; bar++) for (const hand of ['rh', 'lh'] as const) { const v = q(bar, hand); if (v !== undefined) per[hand].push(v); }
    const all = [...per.rh, ...per.lh];
    if (all.length === 0) continue;
    const quality = all.reduce((s, x) => s + x, 0) / all.length;
    if (best && quality >= best.quality) continue;
    const mean = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined;
    const rh = mean(per.rh), lh = mean(per.lh);
    let hand: Hands = needed;
    if (needed === 'both' && rh !== undefined && lh !== undefined) hand = rh < lh - 0.15 ? 'rh' : lh < rh - 0.15 ? 'lh' : 'both';
    else if (needed === 'both' && lh === undefined) hand = 'rh';
    best = { startBar: start, endBar: end, hand, quality };
  }
  return best;
}

export function nextAction(arr: Arrangement, levelId: LevelId, stage: StageProgress | undefined): NextAction {
  const needed = handsNeeded(arr, levelId);
  const total = arr.totalBars;
  const whole = (hands: Hands, tempoScale: number, mode: StepAction['mode'], level: LevelId = levelId): StepAction =>
    ({ startBar: 0, endBar: total - 1, hands, tempoScale: clampTempo(tempoScale), level, mode });
  const candidates: Candidate[] = [];

  if (!stage || stage.attempts.length === 0) {
    const first: Candidate = { id: 'first', action: whole(needed, 0.6, 'learn'), title: describeAction(whole(needed, 0.6, 'learn')), reason: 'no attempts at this stage yet' };
    return { ...first, candidates: [first] };
  }

  const last = stage.attempts[stage.attempts.length - 1];
  const lastWhole = [...stage.attempts].reverse().find((a) => a.wholePiece);
  const weak = weakestSpot(stage, total, needed);

  if (weak && weak.quality < PROMOTION.notes) {
    const cause = Object.values(stage.causes).filter((c) => c.bar >= weak.startBar && c.bar <= weak.endBar).sort((a, b) => b.count - a.count)[0];
    const drill: StepAction = { startBar: weak.startBar, endBar: weak.endBar, hands: weak.hand, tempoScale: clampTempo(last.tempoScale * 0.85), level: levelId, mode: 'learn' };
    const reason = cause && cause.count >= 1.5 ? `${cause.label} is where most errors happen` : `bars ${weak.startBar + 1}–${weak.endBar + 1} are your weakest (${Math.round(weak.quality * 100)}% clean)`;
    candidates.push({ id: 'drill', action: drill, title: describeAction(drill), reason });
    const timed: StepAction = { ...drill, hands: needed, tempoScale: clampTempo(last.tempoScale), mode: 'rhythm' };
    candidates.push({ id: 'drill-timed', action: timed, title: describeAction(timed), reason: 'the same bars in time, once they feel secure' });
  }

  const throughTempo = lastWhole?.clean ? lastWhole.tempoScale + 0.1 : lastWhole?.tempoScale ?? Math.max(0.5, last.tempoScale);
  const through = whole(needed, throughTempo, 'rhythm');
  candidates.push({ id: 'through', action: through, title: describeAction(through), reason: lastWhole?.clean ? 'your last run was clean; a little faster' : 'play it through in time to find what to work on' });

  if (stage.cleanRuns >= 1 || (lastWhole?.clean && lastWhole.mode !== 'learn')) {
    const perform = whole(needed, Math.max(PROMOTION.tempo, lastWhole?.tempoScale ?? 0), 'perform');
    candidates.push({ id: 'perform', action: perform, title: describeAction(perform), reason: `${PROMOTION.runs - stage.cleanRuns} more clean run${PROMOTION.runs - stage.cleanRuns === 1 ? '' : 's'} at ${Math.round(PROMOTION.tempo * 100)}% earns the next stage` });
  }
  if (stage.earned && levelId < 6) {
    const up = whole(handsNeeded(arr, (levelId + 1) as LevelId), 0.6, 'learn', (levelId + 1) as LevelId);
    candidates.push({ id: 'next-stage', action: up, title: describeAction(up), reason: 'this stage is earned' });
  }

  const pick = candidates.find((c) => c.id === 'next-stage')
    ?? candidates.find((c) => c.id === 'drill')
    ?? (stage.cleanRuns >= 1 || (lastWhole?.clean && lastWhole.mode !== 'learn' && lastWhole.tempoScale >= PROMOTION.tempo - 1e-6) ? candidates.find((c) => c.id === 'perform') : undefined)
    ?? candidates.find((c) => c.id === 'through')!;
  return { ...pick, candidates };
}

export function describeAction(a: StepAction): string {
  const bars = a.startBar === a.endBar ? `bar ${a.startBar + 1}` : `bars ${a.startBar + 1}–${a.endBar + 1}`;
  const hands = a.hands === 'both' ? 'hands together' : a.hands === 'rh' ? 'right hand' : 'left hand';
  const mode = a.mode === 'learn' ? 'Learn' : a.mode === 'rhythm' ? 'Rhythm' : a.mode === 'perform' ? 'Perform' : 'Listen';
  return `${a.mode === 'perform' ? 'Perform' : 'Practise'} ${bars}, ${hands}, at ${Math.round(a.tempoScale * 100)}% in ${mode} mode, stage ${a.level}`;
}

function clampTempo(t: number): number { return Math.round(Math.min(1, Math.max(0.4, t)) * 20) / 20; }
