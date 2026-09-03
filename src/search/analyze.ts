import type { LevelId, Note, Song, TrackInfo } from '../types';
import { parseMidi } from '../midi/parse';
import { buildArrangement } from '../arrange';
import { fingerprint, describeFingerprint, type DifficultyFingerprint } from '../arrange/difficulty';
import { scoreMelodyTracks } from '../arrange/melody';
import { pianoParts } from '../arrange/levels';
import { downloadMidi, type SearchResult } from './bitmidi';

/**
 * Version analysis: what a search hit turns into once the file is downloaded and run
 * through the arrangement pipeline, so the learner can tell the clean piano upload from
 * the band arrangement without loading each one.
 *
 * `analyzeMidi` is pure over the bytes. `analyzeVersion` adds the download and a cache
 * keyed by URL, and keeps the parsed song so picking a version needs no second download.
 */

export type Instrumentation = 'piano' | 'piano-plus' | 'band';

export interface VersionAnalysis {
  id: string;
  name: string;
  valid: boolean;
  error?: string;
  song?: Song;
  durationSec: number;
  bars: number;
  trackCount: number;                 // pitched tracks with notes
  noteCount: number;                  // whole file
  pianoNoteCount: number;             // notes in the two piano parts the learner would get at stage 6
  lhNoteCount: number;                // of those, notes in the left-hand part (0 = melody only)
  instrumentation: Instrumentation;
  instruments: string[];              // distinct General MIDI families, "drums" included
  handSplit: number;                  // 0 = the two hands overlap or nothing separates them, 1 = clean
  melodyConfidence: number;           // 0 = a guess between similar tracks, 1 = one track clearly leads
  fingerprint?: DifficultyFingerprint; // of the original piano parts
  suggestedLevel?: { level: LevelId; reason: string };
  preview: Note[];                    // first eight bars of stage 1, for the sampler
  bpm: number;
  beatsPerBar: number;
}

export const PREVIEW_BARS = 8;

export function invalidAnalysis(id: string, name: string, error: string): VersionAnalysis {
  return {
    id, name, valid: false, error, durationSec: 0, bars: 0, trackCount: 0, noteCount: 0, pianoNoteCount: 0, lhNoteCount: 0,
    instrumentation: 'band', instruments: [], handSplit: 0, melodyConfidence: 0, preview: [], bpm: 0, beatsPerBar: 4,
  };
}

export function analyzeMidi(buf: ArrayBuffer, id: string, name: string): VersionAnalysis {
  const invalid = (error: string) => invalidAnalysis(id, name, error);
  let song: Song;
  try { song = parseMidi(buf, name, 'bitmidi'); } catch (err) { return invalid(`not a readable MIDI file (${msg(err)})`); }
  if (song.notes.length === 0) return invalid('no notes');
  let arr;
  try { arr = buildArrangement(song); } catch (err) { return invalid(`could not arrange (${msg(err)})`); }
  const parts = pianoParts(song, arr.melodyTrack);
  const original = arr.levels[6].notes;
  const families = [...new Set(song.tracks.map((t) => familyOf(t)))];
  if (song.hasDrums) families.push('drums');
  return {
    id, name, valid: true, song,
    durationSec: round1(song.totalBeats * 60 / Math.max(1, song.bpm)),
    bars: arr.totalBars, trackCount: song.tracks.length, noteCount: song.notes.length,
    pianoNoteCount: parts.rh.length + parts.lh.length, lhNoteCount: parts.lh.length,
    instrumentation: instrumentation(song, arr.melodyTrack, arr.partnerTrack),
    instruments: families,
    handSplit: handSplitClarity(song, parts, arr.partnerTrack),
    melodyConfidence: melodyConfidence(song),
    fingerprint: fingerprint(original, song.bpm),
    suggestedLevel: arr.suggestedLevel,
    preview: arr.levels[1].notes.filter((n) => n.startBeat < PREVIEW_BARS * song.beatsPerBar),
    bpm: song.bpm, beatsPerBar: song.beatsPerBar,
  };
}

// ───────────────────────── the three judgement calls ─────────────────────────

