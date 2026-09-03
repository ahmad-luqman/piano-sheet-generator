import { describe, expect, it } from 'vitest';
import { completeObjects, pieceSummary } from '../src/llm/claude';
import { buildArrangement, explainChordRuleBased, romanNumeral, makeKey } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';

describe('streamed JSON extraction', () => {
  it('returns only complete array elements', () => {
    const partial = '{"steps":[{"index":0,"title":"A","body":"x"},{"index":1,"title":"B","body":"y}"},{"index":2,"ti';
    const got = completeObjects<{ index: number }>(partial);
    expect(got.map((g) => g.index)).toEqual([0, 1]);
  });
  it('handles escaped quotes and braces inside strings', () => {
    const partial = '{"steps":[{"index":0,"title":"say \\"hi\\"","body":"{not a brace}"}';
    expect(completeObjects<{ body: string }>(partial)[0].body).toBe('{not a brace}');
  });
  it('is empty before the array opens', () => {
    expect(completeObjects('{"ste')).toEqual([]);
  });
});

describe('piece summary', () => {
  it('is byte-identical across calls and independent of the level', () => {
    const arr = buildArrangement(loadCatalogSong(CATALOG[0]));
    const a = pieceSummary(arr);
    expect(pieceSummary(arr)).toBe(a);
    expect(a).not.toContain('"steps"');
    expect(JSON.parse(a).key).toBe(arr.key.name);
  });
});

describe('theory on demand, rule-based', () => {
  it('names scale degrees', () => {
    const c = makeKey(0, 'major');
    expect(romanNumeral(9, 'min', c)).toBe('vi');
    expect(romanNumeral(7, '7', c)).toBe('V7');
    expect(romanNumeral(11, 'dim', c)).toBe('vii°');
    expect(romanNumeral(1, 'maj', c)).toBeUndefined();
    expect(romanNumeral(4, 'maj', makeKey(9, 'minor'))).toBe('V');
  });
  it('explains a chord with the melody notes of its bar', () => {
    const arr = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'twinkle')!));
    const level = arr.levels[2];
    const chord = level.chords[0];
    const text = explainChordRuleBased(level, chord, 0, arr.beatsPerBar);
    expect(text).toContain('C is C E G, the I chord in C major.');
    expect(text).toContain('In bar 1 the melody plays C G');
    expect(text).toContain('2 of 2 are chord tones.');
  });
  it('uses the transposed key at early stages', () => {
    const arr = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'canon-in-d')!));
    const level = arr.levels[2];
    const am = level.chords.find((c) => c.name === 'Am')!;
    const bar = Math.floor(am.startBeat / arr.beatsPerBar);
    expect(explainChordRuleBased(level, am, bar, arr.beatsPerBar)).toContain('the vi chord in C major');
  });
});
