import { describe, expect, it } from 'vitest';
import { cleanNotes, estimateTempo, notesToSong, TRANSCRIBE } from '../src/input/transcribe';
import { candidatesFromItunes } from '../src/search/canonical';
import { normalizeQuery } from '../src/search/normalize';
import itunes from './fixtures/itunes-yesturday-beetles.json';

const n = (start: number, midi = 60, duration = 0.3, amplitude = 0.8) => ({ start, duration, midi, amplitude });

describe('transcription clean-up', () => {
  it('drops short, quiet and out-of-range notes and sorts by time', () => {
    const kept = cleanNotes([n(1), n(0.5), n(0.7, 60, 0.02), n(0.8, 60, 0.3, 0.05), n(0.9, 20), n(0.95, 110)]);
    expect(kept.map((x) => x.start)).toEqual([0.5, 1]);
  });
});

describe('tempo estimate', () => {
  const grid = (bpm: number, beats: number, jitter = 0.01) => Array.from({ length: beats }, (_, i) => n(i * 60 / bpm + ((i % 3) - 1) * jitter, 60 + (i % 5), 0.2, i % 4 === 0 ? 1 : 0.6));
  it('finds a steady beat', () => {
    expect(Math.abs(estimateTempo(grid(120, 40)) - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(estimateTempo(grid(90, 40)) - 90)).toBeLessThanOrEqual(2);
  });
  it('folds a slow pulse into range and defaults with too few onsets', () => {
    const t = estimateTempo(grid(60, 30));
    expect(t).toBeGreaterThanOrEqual(TRANSCRIBE.bpmMin);
    expect(t).toBeLessThanOrEqual(TRANSCRIBE.bpmMax);
    expect(estimateTempo([n(0), n(1)])).toBe(100);
  });
});

describe('notes to song', () => {
  it('starts on beat 0, keeps pitches, and infers a meter', () => {
    const notes = Array.from({ length: 16 }, (_, i) => n(2 + i * 0.5, 60 + (i % 4), 0.45, i % 4 === 0 ? 1 : 0.5));
    const song = notesToSong(cleanNotes(notes), 120, 'Clip', 'preview');
    expect(song.notes[0].startBeat).toBe(0);
    expect(song.notes[1].startBeat).toBeCloseTo(1, 3);
    expect(song.notes.map((x) => x.midi).slice(0, 4)).toEqual([60, 61, 62, 63]);
    expect(song.bpm).toBe(120);
    expect(song.source).toBe('preview');
    expect([2, 3, 4]).toContain(song.timeSig.num);
  });
  it('refuses an empty transcription', () => {
    expect(() => notesToSong([], 100, 'x', 'hum')).toThrow(/No notes/);
  });
});

describe('search: previews and non-Latin queries', () => {
  it('carries the iTunes preview with each candidate', () => {
    const c = candidatesFromItunes(itunes)[0];
    expect(c.preview?.url).toMatch(/^https:\/\/audio-ssl\.itunes\.apple\.com\//);
    expect(c.preview?.seconds).toBeGreaterThan(60);
    expect(c.preview?.artwork).toMatch(/^https:/);
  });
  it('folds an Urdu-script query to no tokens, which search treats as "ask the lookup"', () => {
    expect(normalizeQuery('دل دل پاکستان').tokens).toEqual([]);
  });
});
