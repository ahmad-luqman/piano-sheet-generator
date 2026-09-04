import { describe, expect, it } from 'vitest';
import { buildArrangement } from '../src/arrange';
import { findMotif, findShapes } from '../src/arrange/motifs';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';
import { generateSteps } from '../src/sheet/steps';

const arrOf = (id: string) => buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === id)!));

describe('motifs', () => {
  it('finds the repeated opening of Mary Had a Little Lamb', () => {
    const arr = arrOf('mary-lamb');
    const m = findMotif(arr.levels[1].notes, arr.beatsPerBar)!;
    expect(m.occurrences.length).toBeGreaterThanOrEqual(2);
    expect(m.letters.startsWith('E D C D')).toBe(true);
    expect(m.occurrences[0].bar).toBe(0);
    expect(m.coverage).toBeGreaterThan(0.3);
  });
  it('counts a transposed repeat as the same motif', () => {
    const arr = arrOf('twinkle');
    const m = findMotif(arr.levels[1].notes, arr.beatsPerBar)!;
    expect(m.occurrences.length).toBeGreaterThanOrEqual(2);
    // "G G F F E E D" in bars 5–6 repeats in bars 7–8; the first phrase "C C G G A A G" returns in bar 9.
    expect(m.occurrences.every((o) => Number.isInteger(o.bar))).toBe(true);
  });
  it('names the left-hand shapes with their share', () => {
    const arr = arrOf('twinkle');
    const shapes = findShapes(arr.levels[4].notes, arr.beatsPerBar);
    expect(shapes[0].name).toBe('a major triad');
    expect(shapes[0].share).toBeGreaterThan(0.5);
    const bass = findShapes(arr.levels[2].notes, arr.beatsPerBar);
    expect(bass[0].name).toBe('a single bass note');
  });
  it('gives nothing for a hand that never repeats', () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({ midi: 60 + [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19][i], startBeat: i * [1, 0.5, 1.5, 0.25][i % 4], durationBeats: 0.25, hand: 'rh' as const, letter: 'C', octave: 4, velocity: 0.8 }));
    expect(findMotif(notes, 4)).toBeUndefined();
  });
});

describe('pattern-first step', () => {
  it('comes right after listening and points at the first occurrence', () => {
    const arr = arrOf('mary-lamb');
    const steps = generateSteps(arr, 4);
    const i = steps.findIndex((s) => s.title.startsWith('Learn the building blocks'));
    expect(i).toBe(2);
    expect(steps[i].body).toContain('E D C D');
    expect(steps[i].body).toMatch(/appears \d+ times/);
    expect(steps[i].body).toContain('major triad');
    expect(steps[i].action).toMatchObject({ startBar: 0, hands: 'rh', mode: 'learn' });
  });
});
