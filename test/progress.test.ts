import { describe, expect, it } from 'vitest';
import { dailySet, emptyStage, fragmentKind, ProgressStore, recordAttempt, scaffoldLevel, songKey, STORAGE_KEY, type KeyValueStorage } from '../src/practice/progress';
import { nextAction, weakestSpot } from '../src/practice/next';
import { PROMOTION, scoreAttempt, type AttemptMeta } from '../src/practice/score';
import type { StepResult } from '../src/practice/player';
import { generateSteps } from '../src/sheet/steps';
import { buildArrangement } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';

const song = loadCatalogSong(CATALOG.find((c) => c.id === 'twinkle')!);
const arr = buildArrangement(song);
const level = arr.levels[2];
const meta = (over: Partial<AttemptMeta> = {}): AttemptMeta =>
  ({ level: 2, mode: 'rhythm', hands: 'both', tempoScale: 0.8, startBar: 0, endBar: arr.totalBars - 1, startedAt: '2026-09-04T10:00:00Z', durationSec: 30, ...over });

/** A run over the given bar range; in `badBars` every right-hand note is missed and one wrong key is pressed. */
function run(startBar: number, endBar: number, badBars: number[] = [], hands: 'both' | 'rh' = 'both', late = false): StepResult[] {
  const notes = level.notes.filter((n) => (hands === 'both' || n.hand === 'rh') && n.startBeat >= startBar * arr.beatsPerBar && n.startBeat < (endBar + 1) * arr.beatsPerBar);
  const groups = new Map<number, typeof notes>();
  for (const n of notes) { const k = Math.round(n.startBeat * 64); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(n); }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, ns]) => {
    const bar = Math.floor(ns[0].startBeat / arr.beatsPerBar);
    const bad = badBars.includes(bar);
    return { beat: ns[0].startBeat, notes: ns.map((note) => bad && note.hand === 'rh' ? { note, hit: false } : { note, hit: true, offsetSec: late ? 0.3 : 0.05 }), wrong: bad ? 1 : 0 };
  });
}
const score = (results: StepResult[], over: Partial<AttemptMeta> = {}) => scoreAttempt(meta(over), results, level, arr.beatsPerBar, arr.totalBars);

class MemStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('ProgressStore', () => {
  it('round-trips through storage and ignores junk', () => {
    const mem = new MemStorage();
    const store = new ProgressStore(mem);
    const s = store.song('k', 'Twinkle');
    recordAttempt(store.stage(s, 2), score(run(0, arr.totalBars - 1)), arr.sections, 'both');
    store.touch(s);
    expect(mem.data.get(STORAGE_KEY)).toContain('"v":1');
    const again = new ProgressStore(mem);
    expect(again.peek('k', 2)?.attempts.length).toBe(1);
    expect(again.peek('k', 3)).toBeUndefined();
    mem.setItem(STORAGE_KEY, '{"v":7,"nope":true}');
    expect(new ProgressStore(mem).load()).toEqual({});
    mem.setItem(STORAGE_KEY, 'not json');
    expect(new ProgressStore(mem).load()).toEqual({});
    expect(() => new ProgressStore(null).load()).not.toThrow();
  });
  it('keys a song by title, bars, notes and melody track', () => {
    expect(songKey(arr, song)).toBe(`${arr.title}|${arr.totalBars}|${song.notes.length}|${arr.melodyTrack}`);
  });
});