/** A track's General MIDI family. A file without program changes defaults to program 0, a piano, and so does a track without a family. */
function familyOf(t: TrackInfo): string {
  return t.family && t.family !== 'piano' ? t.family : 'piano';
}

/**
 * "piano": every pitched track is a piano and there are no drums and at most four tracks.
 * "piano-plus": the melody and its partner are pianos, but other instruments (or drums, or a
 * pile of default-program tracks) are in the file. "band": the learner's parts are not pianos.
 */
function instrumentation(song: Song, melodyTrack: number, partnerTrack: number | undefined): Instrumentation {
  const tracks = song.tracks;
  const isPiano = (i: number | undefined) => { const t = tracks.find((x) => x.index === i); return !t || familyOf(t) === 'piano'; };
  const allPiano = tracks.every((t) => familyOf(t) === 'piano');
  if (allPiano && !song.hasDrums && tracks.length <= 4) return 'piano';
  if (isPiano(melodyTrack) && isPiano(partnerTrack)) return 'piano-plus';
  return 'band';
}

/**
 * How cleanly the two piano parts separate: named left/right tracks are trusted; otherwise
 * the gap between the right hand's lowest tenth and the left hand's highest tenth percentile,
 * where a gap of six semitones is fully clear and an overlap of six is hopeless. A single
 * track split at middle C is discounted because the split itself was a guess.
 */
function handSplitClarity(song: Song, parts: { rh: { midi: number }[]; lh: { midi: number }[] }, partnerTrack: number | undefined): number {
  if (parts.rh.length === 0 || parts.lh.length === 0) return 0;
  const rhLow = percentile(parts.rh.map((n) => n.midi), 0.1);
  const lhHigh = percentile(parts.lh.map((n) => n.midi), 0.9);
  let clarity = clamp((rhLow - lhHigh + 6) / 12);
  const partner = song.tracks.find((t) => t.index === partnerTrack);
  if (partner && /\b(left|lh|l\.h)\b/i.test(partner.name)) clarity = Math.max(clarity, 0.9);
  if (song.tracks.length <= 1) clarity *= 0.6;
  return round2(clarity);
}

/**
 * How sure the melody pick is: the margin between the best and second-best melody-track
 * score, scaled so a quarter-point lead is convincing, then discounted when the winner is
 * itself chordal (a polyphonic "melody" track is often a piano reduction, not a tune).
 */
function melodyConfidence(song: Song): number {
  const scored = scoreMelodyTracks(song);
  if (scored.length === 0) return 0;
  const top = scored[0];
  const mono = 1 - top.track.polyphony;
  const margin = scored.length > 1 ? top.score - scored[1].score : 0.5;
  return round2(clamp(0.4 + margin * 2) * (0.5 + 0.5 * mono));
}

// ───────────────────────── recommendation and sorts ─────────────────────────

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — which upload should the learner get by default?
 *
 *  Search ranking says which *song* a file is; this says which *file* of that song
 *  a beginner wants. Piano-only files lead, then files whose learner parts are
 *  pianos among other instruments, then band arrangements. Within that, a clean
 *  hand split and a confident melody pick each add up to their weight, a plausible
 *  length (between half a minute and eight minutes) adds one, and a stub with under
 *  fifty notes loses two. Invalid files sink. Ties keep the search order.
 *
 *  "Closest to original" (the sort, not the score) is defined as the most complete
 *  piano transcription in the group: piano-part note count relative to the group's
 *  largest, weighted by duration relative to the longest. The opposite of a
 *  melody-only stub. There is no reference recording to compare against.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const RECOMMEND = {
  piano: 3,
  pianoPlus: 1.5,
  band: 0,
  handSplit: 2,      // × clarity 0..1
  melody: 1.5,       // × confidence 0..1
  length: 1,         // when 30 s ≤ duration ≤ 8 min
  stub: -2,          // fewer than 50 notes in the piano parts
  invalid: -100,
};

