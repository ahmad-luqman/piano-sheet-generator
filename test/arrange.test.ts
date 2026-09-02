import { describe, expect, it } from 'vitest';
import { buildArrangement, detectChords, detectKey, makeKey, simplifyMelodyForBeginner, skyline } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';
import { parseDsl } from '../src/catalog/dsl';
import { detectSections } from '../src/arrange/sections';

describe('key detection', () => {
  it('finds C major from a C major scale', () => {
    const notes = parseDsl('C4 D4 E4 F4 G4 A4 B4 C5:2 G4 E4 C4:3', 0);
    expect(detectKey(notes).name).toBe('C major');
  });
  it('finds A minor when the leading tone G# is present', () => {
    const notes = parseDsl('A4:2 C5 E5 G#4 A4:2 E4 A3:2 C4 E4 G#4 A4:3', 0);
    expect(detectKey(notes).name).toBe('A minor');
  });
  it('uses flats for F major', () => {
    expect(makeKey(5, 'major').useFlats).toBe(true);
    expect(makeKey(7, 'major').sharps).toBe(1);
  });
});

describe('chord detection', () => {
  const key = makeKey(0, 'major');
  it('names simple triads and sevenths', () => {
    const notes = parseDsl('[C3 E3 G3]:4 | [A3 C4 E4]:4 | [G3 B3 D4 F4]:4', 0);
    const chords = detectChords(notes, 4, 12, key);
    expect(chords.map((c) => c.name)).toEqual(['C', 'Am', 'G7']);
  });
  it('splits a bar when the harmony changes on beat 3', () => {
    const notes = parseDsl('[C3 E3 G3]:2 [F3 A3 C4]:2', 0);
    const chords = detectChords(notes, 4, 4, key);
    expect(chords.map((c) => c.name)).toEqual(['C', 'F']);
    expect(chords[1].startBeat).toBe(2);
  });
  it('merges repeated chords across bars', () => {
    const notes = parseDsl('[C3 E3 G3]:4 | [C3 E3 G3]:4', 0);
    const chords = detectChords(notes, 4, 8, key);
    expect(chords).toHaveLength(1);
    expect(chords[0].durationBeats).toBe(8);
  });
});

describe('melody simplification', () => {
  it('skyline keeps the top voice of chords', () => {
    const notes = parseDsl('[C4 E4 G4]:1 [D4 F4 A4]:1', 0);
    expect(skyline(notes).map((n) => n.midi)).toEqual([67, 69]);
  });
  it('drops ornaments and snaps to the eighth grid', () => {
    const notes = parseDsl('C4:0.9 D4:0.1 E4:1.1 F5:0.9', 0);
    const out = simplifyMelodyForBeginner(notes, 0.5);
    expect(out.map((n) => n.midi)).toEqual([60, 64, 77]);
    expect(out.every((n) => Number.isInteger(n.startBeat * 2))).toBe(true);
  });
  it('folds notes far from the centre back by an octave', () => {
    const notes = parseDsl('C4 D4 E4 C4 D4 E4 C6:1 C4', 0);
    const out = simplifyMelodyForBeginner(notes, 0.5);
    expect(Math.max(...out.map((n) => n.midi))).toBeLessThan(84);
  });
});

describe('sections', () => {
  it('detects an exact 4-bar repeat', () => {
    const song = loadCatalogSong(CATALOG.find((c) => c.id === 'jingle-bells')!);
    const arr = buildArrangement(song);
    const secs = detectSections(arr.levels[1].notes, arr.totalBars, arr.beatsPerBar);
    expect(secs[2].repeatOf).toBe(0);
    expect(secs[2].label).toBe('A');
  });
});

describe('catalog end to end', () => {
  for (const entry of CATALOG) {
    it(`builds all four levels for ${entry.title}`, () => {
      const song = loadCatalogSong(entry);
      const arr = buildArrangement(song);
      expect(arr.totalBars).toBeGreaterThan(0);
      expect(arr.levels[1].notes.every((n) => n.hand === 'rh')).toBe(true);
      expect(arr.levels[2].notes.some((n) => n.hand === 'lh')).toBe(true);
      expect(arr.levels[3].notes.filter((n) => n.hand === 'lh').length).toBeGreaterThan(arr.levels[2].notes.filter((n) => n.hand === 'lh').length);
      expect(arr.levels[4].notes.length).toBe(song.notes.length);
      expect(arr.chords.length).toBeGreaterThan(0);
      for (const n of arr.levels[1].notes) expect(n.finger).toBeGreaterThanOrEqual(1);
    });
  }
  it('detects the right key for the known-key pieces', () => {
    const expectKey = (id: string, name: string) => expect(buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === id)!)).key.name).toBe(name);
    expectKey('twinkle', 'C major');
    expectKey('canon-in-d', 'D major');
    expectKey('fur-elise', 'A minor');
    expectKey('minuet-in-g', 'G major');
  });
  it('detects chords with a bass line (Ode to Joy bar 1 is C)', () => {
    const arr = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'ode-to-joy')!));
    expect(arr.chords[0].name).toBe('C');
  });
});
