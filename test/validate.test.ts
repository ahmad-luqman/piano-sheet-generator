import { describe, expect, it } from 'vitest';
import { songFromTranscription, syllableCount, validMnemonics, validPicks } from '../src/llm/validate';

describe('recommendation picks', () => {
  it('keeps only catalog ids, in order, without repeats', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(validPicks({ picks: [{ id: 'b', reason: 'x' }, { id: 'zzz', reason: 'made up' }, { id: 'b', reason: 'again' }, { id: 'a' }] }, ids)).toEqual([{ id: 'b', reason: 'x' }, { id: 'a', reason: '' }]);
    expect(validPicks({ nope: 1 }, ids)).toEqual([]);
  });
});

describe('mnemonics', () => {
  it('counts hyphenated syllables and ignores punctuation', () => {
    expect(syllableCount('Twin-kle twin-kle lit-tle star')).toBe(7);
    expect(syllableCount("Ma-ry had a lit-tle lamb, it's fun!")).toBe(9);
    expect(syllableCount('')).toBe(0);
  });
  it('drops sections whose count is wrong', () => {
    const got = validMnemonics({ sections: [{ section: 0, words: 'Twin-kle twin-kle lit-tle star' }, { section: 1, words: 'too short' }, { section: 9, words: 'no such' }] },
      [{ section: 0, noteCount: 7 }, { section: 1, noteCount: 7 }]);
    expect(got).toEqual([{ section: 0, words: 'Twin-kle twin-kle lit-tle star' }]);
  });
});

describe('sheet photo transcription', () => {
  it('builds a song from valid DSL and defaults odd metadata', () => {
    const song = songFromTranscription({ title: 'Test', bpm: 999, timeSig: { num: 3, den: 7 }, rh: 'C4 D4 E4:2 | r:1 G4:0.5 A4:0.5 [C5 E5]:2', lh: 'C3:3' });
    expect(song.notes.filter((n) => n.track === 0)).toHaveLength(7);
    expect(song.bpm).toBe(100);
    expect(song.timeSig).toEqual({ num: 3, den: 4 });
    expect(song.source).toBe('photo');
  });
  it('rejects a made-up token and too few notes', () => {
    expect(() => songFromTranscription({ title: '', bpm: 100, timeSig: { num: 4, den: 4 }, rh: 'C4 H4 E4 F4' })).toThrow(/Bad note name/);
    expect(() => songFromTranscription({ title: '', bpm: 100, timeSig: { num: 4, den: 4 }, rh: 'C4 D4' })).toThrow(/Only 2 melody notes/);
  });
});

describe('multi-page sheet photos', () => {
  it('joins pages end to end from the longer hand of each page', async () => {
    const { songFromPages } = await import('../src/llm/validate');
    const p1 = { title: 'Song', bpm: 120, timeSig: { num: 4, den: 4 }, rh: 'C4 D4 E4 F4', lh: 'C3:4 | C3:2' };
    const p2 = { title: 'Song', bpm: 120, timeSig: { num: 4, den: 4 }, rh: 'G4 A4', lh: 'G3:2' };
    const song = songFromPages([p1, p2]);
    const rh = song.notes.filter((n) => n.track === 0).map((n) => [n.midi, n.startBeat]);
    expect(rh).toEqual([[60, 0], [62, 1], [64, 2], [65, 3], [67, 6], [69, 7]]);
    expect(song.notes.filter((n) => n.track === 1).map((n) => n.startBeat)).toEqual([0, 4, 6]);
  });
});