export function recommendScore(a: VersionAnalysis): number {
  if (!a.valid) return RECOMMEND.invalid;
  let s = a.instrumentation === 'piano' ? RECOMMEND.piano : a.instrumentation === 'piano-plus' ? RECOMMEND.pianoPlus : RECOMMEND.band;
  s += RECOMMEND.handSplit * a.handSplit + RECOMMEND.melody * a.melodyConfidence;
  if (a.durationSec >= 30 && a.durationSec <= 480) s += RECOMMEND.length;
  if (a.pianoNoteCount < 50) s += RECOMMEND.stub;
  return round2(s);
}

export type VersionSort = 'best' | 'easiest' | 'original' | 'popular' | 'piano';

export const SORT_META: Record<VersionSort, string> = {
  best: 'Best match',
  easiest: 'Easiest',
  original: 'Closest to original',
  popular: 'Most popular',
  piano: 'Piano only first',
};

/** Completeness of a transcription relative to the rest of its group, 0..1. */
export function completeness(a: VersionAnalysis, group: VersionAnalysis[]): number {
  const valid = group.filter((g) => g.valid);
  const maxNotes = Math.max(1, ...valid.map((g) => g.pianoNoteCount));
  const maxDur = Math.max(1, ...valid.map((g) => g.durationSec));
  return a.valid ? round2((a.pianoNoteCount / maxNotes) * Math.min(1, a.durationSec / maxDur)) : 0;
}

/**
 * Order a group's versions. Analysed files sort by the chosen criterion; files not yet
 * analysed keep their search order after them, so the list is stable while downloads run.
 */
export function sortVersions<T extends { id: string; views?: number }>(
  versions: T[], analyses: Map<string, VersionAnalysis>, sort: VersionSort,
): T[] {
  const known = versions.filter((v) => analyses.has(v.id));
  const unknown = versions.filter((v) => !analyses.has(v.id));
  const group = known.map((v) => analyses.get(v.id)!);
  const a = (v: T) => analyses.get(v.id)!;
  const rec = (v: T) => recommendScore(a(v));
  const cmp: Record<VersionSort, (x: T, y: T) => number> = {
    best: (x, y) => rec(y) - rec(x),
    easiest: (x, y) => (a(x).valid ? a(x).fingerprint!.overall : 9) - (a(y).valid ? a(y).fingerprint!.overall : 9) || rec(y) - rec(x),
    original: (x, y) => completeness(a(y), group) - completeness(a(x), group) || rec(y) - rec(x),
    popular: (x, y) => (a(y).valid ? y.views ?? 0 : -1) - (a(x).valid ? x.views ?? 0 : -1) || rec(y) - rec(x),
    piano: (x, y) => pianoRank(a(x)) - pianoRank(a(y)) || rec(y) - rec(x),
  };
  // Stable sort: equal keys keep search order.
  const indexed = known.map((v, i) => ({ v, i }));
  indexed.sort((p, q) => cmp[sort](p.v, q.v) || p.i - q.i);
  return [...indexed.map((p) => p.v), ...unknown];
}

function pianoRank(a: VersionAnalysis): number {
  return !a.valid ? 3 : a.instrumentation === 'piano' ? 0 : a.instrumentation === 'piano-plus' ? 1 : 2;
}

// ───────────────────────── badges ─────────────────────────

export interface Badge { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; title?: string }

