import { describe, expect, it } from 'vitest';
import { chartToSong, chartVocabulary, extractChart, parseChart, parseChordSymbol, parseKey } from '../src/input/chart';
import { buildArrangement } from '../src/arrange';
import { detectChords } from '../src/arrange/chords';
import { makeKey } from '../src/arrange/theory';

const DDP = `title: Dil Dil Pakistan
artist: Vital Signs
key: D minor
tempo: 87
time: 4/4

[Intro]
Dm | Am | Dm | Am   x2
Bb | C

[Verse]
Dm | C | Am | Dm
Dm | C | Bb | %

[Chorus]
Dm | Bb | C | Am Bb C`;

describe('chord symbols', () => {
  it('reads roots, accidentals, qualities and ignores slash bass', () => {
    expect(parseChordSymbol('Dm')).toEqual({ root: 2, quality: 'min' });
    expect(parseChordSymbol('Bb')).toEqual({ root: 10, quality: 'maj' });
    expect(parseChordSymbol('A#')).toEqual({ root: 10, quality: 'maj' });
    expect(parseChordSymbol('Cmaj7')).toEqual({ root: 0, quality: 'maj7' });
    expect(parseChordSymbol('G7')).toEqual({ root: 7, quality: '7' });
    expect(parseChordSymbol('F#m7/A')).toEqual({ root: 6, quality: 'min7' });
    expect(parseChordSymbol('Bdim')).toEqual({ root: 11, quality: 'dim' });
    expect(parseChordSymbol('Dsus4')).toEqual({ root: 2, quality: 'maj' });
    expect(() => parseChordSymbol('Aisi')).toThrow(/Not a chord|Unknown/);
    expect(() => parseChordSymbol('H')).toThrow();
  });
  it('reads keys', () => {
    expect(parseKey('D minor')).toEqual({ tonic: 2, mode: 'minor' });
    expect(parseKey('Dm')).toEqual({ tonic: 2, mode: 'minor' });
    expect(parseKey('F')).toEqual({ tonic: 5, mode: 'major' });
    expect(parseKey('Bb major')).toEqual({ tonic: 10, mode: 'major' });
  });
});

describe('chart parser', () => {
  const chart = parseChart(DDP);
  it('reads headers, sections, repeats, % and split bars', () => {
    expect(chart.title).toBe('Dil Dil Pakistan');
    expect(chart.bpm).toBe(87);
    expect(chart.key).toEqual({ tonic: 2, mode: 'minor' });
    expect(chart.totalBars).toBe(8 + 2 + 8 + 4);
    expect(chart.sections.map((s) => [s.name, s.startBar, s.endBar])).toEqual([['Intro', 0, 9], ['Verse', 10, 17], ['Chorus', 18, 21]]);
    const last = chart.chords.slice(-3);
    expect(last.map((c) => [c.symbol, c.durationBeats])).toEqual([['Am', 4 / 3], ['Bb', 4 / 3], ['C', 4 / 3]]);
    // "Bb | %" merges into one eight-beat Bb
    const bb = chart.chords.find((c) => c.startBeat === 16 * 4);
    expect(bb?.symbol).toBe('Bb');
    expect(bb?.durationBeats).toBe(8);
  });
  it('rejects lyrics and empty charts with a useful message', () => {
    expect(() => parseChart('Dm | Aisi zameen | Am')).toThrow(/Aisi/);
    expect(() => parseChart('title: x')).toThrow(/No bars/);
  });
  it('lists the vocabulary once each', () => {
    expect(chartVocabulary(chart).map((c) => `${c.root}:${c.quality}`).sort()).toEqual(['0:maj', '10:maj', '2:min', '9:min']);
  });
  it('pulls a chart out of prose with a fence or from the first header', () => {
    expect(extractChart('Here you go:\n```chart\nkey: C\nC | G\n```\nSources: x')).toBe('key: C\nC | G');
    expect(extractChart('blah\n[Verse]\nC | G')).toBe('[Verse]\nC | G');
  });
});

describe('chart to arrangement', () => {
  const chart = parseChart(DDP);
  const song = chartToSong(chart);
  it('builds a two-hand play-along with one right-hand tone per beat', () => {
    expect(song.title).toBe('Dil Dil Pakistan — Vital Signs');
    expect(song.source).toBe('chart');
    const rh = song.notes.filter((n) => n.track === 0);
    expect(rh.slice(0, 4).map((n) => n.midi)).toEqual([62, 65, 69, 65]);
    expect(song.notes.filter((n) => n.track === 1 && n.startBeat === 0).map((n) => n.midi).sort((a, b) => a - b)).toEqual([50, 53, 57]);
    expect(song.totalBeats).toBe(22 * 4);
  });
  it('arranges with the chart chords as given, named in the detected key', () => {
    const arr = buildArrangement(song, { chords: chart.chords });
    expect(arr.chords.map((c) => c.name).slice(0, 5)).toEqual(['Dm', 'Am', 'Dm', 'Am', 'Dm']);
    expect(arr.chords.every((c) => c.confidence === 1)).toBe(true);
    expect(arr.levels[4].notes.some((n) => n.hand === 'lh')).toBe(true);
  });
  it('constrains detection to a vocabulary', () => {
    const key = makeKey(2, 'minor');
    const free = detectChords(song.notes, 4, song.totalBeats, key);
    const constrained = detectChords(song.notes, 4, song.totalBeats, key, [{ root: 2, quality: 'min' }, { root: 9, quality: 'min' }]);
    expect(free.some((c) => c.name === 'C')).toBe(true);
    expect(constrained.every((c) => c.name === 'Dm' || c.name === 'Am')).toBe(true);
  });
});
