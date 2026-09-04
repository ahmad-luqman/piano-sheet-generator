import { describe, expect, it } from 'vitest';
import { describeGhost, ghostPlan, GHOST } from '../src/practice/ghost';
import { emptyStage } from '../src/practice/progress';

const bar = (hits: number, notes = 4, attempts = 2) => ({ notes, hits, wrong: 0, timed: 0, onTime: 0, pauses: 0, attempts });

describe('ghost hand', () => {
  it('ghosts weak cells with enough attempts and leaves the rest', () => {
    const stage = { ...emptyStage(), bars: { '2:lh': bar(1), '3:lh': bar(1), '2:rh': bar(4), '6:rh': bar(1, 4, 1) } };
    const plan = ghostPlan(stage, {});
    expect([...plan.ghost].sort()).toEqual(['2:lh', '3:lh']);
    expect(plan.handedBack.size).toBe(0);
    expect(describeGhost(plan)).toBe('Ghost hand: bars 3–4 left hand played for you');
  });
  it('hands a cell back every third run', () => {
    const stage = { ...emptyStage(), bars: { '2:lh': bar(1), '6:rh': bar(0) } };
    const runs = { '2:lh': GHOST.handBackEvery - 1, '6:rh': 0 };
    const plan = ghostPlan(stage, runs);
    expect([...plan.handedBack]).toEqual(['2:lh']);
    expect([...plan.ghost]).toEqual(['6:rh']);
    expect(describeGhost(plan)).toBe('Ghost hand: bar 7 right hand played for you · bar 3 left hand is yours this run');
  });
  it('is empty without a stage', () => {
    expect(ghostPlan(undefined, {}).ghost.size).toBe(0);
  });
});
