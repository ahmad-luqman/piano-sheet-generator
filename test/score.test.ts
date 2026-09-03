import { describe, expect, it } from 'vitest';
import { barQuality, describeCause, PROMOTION, qualifiesForPromotion, scoreAttempt, type AttemptMeta } from '../src/practice/score';
import type { StepResult } from '../src/practice/player';
import { buildArrangement } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';

const arr = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'twinkle')!));
const level = arr.levels[2];
const rh = level.notes.filter((n) => n.hand === 'rh');
const meta = (over: Partial<AttemptMeta> = {}): AttemptMeta =>
  ({ level: 2, mode: 'rhythm', hands: 'rh', tempoScale: 0.8, startBar: 0, endBar: arr.totalBars - 1, startedAt: '2026-09-04T10:00:00Z', durationSec: 30, ...over });

/** Every right-hand onset played: on time except the listed misses and late notes. */
function play(opts: { miss?: number[]; late?: number[]; wrongAt?: Record<number, number>; wait?: Record<number, number>; learn?: boolean } = {}): StepResult[] {
  const groups = new Map<number, typeof rh>();
  for (const n of rh) { const k = Math.round(n.startBeat * 64); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(n); }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, notes], i) => ({
    beat: notes[0].startBeat,
    notes: notes.map((note) => opts.miss?.includes(i) ? { note, hit: false } : opts.learn ? { note, hit: true } : { note, hit: true, offsetSec: opts.late?.includes(i) ? 0.3 : 0.05 }),
    wrong: opts.wrongAt?.[i] ?? 0,
    waitSec: opts.learn ? (opts.wait?.[i] ?? 0.4) : undefined,
  }));
}

describe('scoreAttempt', () => {
  it('scores a perfect rhythm run as clean and whole-piece', () => {
    const s = scoreAttempt(meta(), play(), level, arr.beatsPerBar, arr.totalBars);
    expect(s.notes).toBe(rh.length);
    expect(s.noteAccuracy).toBe(1);
    expect(s.timingAccuracy).toBe(1);
    expect(s.clean).toBe(true);
    expect(s.wholePiece).toBe(true);
    expect(s.bars.every((b) => b.hand === 'rh')).toBe(true);
    expect(s.bars.length).toBe(arr.totalBars);
  });
  it('fails cleanliness on timing alone', () => {
    const late = Array.from({ length: 12 }, (_, i) => i);
    const s = scoreAttempt(meta(), play({ late }), level, arr.beatsPerBar, arr.totalBars);
    expect(s.noteAccuracy).toBe(1);
    expect(s.timingAccuracy!).toBeLessThan(PROMOTION.timing);
    expect(s.clean).toBe(false);
  });
  it('blames the interval into the missed note', () => {
    // Twinkle bar 1: C C G G. Miss the first G (index 2), twice via a wrong press too.
    const s = scoreAttempt(meta(), play({ miss: [2], wrongAt: { 2: 1 } }), level, arr.beatsPerBar, arr.totalBars);
    expect(s.causes[0].key).toBe('C4>G4');
    expect(s.causes[0].count).toBe(2);
    expect(s.causes[0].bar).toBe(0);
    expect(describeCause(s)).toBe('The C4→G4 jump caused 2 of your 2 errors.');
    expect(s.bars[0].wrong).toBe(1);
  });
  it('stays silent when no cause dominates', () => {
    const s = scoreAttempt(meta(), play({ miss: [1, 5, 9, 14] }), level, arr.beatsPerBar, arr.totalBars);
    expect(describeCause(s)).toBe('');
  });
  it('judges a learn run on pauses instead of timing', () => {
    const ok = scoreAttempt(meta({ mode: 'learn' }), play({ learn: true }), level, arr.beatsPerBar, arr.totalBars);
    expect(ok.timingAccuracy).toBeUndefined();
    expect(ok.clean).toBe(true);
    const slow = scoreAttempt(meta({ mode: 'learn' }), play({ learn: true, wait: { 3: 4 } }), level, arr.beatsPerBar, arr.totalBars);
    expect(slow.pauses).toBe(1);
    expect(slow.clean).toBe(false);
  });
  it('only timed, whole-piece runs at tempo with the right hands qualify', () => {
    const s = scoreAttempt(meta(), play(), level, arr.beatsPerBar, arr.totalBars);
    expect(qualifiesForPromotion(s, 'rh')).toBe(true);
    expect(qualifiesForPromotion(s, 'both')).toBe(false);
    expect(qualifiesForPromotion({ ...s, mode: 'learn' }, 'rh')).toBe(false);
    expect(qualifiesForPromotion({ ...s, tempoScale: 0.6 }, 'rh')).toBe(false);
    expect(qualifiesForPromotion({ ...s, endBar: 3, wholePiece: false }, 'rh')).toBe(false);
  });
  it('ranks bar quality', () => {
    expect(barQuality({ notes: 4, hits: 4, wrong: 0, timed: 4, onTime: 4, pauses: 0 })).toBe(1);
    expect(barQuality({ notes: 4, hits: 2, wrong: 2, timed: 2, onTime: 0, pauses: 0 })).toBeLessThan(0.3);
    expect(barQuality({ notes: 0, hits: 0, wrong: 0, timed: 0, onTime: 0, pauses: 0 })).toBe(1);
  });
});
