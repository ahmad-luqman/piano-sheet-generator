import type { ChordQuality, RawNote, Song } from '../types';
import { songFromNotes } from '../midi/parse';
import { voiceChord } from '../arrange/chords';

/**
 * Chord charts as a source. The format is what people already write on chord sites:
 *
 *   title: Dil Dil Pakistan
 *   artist: Vital Signs
 *   key: D minor
 *   tempo: 87
 *   time: 4/4
 *
 *   [Intro]
 *   Dm | Am | Dm | Am   x2
 *   Bb | C
 *   [Chorus]
 *   Dm | Bb | C | Am Bb C
 *
 * Bars are separated by "|"; several chords in one bar share it equally; "%" repeats the
 * previous bar; "x2" repeats the line; "N.C." is a bar with no chord. Anything that is not a
 * chord symbol is an error, which is what validates a chart the model wrote.
 */

export interface ChartChord { startBeat: number; durationBeats: number; root: number; quality: ChordQuality; symbol: string }
export interface ChartSection { name: string; startBar: number; endBar: number }
export interface Chart {
  title?: string;
  artist?: string;
  key?: { tonic: number; mode: 'major' | 'minor' };
  bpm: number;
  timeSig: { num: number; den: number };
  chords: ChartChord[];
  sections: ChartSection[];
  totalBars: number;
}

const ROOTS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY: [RegExp, ChordQuality][] = [
  [/^(maj7|M7|Δ7?|ma7)$/, 'maj7'],
  [/^(m7|-7|min7|mi7)$/, 'min7'],
  [/^(m|min|mi|-)$/, 'min'],
  [/^(dim7?|°|o7?)$/, 'dim'],
  [/^(aug|\+)$/, 'aug'],
  [/^(7|9|11|13|dom7)$/, '7'],
  [/^(|maj|M|sus2|sus4|sus|add9|6|2|5)$/, 'maj'],
  [/^(m6|m9|min9|m11|madd9)$/, 'min'],
];

