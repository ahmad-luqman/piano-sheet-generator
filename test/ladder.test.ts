import { describe, expect, it } from 'vitest';
import { buildArrangement, describeChanges, easeHardSections, markNewNotes } from '../src/arrange';
import { parseDsl } from '../src/catalog/dsl';
import { songFromNotes } from '../src/midi/parse';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';

const catalog = (id: string, opts = {}) => buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === id)!), opts);

describe('what changed between stages', () => {
  it('flags only the left hand at stage 2 and nothing at stage 1', () => {
    const arr = catalog('twinkle');
    expect(arr.levels[1].notes.some((n) => n.isNew)).toBe(false);
    const l2 = arr.levels[2].notes.filter((n) => n.isNew);
    expect(l2.length).toBeGreaterThan(0);
    expect(l2.every((n) => n.hand === 'lh')).toBe(true);
    expect(describeChanges(arr.levels[2])).toMatch(/^Stage 2 adds \d+ left-hand notes\.$/);
  });
  it('compares across the transposition boundary in a common frame', () => {
    // Canon in D: stages 1–3 are in C, stage 4 in D. The melody rhythm is identical, so the
    // right hand must not light up as new just because the pitches shifted.
    const arr = catalog('canon-in-d');
    expect(arr.levels[3].transpose).not.toBe(arr.levels[4].transpose);
    const rhNew = arr.levels[4].notes.filter((n) => n.isNew && n.hand === 'rh');
    expect(rhNew.length).toBeLessThan(arr.levels[4].notes.filter((n) => n.hand === 'rh').length / 4);
  });
  it('markNewNotes is idempotent', () => {
    const arr = catalog('ode-to-joy');
    const before = arr.levels[3].notes.map((n) => n.isNew);
    markNewNotes(arr.levels);
    expect(arr.levels[3].notes.map((n) => n.isNew)).toEqual(before);
  });
});

describe('per-section easing', () => {
  /** Eight bars of quarter notes, then four bars of sixteenth-note runs. */
  function lopsided() {
    const easy = Array(8).fill('C4 D4 E4 F4').join(' | ');
    const run = Array(4).fill('C5:0.25 D5:0.25 E5:0.25 F5:0.25 G5:0.25 A5:0.25 B5:0.25 C6:0.25 B5:0.25 A5:0.25 G5:0.25 F5:0.25 E5:0.25 D5:0.25 C5:0.25 B4:0.25').join(' | ');
    const rh = parseDsl(`${easy} | ${run}`, 0);
    const lh = parseDsl(Array(12).fill('[C3 E3 G3]:4').join(' | '), 1);
    return songFromNotes('Lopsided', [...rh, ...lh], 120, { num: 4, den: 4 });
  }
  it('shows the hard section one stage lower and records it', () => {
    const arr = buildArrangement(lopsided());
    const eased = arr.levels[4].eased ?? [];
    expect(eased.length).toBeGreaterThan(0);
    expect(eased[0].fromLevel).toBe(3);
    const s = arr.sections[eased[0].section];
    expect(s.startBar).toBe(8);
    const a = s.startBar * arr.beatsPerBar, b = (s.endBar + 1) * arr.beatsPerBar;
    const win = (n: { startBeat: number }) => n.startBeat >= a && n.startBeat < b;
    const l4 = arr.levels[4].notes.filter(win).map((n) => `${n.hand}${n.midi}@${n.startBeat}`);
    const l3 = arr.levels[3].notes.filter(win).map((n) => `${n.hand}${n.midi}@${n.startBeat}`);
    expect(l4).toEqual(l3);
    expect(arr.levels[4].notes.filter(win).some((n) => n.isNew)).toBe(false);
  });
  it('can be switched off', () => {
    const arr = buildArrangement(lopsided(), { easeHardSections: false });
    expect(arr.levels[4].eased).toBeUndefined();
  });
  it('leaves an even piece alone', () => {
    const arr = catalog('twinkle');
    for (const id of [2, 3, 4, 5, 6] as const) expect(arr.levels[id].eased).toBeUndefined();
    const levels = arr.levels;
    easeHardSections(levels, arr.sections, arr.beatsPerBar, arr.bpm);
    expect(levels[4].eased).toBeUndefined();
  });
});
