import { describe, expect, it } from 'vitest';
import { buildArrangement, easyTransposition, isBlackKey, makeKey } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';
import { parseDsl } from '../src/catalog/dsl';

const arrOf = (id: string, transposeEarly?: boolean) => buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === id)!), { transposeEarly });
const blacks = (notes: { midi: number }[]) => notes.filter((n) => isBlackKey(n.midi)).length;

describe('easy-key transposition', () => {
  it('moves a D major tune to C for the early stages only', () => {
    const arr = arrOf('canon-in-d');
    expect(arr.key.name).toBe('D major');
    for (const id of [1, 2, 3] as const) {
      expect(arr.levels[id].key.name).toBe('C major');
      expect(arr.levels[id].transpose).toBe(-2);
      expect(blacks(arr.levels[id].notes)).toBe(0);
    }
    for (const id of [4, 5, 6] as const) {
      expect(arr.levels[id].key.name).toBe('D major');
      expect(arr.levels[id].transpose).toBe(0);
    }
    expect(arr.levels[2].chords.map((c) => c.name)).not.toContain('D');
    expect(arr.levels[2].chords.map((c) => c.name)).toContain('C');
  });
  it('leaves a tune alone when it already avoids black keys', () => {
    // Jingle Bells is in G but never touches F#; A minor has no accidentals.
    expect(arrOf('jingle-bells').levels[1].transpose).toBe(0);
    expect(arrOf('jingle-bells').levels[1].key.name).toBe('G major');
    expect(arrOf('fur-elise').levels[1].transpose).toBe(0);
  });
  it('can be switched off', () => {
    const arr = arrOf('canon-in-d', false);
    expect(arr.levels[1].key.name).toBe('D major');
    expect(arr.levels[1].transpose).toBe(0);
  });
  it('does not transpose for a marginal gain', () => {
    // One accidental in twelve notes: not worth moving the whole hand.
    const notes = parseDsl('C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F#5 G5', 0);
    expect(easyTransposition(notes, makeKey(0, 'major')).semitones).toBe(0);
  });
});