/** The badge row for one version card: instrumentation, length, hands, melody, difficulty. */
export function describeVersion(a: VersionAnalysis): Badge[] {
  if (!a.valid) return [{ text: a.error ?? 'unreadable', tone: 'bad' }];
  const out: Badge[] = [];
  const others = a.instruments.filter((f) => f !== 'piano');
  if (a.instrumentation === 'piano') out.push({ text: 'piano only', tone: 'good', title: `${a.trackCount} piano track${a.trackCount === 1 ? '' : 's'}` });
  else if (a.instrumentation === 'piano-plus') out.push({ text: 'piano + ' + (others.length ? others.slice(0, 3).join(', ') : 'others'), tone: 'neutral', title: `${a.trackCount} tracks; the learner gets the piano parts` });
  else out.push({ text: 'band', tone: 'warn', title: `${a.trackCount} tracks: ${a.instruments.join(', ')}. The melody and partner are not pianos.` });
  out.push({ text: duration(a.durationSec) + ` · ${a.bars} bars`, tone: a.durationSec < 30 ? 'warn' : 'neutral', title: `${a.noteCount} notes in the file` });
  if (a.pianoNoteCount < 50) out.push({ text: 'very few notes', tone: 'bad', title: `only ${a.pianoNoteCount} notes in the piano parts` });
  if (a.trackCount === 1) out.push({ text: 'single track', tone: 'warn', title: 'hands split at middle C' });
  if (a.lhNoteCount === 0) out.push({ text: 'no left hand', tone: 'warn', title: 'the file carries only a melody; stages 2–5 generate the left hand' });
  else out.push(a.handSplit >= 0.7
    ? { text: 'clear hands', tone: 'good', title: `hand split clarity ${a.handSplit}` }
    : a.handSplit >= 0.4 ? { text: 'hands overlap', tone: 'warn', title: `hand split clarity ${a.handSplit}` }
    : { text: 'unclear hands', tone: 'bad', title: `hand split clarity ${a.handSplit}` });
  if (a.melodyConfidence < 0.5) out.push({ text: 'melody uncertain', tone: 'warn', title: `melody confidence ${a.melodyConfidence}; pick the track by hand if it sounds wrong` });
  if (a.fingerprint) for (const word of describeFingerprint(a.fingerprint)) out.push({ text: word, tone: word === 'beginner' || word === 'easy' ? 'good' : word === 'advanced' ? 'warn' : 'neutral', title: `difficulty ${a.fingerprint.overall}` });
  if (a.suggestedLevel) out.push({ text: `start at stage ${a.suggestedLevel.level}`, tone: 'neutral', title: a.suggestedLevel.reason });
  return out;
}

export function duration(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

// ───────────────────────── download + cache ─────────────────────────

const CACHE_MAX = 40;
const pending = new Map<string, Promise<VersionAnalysis>>();
const settled = new Map<string, VersionAnalysis>();

/** The analysis for a result if it has already completed; never triggers work. */
export function cachedAnalysis(r: { downloadUrl: string }): VersionAnalysis | undefined {
  return settled.get(r.downloadUrl);
}

/** Download, parse and analyse one result. Concurrent callers share the download; failures are not cached. */
export function analyzeVersion(r: SearchResult, signal?: AbortSignal): Promise<VersionAnalysis> {
  const key = r.downloadUrl;
  const hit = settled.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (p) return p;
  p = (async () => {
    let a: VersionAnalysis;
    try {
      const buf = await downloadMidi(key, signal);
      a = analyzeMidi(buf, r.id, r.name);
    } catch (err) {
      if (signal?.aborted) throw err;
      a = invalidAnalysis(r.id, r.name, msg(err));
    }
    if (settled.size >= CACHE_MAX) settled.delete(settled.keys().next().value!);
    settled.set(key, a);
    return a;
  })();
  pending.set(key, p);
  p.finally(() => pending.delete(key)).catch(() => { /* reported to the caller */ });
  return p;
}

/** Analyse the top `limit` results with at most `concurrency` downloads in flight; `onEach` fires as each settles. */
export async function analyzeVersions(
  versions: SearchResult[], opts: { limit?: number; concurrency?: number; signal?: AbortSignal; onEach?: (a: VersionAnalysis) => void } = {},
): Promise<VersionAnalysis[]> {
  const queue = versions.filter((v) => v.source !== 'catalog' && v.downloadUrl).slice(0, opts.limit ?? 6);
  const out: VersionAnalysis[] = [];
  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, async () => {
    while (queue.length && !opts.signal?.aborted) {
      const v = queue.shift()!;
      try { const a = await analyzeVersion(v, opts.signal); out.push(a); opts.onEach?.(a); } catch { /* aborted */ }
    }
  });
  await Promise.all(workers);
  return out;
}

// ───────────────────────── helpers ─────────────────────────

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
function clamp(x: number): number { return Math.min(1, Math.max(0, x)); }
function round1(x: number): number { return Math.round(x * 10) / 10; }
function round2(x: number): number { return Math.round(x * 100) / 100; }
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