/** "Bbm7/F" → root 10, min7. Throws on anything that is not a chord symbol. */
export function parseChordSymbol(sym: string): { root: number; quality: ChordQuality } {
  const m = /^([A-G])([#♯b♭]?)([^/]*)(?:\/([A-G][#♯b♭]?))?$/.exec(sym.trim());
  if (!m) throw new Error(`Not a chord symbol: “${sym}”`);
  const root = (ROOTS[m[1]] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0) + 12) % 12;
  const q = QUALITY.find(([re]) => re.test(m[3]));
  if (!q) throw new Error(`Unknown chord quality in “${sym}”`);
  return { root, quality: q[1] };
}

export function parseKey(text: string): { tonic: number; mode: 'major' | 'minor' } | undefined {
  const m = /^([A-G])([#♯b♭]?)\s*(m\b|min|minor|-|major|maj)?/i.exec(text.trim());
  if (!m) return undefined;
  const tonic = (ROOTS[m[1].toUpperCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0) + 12) % 12;
  const mode = m[3] && /^(m|min|minor|-)$/i.test(m[3]) ? 'minor' : 'major';
  return { tonic, mode };
}

export function parseChart(text: string): Chart {
  const chart: Chart = { bpm: 100, timeSig: { num: 4, den: 4 }, chords: [], sections: [], totalBars: 0 };
  const bars: { chords: (ChartChord | null)[]; symbols: string[] }[] = [];
  let section: ChartSection | undefined;
  const lines = text.replace(/\r/g, '').split('\n');
  for (let raw of lines) {
    let line = raw.replace(/#.*$|\/\/.*$/, '').trim();
    if (!line) continue;
    const header = /^(title|artist|key|tempo|bpm|time|meter)\s*[:=]\s*(.+)$/i.exec(line);
    if (header) {
      const [, k, v] = header;
      switch (k.toLowerCase()) {
        case 'title': chart.title = v.trim(); break;
        case 'artist': chart.artist = v.trim(); break;
        case 'key': chart.key = parseKey(v); break;
        case 'tempo': case 'bpm': { const n = parseFloat(v); if (n >= 30 && n <= 300) chart.bpm = Math.round(n); break; }
        case 'time': case 'meter': { const t = /(\d+)\s*\/\s*(\d+)/.exec(v); if (t) chart.timeSig = { num: parseInt(t[1], 10), den: parseInt(t[2], 10) }; break; }
      }
      continue;
    }
    const sec = /^\[([^\]]+)\]$/.exec(line) ?? /^([A-Za-z][A-Za-z0-9 '’-]{1,30}):$/.exec(line);
    if (sec) {
      if (section) section.endBar = bars.length - 1;
      section = { name: sec[1].trim(), startBar: bars.length, endBar: bars.length };
      chart.sections.push(section);
      continue;
    }
    let repeat = 1;
    const rep = /\s*[x×]\s*(\d+)\s*$/i.exec(line);
    if (rep) { repeat = Math.max(1, Math.min(16, parseInt(rep[1], 10))); line = line.slice(0, rep.index); }
    const lineBars: typeof bars = [];
    for (const cell of line.split('|').map((c) => c.trim())) {
      if (!cell) continue;
      if (cell === '%' || cell === '-' || cell === '/') { const prev = lineBars[lineBars.length - 1] ?? bars[bars.length - 1]; if (prev) lineBars.push({ chords: [...prev.chords], symbols: [...prev.symbols] }); continue; }
      const symbols = cell.split(/\s+/);
      const chords = symbols.map((s) => (/^n\.?c\.?$/i.test(s) ? null : { ...parseChordSymbol(s), symbol: s, startBeat: 0, durationBeats: 0 }));
      lineBars.push({ chords, symbols });
    }
    for (let r = 0; r < repeat; r++) bars.push(...lineBars.map((b) => ({ chords: [...b.chords], symbols: [...b.symbols] })));
  }
  if (section) section.endBar = bars.length - 1;
  if (bars.length === 0) throw new Error('No bars found. Write chords separated by | for bars.');
  const bpb = chart.timeSig.num * (4 / chart.timeSig.den);
  let last: ChartChord | undefined;
  bars.forEach((bar, i) => {
    const n = bar.chords.length;
    bar.chords.forEach((c, j) => {
      const startBeat = i * bpb + (j * bpb) / n, durationBeats = bpb / n;
      if (!c) { last = undefined; return; }
      if (last && last.root === c.root && last.quality === c.quality && Math.abs(last.startBeat + last.durationBeats - startBeat) < 1e-6) { last.durationBeats += durationBeats; return; }
      last = { ...c, startBeat, durationBeats };
      chart.chords.push(last);
    });
  });
  if (chart.chords.length === 0) throw new Error('The chart has no chords, only N.C. bars.');
  chart.totalBars = bars.length;
  return chart;
}

/**
 * A play-along from the chart alone: the left hand holds each chord as a block, the right hand
 * cycles its tones one per beat (root, third, fifth, third), the pattern ChatGPT and most
 * teachers hand a beginner. The melody is not here; that has to come from a recording or a score.
 */
export function chartToSong(chart: Chart, title?: string): Song {
  const notes: RawNote[] = [];
  const bpb = chart.timeSig.num * (4 / chart.timeSig.den);
  for (const c of chart.chords) {
    const lh = voiceChord(c.root, c.quality, 48);
    for (const midi of lh) notes.push({ midi, startBeat: c.startBeat, durationBeats: c.durationBeats, velocity: 0.6, track: 1 });
    const tones = voiceChord(c.root, c.quality, 60);
    const cycle = [tones[0], tones[1], tones[2] ?? tones[0], tones[1]];
    const beats = Math.max(1, Math.round(c.durationBeats));
    for (let b = 0; b < beats; b++) {
      const start = c.startBeat + b * (c.durationBeats / beats);
      notes.push({ midi: cycle[b % cycle.length], startBeat: round3(start), durationBeats: round3(c.durationBeats / beats), velocity: 0.75, track: 0 });
    }
  }
  const name = title ?? chart.title ?? 'Chord chart';
  const song = songFromNotes(chart.artist ? `${name} — ${chart.artist}` : name, notes, chart.bpm, chart.timeSig, 'chart');
  void bpb;
  return song;
}

/** The distinct chords of a chart, for constraining detection on a transcribed song. */
export function chartVocabulary(chart: Chart): { root: number; quality: ChordQuality }[] {
  const seen = new Map<string, { root: number; quality: ChordQuality }>();
  for (const c of chart.chords) seen.set(`${c.root}:${c.quality}`, { root: c.root, quality: c.quality });
  return [...seen.values()];
}

/** Pull a chart out of prose: a ```chart fence, else everything from the first header or section line. */
export function extractChart(text: string): string {
  const fence = /```(?:chart|text)?\s*\n([\s\S]*?)```/.exec(text);
  if (fence) return fence[1].trim();
  const i = text.search(/^(title|artist|key|tempo|time)\s*:|^\[[^\]]+\]$/im);
  return i >= 0 ? text.slice(i).trim() : text.trim();
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