describe('recordAttempt', () => {
  it('earns the stage after two consecutive clean timed whole-piece runs at tempo', () => {
    const stage = emptyStage();
    const a = recordAttempt(stage, score(run(0, arr.totalBars - 1)), arr.sections, 'both');
    expect(stage.cleanRuns).toBe(1);
    expect(a.earned).toBe(false);
    recordAttempt(stage, score(run(0, arr.totalBars - 1), { mode: 'learn' }), arr.sections, 'both');
    expect(stage.cleanRuns).toBe(1); // learn runs neither count nor reset
    const b = recordAttempt(stage, score(run(0, arr.totalBars - 1), { mode: 'perform' }), arr.sections, 'both');
    expect(b.justEarned).toBe(true);
    expect(stage.earned).toBe(true);
    expect(stage.bestCleanTempo).toBe(0.8);
  });
  it('resets the clean streak on a failed qualifying run', () => {
    const stage = emptyStage();
    recordAttempt(stage, score(run(0, arr.totalBars - 1)), arr.sections, 'both');
    recordAttempt(stage, score(run(0, arr.totalBars - 1, [], 'both', true)), arr.sections, 'both');
    expect(stage.cleanRuns).toBe(0);
    expect(stage.earned).toBe(false);
  });
  it('fades one aid per two clean repetitions', () => {
    const stage = emptyStage();
    expect(scaffoldLevel(stage)).toBe(0);
    for (let i = 0; i < 2 * PROMOTION.fadeRuns; i++) recordAttempt(stage, score(run(0, 3, [], 'both'), { endBar: 3, mode: 'learn' }), arr.sections, 'both');
    expect(scaffoldLevel(stage)).toBe(2);
    for (let i = 0; i < 10; i++) recordAttempt(stage, score(run(0, 3), { endBar: 3 }), arr.sections, 'both');
    expect(scaffoldLevel(stage)).toBe(3);
  });
  it('decays bar statistics toward the latest attempt', () => {
    const stage = emptyStage();
    recordAttempt(stage, score(run(0, 3, [1]), { endBar: 3 }), arr.sections, 'both');
    const bad = stage.bars['1:rh'].hits / stage.bars['1:rh'].notes;
    for (let i = 0; i < 3; i++) recordAttempt(stage, score(run(0, 3), { endBar: 3 }), arr.sections, 'both');
    expect(stage.bars['1:rh'].hits / stage.bars['1:rh'].notes).toBeGreaterThan(bad);
    expect(stage.bars['1:rh'].attempts).toBe(4);
    expect(stage.bars['5:rh']).toBeUndefined();
  });
  it('schedules fragments: clean sections double their interval, weak ones come back today', () => {
    const stage = emptyStage();
    const now = new Date('2026-09-04T10:00:00Z');
    const secA = arr.sections[0];
    recordAttempt(stage, score(run(0, secA.endBar), { endBar: secA.endBar }), arr.sections, 'both', now);
    expect(stage.fragments['0'].intervalDays).toBe(1);
    expect(fragmentKind(stage, secA)).toBe('weak');
    recordAttempt(stage, score(run(0, secA.endBar), { endBar: secA.endBar }), arr.sections, 'both', now);
    expect(stage.fragments['0'].intervalDays).toBe(2);
    expect(fragmentKind(stage, secA)).toBe('mastered');
    expect(new Date(stage.fragments['0'].due).getTime()).toBe(now.getTime() + 2 * 86400000);
    recordAttempt(stage, score(run(0, secA.endBar, [1]), { endBar: secA.endBar }), arr.sections, 'both', now);
    expect(fragmentKind(stage, secA)).toBe('weak');
    expect(stage.fragments['0'].intervalDays).toBe(1);
  });
  it('a repeat section shares its original\'s fragment', () => {
    const repeat = arr.sections.find((s) => s.repeatOf !== undefined)!;
    const stage = emptyStage();
    recordAttempt(stage, score(run(repeat.startBar, repeat.endBar), { startBar: repeat.startBar, endBar: repeat.endBar }), arr.sections, 'both');
    expect(Object.keys(stage.fragments)).toEqual([String(repeat.repeatOf)]);
  });
});

describe('dailySet', () => {
  it('offers one new, one weak and one due mastered section', () => {
    const stage = emptyStage();
    const now = new Date('2026-09-04T10:00:00Z');
    const [a, b] = arr.sections.filter((s) => s.repeatOf === undefined);
    for (let i = 0; i < 2; i++) recordAttempt(stage, score(run(a.startBar, a.endBar), { startBar: a.startBar, endBar: a.endBar }), arr.sections, 'both', now);
    recordAttempt(stage, score(run(b.startBar, b.endBar, [b.startBar]), { startBar: b.startBar, endBar: b.endBar }), arr.sections, 'both', now);
    // Twinkle's third section repeats the first, so both originals have now been tried: nothing is "new".
    const today = dailySet(stage, arr.sections, now);
    expect(today.map((d) => d.kind)).toEqual(['weak']);
    expect(today[0].section.index).toBe(b.index);
    const later = dailySet(stage, arr.sections, new Date(now.getTime() + 3 * 86400000));
    expect(later.map((d) => d.kind)).toEqual(['weak', 'mastered']);
    expect(later[1].section.index).toBe(a.index);
    expect(dailySet(undefined, arr.sections, now).map((d) => d.kind)).toEqual(['new']);
    const onlyA = emptyStage();
    recordAttempt(onlyA, score(run(a.startBar, a.endBar), { startBar: a.startBar, endBar: a.endBar }), arr.sections, 'both', now);
    expect(dailySet(onlyA, arr.sections, now).map((d) => `${d.kind}:${d.section.index}`)).toEqual([`new:${b.index}`, `weak:${a.index}`]);
  });
});

