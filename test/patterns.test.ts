import { describe, expect, it } from 'vitest';
import { alberti, brokenChords, defaultPattern, fifths, lhNotes, lhNotesBySection, waltz } from '../src/arrange/patterns';
import { makeKey } from '../src/arrange/theory';
import type { Chord } from '../src/types';

const key = makeKey(0, 'major');
const C: Chord = { startBeat: 0, durationBeats: 4, root: 0, quality: 'maj', name: 'C', pitches: [48, 52, 55], confidence: 1 };
const G3: Chord = { startBeat: 0, durationBeats: 3, root: 7, quality: 'maj', name: 'G', pitches: [55, 59, 62], confidence: 1 };
void key;

describe('left-hand patterns', () => {
  it('fifths: root and fifth on each half-bar hit in 4/4', () => {
    const n = fifths([C], 4);
    expect(n.map((x) => x.midi)).toEqual([48, 55, 48, 55]);
    expect(n.map((x) => x.startBeat)).toEqual([0, 0, 2, 2]);
  });
  it('broken: root third fifth octave in quarters', () => {
    expect(brokenChords([C], 4).map((x) => x.midi)).toEqual([48, 52, 55, 60]);
  });
  it('alberti: low high middle high in eighths', () => {
    const n = alberti([C]);
    expect(n.length).toBe(8);
    expect(n.slice(0, 4).map((x) => x.midi)).toEqual([48, 55, 52, 55]);
    expect(n[1].startBeat).toBe(0.5);
  });
  it('waltz: root on one, two-note chord on two and three', () => {
    const n = waltz([G3], 3);
    expect(n.map((x) => `${x.startBeat}:${x.midi}`)).toEqual(['0:55', '1:59', '1:62', '2:59', '2:62']);
  });
  it('picks the default texture by meter and tempo', () => {
    expect(defaultPattern({ num: 3, den: 4 }, 120)).toBe('waltz');
    expect(defaultPattern({ num: 6, den: 8 }, 90)).toBe('broken');
    expect(defaultPattern({ num: 4, den: 4 }, 100)).toBe('alberti');
    expect(defaultPattern({ num: 4, den: 4 }, 160)).toBe('broken');
  });
  it('clips chords to a per-section window', () => {
    const long: Chord = { ...C, durationBeats: 8 };
    const n = lhNotesBySection([{ start: 0, end: 4, pattern: 'block' }, { start: 4, end: 8, pattern: 'alberti' }], [long], 4);
    expect(n.filter((x) => x.startBeat < 4).length).toBe(6);      // two block hits × 3 notes
    expect(n.filter((x) => x.startBeat >= 4).length).toBe(8);     // eight alberti eighths
    expect(lhNotes('bass', [long], 4, 48, { start: 4, end: 8 })[0].startBeat).toBe(4);
  });
});
