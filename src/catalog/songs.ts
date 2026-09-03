import type { Song } from '../types';
import { songFromNotes } from '../midi/parse';
import { parseDsl } from './dsl';
import { fold, normalizeQuery, type NormalizedQuery } from '../search/normalize';

export interface CatalogEntry {
  id: string;
  title: string;
  composer: string;
  /** Other names people search by: formal titles, nicknames, common misspellings. */
  aliases?: string[];
  bpm: number;
  timeSig: { num: number; den: number };
  rh: string;
  lh: string;
}

/** Public-domain pieces, hand-entered. RH = track 0, LH = track 1. */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'twinkle', title: 'Twinkle Twinkle Little Star', composer: 'Traditional', aliases: ['Twinkle Twinkle', 'Ah vous dirai-je Maman', 'ABC song'], bpm: 100, timeSig: { num: 4, den: 4 },
    rh: `C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2`,
    lh: `[C3 E3 G3]:4 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [G3 B3 D4]:2 [C3 E3 G3]:2 | [C3 E3 G3]:2 [F3 A3 C4]:2 | [C3 E3 G3]:2 [G3 B3 D4]:2 | [C3 E3 G3]:2 [F3 A3 C4]:2 | [C3 E3 G3]:2 [G3 B3 D4]:2 | [C3 E3 G3]:4 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [F3 A3 C4]:2 [C3 E3 G3]:2 | [G3 B3 D4]:2 [C3 E3 G3]:2`,
  },
  {
    id: 'ode-to-joy', title: 'Ode to Joy', composer: 'Ludwig van Beethoven', aliases: ['Symphony No. 9', 'Ninth Symphony', 'Freude schöner Götterfunken', 'Hymn to Joy'], bpm: 108, timeSig: { num: 4, den: 4 },
    rh: `E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2`,
    lh: `C3:4 | C3:2 G3:2 | C3:4 | G3:4 | C3:4 | C3:2 G3:2 | C3:2 G3:2 | G3:2 C3:2`,
  },
  {
    id: 'mary-lamb', title: 'Mary Had a Little Lamb', composer: 'Traditional', aliases: ['Mary Had a Little Lamb'], bpm: 104, timeSig: { num: 4, den: 4 },
    rh: `E4 D4 C4 D4 | E4 E4 E4:2 | D4 D4 D4:2 | E4 G4 G4:2 | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4`,
    lh: `[C3 E3 G3]:4 | [C3 E3 G3]:4 | [G3 B3 D4]:4 | [C3 E3 G3]:4 | [C3 E3 G3]:4 | [C3 E3 G3]:4 | [G3 B3 D4]:4 | [C3 E3 G3]:4`,
  },
  {
    id: 'happy-birthday', title: 'Happy Birthday', composer: 'Patty & Mildred Hill', aliases: ['Happy Birthday to You', 'Good Morning to All'], bpm: 110, timeSig: { num: 3, den: 4 },
    rh: `r:2 G4:0.5 G4:0.5 | A4 G4 C5 | B4:2 G4:0.5 G4:0.5 | A4 G4 D5 | C5:2 G4:0.5 G4:0.5 | G5 E5 C5 | B4 A4 F5:0.5 F5:0.5 | E5 C5 D5 | C5:3`,
    lh: `r:3 | C3:3 | G3:3 | G3:3 | C3:3 | C3:3 | F3:3 | G3:3 | C3:3`,
  },
  {
    id: 'jingle-bells', title: 'Jingle Bells (chorus)', composer: 'James Lord Pierpont', aliases: ['Jingle Bells', 'One Horse Open Sleigh'], bpm: 120, timeSig: { num: 4, den: 4 },
    rh: `B4 B4 B4:2 | B4 B4 B4:2 | B4 D5 G4:1.5 A4:0.5 | B4:4 | C5 C5 C5:1.5 C5:0.5 | C5 B4 B4 B4:0.5 B4:0.5 | B4 A4 A4 B4 | A4:2 D5:2 | B4 B4 B4:2 | B4 B4 B4:2 | B4 D5 G4:1.5 A4:0.5 | B4:4 | C5 C5 C5:1.5 C5:0.5 | C5 B4 B4 B4:0.5 B4:0.5 | D5 D5 C5 A4 | G4:4`,
    lh: `G3:4 | G3:4 | G3:4 | G3:4 | C3:4 | G3:4 | D3:4 | D3:4 | G3:4 | G3:4 | G3:4 | G3:4 | C3:4 | G3:4 | D3:4 | G3:4`,
  },
  {
    id: 'minuet-in-g', title: 'Minuet in G (opening)', composer: 'Christian Petzold', aliases: ['Minuet in G major', 'Bach Minuet', 'Notebook for Anna Magdalena Bach', 'BWV Anh. 114'], bpm: 112, timeSig: { num: 3, den: 4 },
    rh: `D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5 G4 G4 | E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5 G4 G4 | C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | B4 A4:2`,
    lh: `[G3 B3]:3 | G3:3 | C3:3 | B3:3 | A3:3 | G3:3 | D3:3 | D3:1 D3:2`,
  },
  {
    id: 'fur-elise', title: 'Für Elise (opening)', composer: 'Ludwig van Beethoven', aliases: ['Bagatelle No. 25', 'Bagatelle in A minor', 'Fuer Elise', 'Fur Elise', 'For Elise', 'WoO 59'], bpm: 72, timeSig: { num: 3, den: 8 },
    rh: `r:1 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 G#4:0.25 B4:0.25 | C5:0.5 r:0.25 E4:0.25 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:1 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:1.5`,
    lh: `r:1.5 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75`,
  },
  {
    id: 'canon-in-d', title: 'Canon in D (simplified)', composer: 'Johann Pachelbel', aliases: ["Pachelbel's Canon", 'Canon and Gigue in D', 'Kanon in D'], bpm: 60, timeSig: { num: 4, den: 4 },
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

/**
 * Fuzzy catalog lookup: title, aliases, composer and id, accent-folded, with token prefixes
 * ("twink") and one-typo tolerance ("twinkel"). Empty query returns everything. Results are
 * ordered best match first.
 */
export function findCatalog(query: string): CatalogEntry[] {
  const q = normalizeQuery(query);
  if (q.tokens.length === 0) return CATALOG;
  return CATALOG
    .map((e) => ({ e, s: catalogScore(e, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);
}

/** 0 = no match; otherwise higher is better. */
export function catalogScore(entry: CatalogEntry, q: NormalizedQuery): number {
  const names = [entry.title, ...(entry.aliases ?? [])].map(fold);
  const composer = fold(entry.composer);
  const haystack = [...names, composer, entry.id.replace(/-/g, ' ')].join(' ').split(' ').filter(Boolean);
  const qTokens = q.significant;
  let best = 0;
  for (const name of names) {
    if (name === q.folded) best = Math.max(best, 3);
    else if (` ${name} `.includes(` ${q.folded} `)) best = Math.max(best, 2);
  }
  if (` ${composer} `.includes(` ${q.folded} `)) best = Math.max(best, 2);
  const hits = qTokens.filter((t) => haystack.some((h) => tokenMatches(t, h))).length;
  const coverage = hits / qTokens.length;
  // At least half the meaningful words must land somewhere, or it is not this song.
  if (coverage < 0.5) return 0;
  return best + coverage;
}

function tokenMatches(q: string, h: string): boolean {
  if (q === h) return true;
  if (q.length >= 4 && h.startsWith(q)) return true;
  if (q.length >= 5 && editDistance(q, h) <= 1) return true;
  if (q.length >= 8 && editDistance(q, h) <= 2) return true;
  return false;
}

/** Optimal string alignment distance (Levenshtein plus adjacent transposition). */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}