describe('nextAction', () => {
  it('starts with a whole-piece learn run when nothing was attempted', () => {
    const n = nextAction(arr, 2, undefined);
    expect(n.id).toBe('first');
    expect(n.action).toMatchObject({ startBar: 0, endBar: arr.totalBars - 1, mode: 'learn', hands: 'both', level: 2 });
  });
  it('drills the weakest two bars with the weaker hand, slower, and names the cause', () => {
    const stage = emptyStage();
    recordAttempt(stage, score(run(0, arr.totalBars - 1, [2, 3])), arr.sections, 'both');
    const spot = weakestSpot(stage, arr.totalBars, 'both')!;
    expect([spot.startBar, spot.endBar]).toEqual([2, 3]);
    expect(spot.hand).toBe('rh'); // only right-hand notes were dropped
    const n = nextAction(arr, 2, stage);
    expect(n.id).toBe('drill');
    expect(n.action).toMatchObject({ startBar: 2, endBar: 3, hands: 'rh', mode: 'learn', tempoScale: 0.7 });
    expect(n.title).toContain('bars 3–4, right hand, at 70%');
    expect(n.candidates.map((c) => c.id)).toEqual(['drill', 'drill-timed', 'through']);
  });
  it('asks for a faster run after a clean one, then a performance, then the next stage', () => {
    const stage = emptyStage();
    recordAttempt(stage, score(run(0, arr.totalBars - 1), { tempoScale: 0.6 }), arr.sections, 'both');
    let n = nextAction(arr, 2, stage);
    expect(n.id).toBe('through');
    expect(n.action.tempoScale).toBe(0.7);
    recordAttempt(stage, score(run(0, arr.totalBars - 1), { tempoScale: 0.8 }), arr.sections, 'both');
    n = nextAction(arr, 2, stage);
    expect(n.id).toBe('perform');
    expect(n.action.mode).toBe('perform');
    recordAttempt(stage, score(run(0, arr.totalBars - 1), { tempoScale: 0.8, mode: 'perform' }), arr.sections, 'both');
    n = nextAction(arr, 2, stage);
    expect(n.id).toBe('next-stage');
    expect(n.action.level).toBe(3);
  });
  it('replaces the tempo ramp in the steps', () => {
    const plain = generateSteps(arr, 2);
    expect(plain.filter((s) => s.title.startsWith('Whole piece at')).length).toBe(3);
    const n = nextAction(arr, 2, undefined);
    const adaptive = generateSteps(arr, 2, n);
    expect(adaptive.filter((s) => s.title.startsWith('Whole piece at')).length).toBe(0);
    expect(adaptive[adaptive.length - 1].title).toMatch(/^Next: /);
    expect(adaptive[adaptive.length - 1].action).toEqual(n.action);
  });
});

describe('ghosted runs', () => {
  it('neither fade the aids nor mark a ghosted section clean', async () => {
    const { emptyStage, recordAttempt } = await import('../src/practice/progress');
    const stage = emptyStage();
    const bars = [{ bar: 0, hand: 'rh' as const, notes: 4, hits: 4, wrong: 0, timed: 0, onTime: 0, pauses: 0 }, { bar: 4, hand: 'rh' as const, notes: 4, hits: 4, wrong: 0, timed: 0, onTime: 0, pauses: 0 }];
    const base = { level: 1 as const, mode: 'learn' as const, hands: 'rh' as const, tempoScale: 0.6, startBar: 0, endBar: 7, startedAt: '2026-09-04T00:00:00Z', durationSec: 10,
      notes: 8, hits: 8, wrong: 0, timed: 0, onTime: 0, pauses: 0, noteAccuracy: 1, bars, causes: [], clean: true, wholePiece: true };
    const sections = [{ index: 0, startBar: 0, endBar: 3, label: 'A' }, { index: 1, startBar: 4, endBar: 7, label: 'B' }];
    recordAttempt(stage, { ...base, ghost: ['1:lh'] }, sections, 'rh');
    expect(stage.cleanReps).toBe(0);
    expect(Object.keys(stage.fragments)).toEqual(['1']);
    recordAttempt(stage, base, sections, 'rh');
    expect(stage.cleanReps).toBe(1);
    expect(Object.keys(stage.fragments).sort()).toEqual(['0', '1']);
  });
});
