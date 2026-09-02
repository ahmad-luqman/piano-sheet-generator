import type { Song } from '../types';
import { songFromNotes } from '../midi/parse';
import { parseDsl } from './dsl';

export interface CatalogEntry {
  id: string;
  title: string;
  composer: string;
  bpm: number;
  timeSig: { num: number; den: number };
  rh: string;
  lh: string;
}

/** Public-domain pieces, hand-entered. RH = track 0, LH = track 1. */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'twinkle', title: 'Twinkle Twinkle Little Star', composer: 'Traditional', bpm: 100, timeSig: { num: 4, den: 4 },
    rh: `C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2`,
    lh: `[C3 E3 G3]:4 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [G3 B3 D4]:2 [C3 E3 G3]:2 | [C3 E3 G3]:2 [F3 A3 C4]:2 | [C3 E3 G3]:2 [G3 B3 D4]:2 | [C3 E3 G3]:2 [F3 A3 C4]:2 | [C3 E3 G3]:2 [G3 B3 D4]:2 | [C3 E3 G3]:4 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [G3 B3 D4]:2 [C3 E3 G3]:2`,
  },
  {
    id: 'ode-to-joy', title: 'Ode to Joy', composer: 'Ludwig van Beethoven', bpm: 108, timeSig: { num: 4, den: 4 },
    rh: `E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2`,
    lh: `C3:4 | C3:2 G3:2 | C3:4 | G3:4 | C3:4 | C3:2 G3:2 | C3:2 G3:2 | G3:2 C3:2`,
  },
  {
    id: 'mary-lamb', title: 'Mary Had a Little Lamb', composer: 'Traditional', bpm: 104, timeSig: { num: 4, den: 4 },
    rh: `E4 D4 C4 D4 | E4 E4 E4:2 | D4 D4 D4:2 | E4 G4 G4:2 | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4`,
    lh: `[C3 E3 G3]:4 | [C3 E3 G3]:4 | [G3 B3 D4]:4 | [C3 E3 G3]:4 | [C3 E3 G3]:4 | [C3 E3 G3]:4 | [G3 B3 D4]:4 | [C3 E3 G3]:4`,
  },
  {
    id: 'happy-birthday', title: 'Happy Birthday', composer: 'Patty & Mildred Hill', bpm: 110, timeSig: { num: 3, den: 4 },
    rh: `r:2 G4:0.5 G4:0.5 | A4 G4 C5 | B4:2 G4:0.5 G4:0.5 | A4 G4 D5 | C5:2 G4:0.5 G4:0.5 | G5 E5 C5 | B4 A4 F5:0.5 F5:0.5 | E5 C5 D5 | C5:3`,
    lh: `r:3 | C3:3 | G3:3 | G3:3 | C3:3 | C3:3 | F3:3 | G3:3 | C3:3`,
  },
  {
    id: 'jingle-bells', title: 'Jingle Bells (chorus)', composer: 'James Lord Pierpont', bpm: 120, timeSig: { num: 4, den: 4 },
    rh: `B4 B4 B4:2 | B4 B4 B4:2 | B4 D5 G4:1.5 A4:0.5 | B4:4 | C5 C5 C5:1.5 C5:0.5 | C5 B4 B4 B4:0.5 B4:0.5 | B4 A4 A4 B4 | A4:2 D5:2 | B4 B4 B4:2 | B4 B4 B4:2 | B4 D5 G4:1.5 A4:0.5 | B4:4 | C5 C5 C5:1.5 C5:0.5 | C5 B4 B4 B4:0.5 B4:0.5 | D5 D5 C5 A4 | G4:4`,
    lh: `G3:4 | G3:4 | G3:4 | G3:4 | C3:4 | G3:4 | D3:4 | D3:4 | G3:4 | G3:4 | G3:4 | G3:4 | C3:4 | G3:4 | D3:4 | G3:4`,
  },
  {
    id: 'minuet-in-g', title: 'Minuet in G (opening)', composer: 'Christian Petzold', bpm: 112, timeSig: { num: 3, den: 4 },
    rh: `D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5 G4 G4 | E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5 G4 G4 | C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | B4 A4:2`,
    lh: `[G3 B3]:3 | G3:3 | C3:3 | B3:3 | A3:3 | G3:3 | D3:3 | D3:1 D3:2`,
  },
  {
    id: 'fur-elise', title: 'Für Elise (opening)', composer: 'Ludwig van Beethoven', bpm: 72, timeSig: { num: 3, den: 8 },
    rh: `r:1 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 G#4:0.25 B4:0.25 | C5:0.5 r:0.25 E4:0.25 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:1 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:1.5`,
    lh: `r:1.5 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75`,
  },
  {
    id: 'canon-in-d', title: 'Canon in D (simplified)', composer: 'Johann Pachelbel', bpm: 60, timeSig: { num: 4, den: 4 },
    rh: `F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 | D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 | D4 F#4 A4 G4 | F#4 D4 F#4 E4 | D4 B3 D4 A4 | G4 B4 A4 G4 | F#4 D4 E4 C#5 | D5 F#5 A5 A4 | B4 G4 A4 F#4 | D4 D5 D5 C#5`,
    lh: `[D3 F#3 A3]:4 | [A2 C#3 E3]:4 | [B2 D3 F#3]:4 | [F#2 A2 C#3]:4 | [G2 B2 D3]:4 | [D3 F#3 A3]:4 | [G2 B2 D3]:4 | [A2 C#3 E3]:4 | [D3 F#3 A3]:4 | [A2 C#3 E3]:4 | [B2 D3 F#3]:4 | [F#2 A2 C#3]:4 | [G2 B2 D3]:4 | [D3 F#3 A3]:4 | [G2 B2 D3]:4 | [A2 C#3 E3]:4`,
  },
];

export function loadCatalogSong(entry: CatalogEntry): Song {
  const notes = [...parseDsl(entry.rh, 0, 0.85), ...parseDsl(entry.lh, 1, 0.65)];
  const song = songFromNotes(entry.title, notes, entry.bpm, entry.timeSig, 'catalog');
  song.tracks = song.tracks.map((t) => ({ ...t, name: t.index === 0 ? 'Right hand' : 'Left hand' }));
  return song;
}

export function findCatalog(query: string): CatalogEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return CATALOG;
  return CATALOG.filter((e) => e.title.toLowerCase().includes(q) || e.composer.toLowerCase().includes(q) || e.id.includes(q));
}
