import { describe, expect, it } from 'vitest';
import { applyConstraints, KEYBOARDS } from '../src/arrange/constraints';
import { buildArrangement } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';
import type { Level, Note } from '../src/types';

const note = (midi: number, startBeat: number, hand: 'rh' | 'lh'): Note => ({ midi, startBeat, durationBeats: 1, hand, letter: 'C', octave: 4, velocity: 0.8 });
const level = (notes: Note[]): Level => ({ id: 4, name: '', description: '', notes, key: { tonic: 0, mode: 'major', name: 'C major', useFlats: false, sharps: 0 }, chords: [], transpose: 0 });

describe('hand constraints', () => {
  it('moves a whole hand by octaves onto a small keyboard', () => {
    const l = level([note(36, 0, 'lh'), note(43, 1, 'lh'), note(72, 0, 'rh')]);
    const r = applyConstraints(l, { keys: 25, span: 12 });
    expect(l.notes.filter((n) => n.hand === 'lh').map((n) => n.midi)).toEqual([48, 55]);
    expect(r.moved).toBe(2);
    expect(l.notes.every((n) => n.midi >= KEYBOARDS[25].lo && n.midi <= KEYBOARDS[25].hi)).toBe(true);
  });
  it('folds stray notes when the hand is wider than the keyboard', () => {
    const l = level([note(40, 0, 'rh'), note(60, 1, 'rh'), note(84, 2, 'rh')]);
    const r = applyConstraints(l, { keys: 25, span: 12 });
    expect(l.notes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([52, 60, 72]);
    expect(r.folded).toBe(2);
  });
  it('revoices a left-hand chord wider than the span by folding its top note down', () => {
    const l = level([note(36, 0, 'lh'), note(43, 0, 'lh'), note(52, 0, 'lh')]);
    const r = applyConstraints(l, { keys: 88, span: 9 });
    expect(l.notes.map((n) => n.midi)).toEqual([36, 40, 43]);
    expect(r.revoiced).toBe(1);
  });
  it('drops a note that cannot fold inside', () => {
    const l = level([note(36, 0, 'lh'), note(48, 0, 'lh')]);
    const r = applyConstraints(l, { keys: 88, span: 9 });
    expect(l.notes.map((n) => n.midi)).toEqual([36]);
    expect(r.dropped).toBe(1);
  });
  it("keeps the right hand's melody on top", () => {
    const l = level([note(60, 0, 'rh'), note(76, 0, 'rh')]);
    applyConstraints(l, { keys: 88, span: 12 });
    expect(l.notes.map((n) => n.midi)).toEqual([72, 76]);
  });
  it('changes nothing with the defaults on a catalog song, and fits Canon on 49 keys', () => {
    const song = loadCatalogSong(CATALOG.find((c) => c.id === 'canon-in-d')!);
    const plain = buildArrangement(song);
    const same = buildArrangement(song, { constraints: { keys: 88, span: 12 } });
    expect(same.levels[4].notes.map((n) => n.midi)).toEqual(plain.levels[4].notes.map((n) => n.midi));
    const small = buildArrangement(song, { constraints: { keys: 49, span: 9 } });
    for (const id of [1, 2, 3, 4, 5, 6] as const) {
      expect(small.levels[id].notes.every((n) => n.midi >= 36 && n.midi <= 84)).toBe(true);
    }
    expect(small.levels[4].notes.every((n) => n.finger === undefined || n.finger >= 1)).toBe(true);
  });
});
