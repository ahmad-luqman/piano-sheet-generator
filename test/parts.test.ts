import { describe, expect, it } from 'vitest';
import { buildArrangement, pianoParts, suggestStartLevel } from '../src/arrange';
import { parseDsl } from '../src/catalog/dsl';
import { songFromNotes } from '../src/midi/parse';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';

/** A four-track "band" file: lead, piano chords, bass, sustained strings. */
function bandSong() {
  const lead = parseDsl('E5 D5 C5 D5 | E5 E5 E5:2 | D5 D5 D5:2 | E5 G5 G5:2 | E5 D5 C5 D5 | E5 E5 E5 E5 | D5 D5 E5 D5 | C5:4', 0);
  const piano = parseDsl('[C3 E3 G3]:2 [C3 E3 G3]:2 | [C3 E3 G3]:2 [C3 E3 G3]:2 | [G3 B3 D4]:2 [G3 B3 D4]:2 | [C3 E3 G3]:2 [C3 E3 G3]:2 | [C3 E3 G3]:2 [C3 E3 G3]:2 | [C3 E3 G3]:2 [C3 E3 G3]:2 | [G3 B3 D4]:2 [G3 B3 D4]:2 | [C3 E3 G3]:4', 1);
  const bass = parseDsl('C2 C2 C2 C2 | C2 C2 C2 C2 | G2 G2 G2 G2 | C2 C2 C2 C2 | C2 C2 C2 C2 | C2 C2 C2 C2 | G2 G2 G2 G2 | C2:4', 2);
  const strings = parseDsl('[E4 G4]:4 | [E4 G4]:4 | [D4 G4]:4 | [E4 G4]:4 | [E4 G4]:4 | [E4 G4]:4 | [D4 G4]:4 | [E4 G4]:4', 3);
  const song = songFromNotes('Band', [...lead, ...piano, ...bass, ...strings], 100, { num: 4, den: 4 }, 'upload');
  song.tracks = song.tracks.map((t) => ({ ...t, name: ['Lead Synth', 'Piano', 'Bass', 'Strings'][t.index] }));
  return song;
}

describe('original piano parts', () => {
  it('pairs the melody with the piano track on a band file, leaving the rest out', () => {
    const song = bandSong();
    const parts = pianoParts(song, 0);
    expect(parts.partnerTrack).toBe(1);
    expect(parts.rh.every((n) => n.track === 0)).toBe(true);
    expect(parts.lh.every((n) => n.track === 1)).toBe(true);
    const arr = buildArrangement(song, { melodyTrack: 0 });
    expect(arr.partnerTrack).toBe(1);
    expect(arr.levels[6].notes.length).toBe(parts.rh.length + parts.lh.length);
  });
  it('still scores by shape when the tracks are unnamed', () => {
    const song = bandSong();
    song.tracks = song.tracks.map((t) => ({ ...t, name: `Track ${t.index + 1}` }));
    expect(pianoParts(song, 0).partnerTrack).toBe(1);
  });
  it('keeps both tracks of a two-track piano file', () => {
    const song = loadCatalogSong(CATALOG[0]);
    const parts = pianoParts(song, 0);
    expect(parts.partnerTrack).toBe(1);
    expect(parts.rh.length + parts.lh.length).toBe(song.notes.length);
  });
});

describe('suggested start stage', () => {
  it('starts nursery tunes high and Für Elise lower, with a reason', () => {
    const twinkle = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'twinkle')!));
    const elise = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'fur-elise')!));
    expect(twinkle.suggestedLevel!.level).toBeGreaterThanOrEqual(4);
    expect(elise.suggestedLevel!.level).toBeLessThan(twinkle.suggestedLevel!.level);
    expect(elise.suggestedLevel!.reason.length).toBeGreaterThan(10);
  });
  it('never suggests a stage above one that failed', () => {
    const arr = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'fur-elise')!));
    const s = suggestStartLevel(arr.levels, arr.bpm, 0.2);
    expect(s.level).toBeLessThanOrEqual(2);
  });
});
