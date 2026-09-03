import type { Hand, Level, LevelId, Note } from '../types';
import { TIMING } from './match';
import type { Hands, PlayMode, StepResult } from './player';

/**
 * Scoring: turn the per-onset results the player reports into per-bar, per-hand
 * numbers and one verdict for the attempt. Pure, so it can be tested and so the
 * progress store and the next-action rule can share it.
 */

export interface AttemptMeta {
  level: LevelId;
  mode: Exclude<PlayMode, 'listen'>;
  hands: Hands;
  tempoScale: number;
  startBar: number;      // 0-based inclusive
  endBar: number;        // 0-based inclusive
  startedAt: string;     // ISO
  durationSec: number;
}

export interface BarScore {
  bar: number;
  hand: Hand;
  notes: number;
  hits: number;
  wrong: number;
  timed: number;         // hits with a measured offset
  onTime: number;        // of those, within TIMING.goodSec
  pauses: number;        // learn mode waits longer than PROMOTION.pauseSec
}

export interface ErrorCause {
  key: string;           // "G4>D5" or "G4"
  label: string;         // "the G4→D5 jump"
  bar: number;
  hand: Hand;
  count: number;
}

export interface AttemptScore extends AttemptMeta {
  notes: number;
  hits: number;
  wrong: number;
  timed: number;
  onTime: number;
  pauses: number;
  noteAccuracy: number;          // hits / notes
  timingAccuracy?: number;       // onTime / timed; absent in learn mode
  bars: BarScore[];
  causes: ErrorCause[];          // most frequent first
  clean: boolean;
  wholePiece: boolean;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT #4 — when is a run clean, and when is a stage earned?
 *
 *  Decided 2026-09-04. A run is clean at 90% of its notes hit, no more than one
 *  wrong press per ten notes, and (in Rhythm or Perform) 80% of hits on time, or
 *  (in Learn) no wait longer than two seconds. A stage is earned after two
 *  consecutive clean whole-piece runs with the hands the stage needs, in a timed
 *  mode, at 80% tempo or faster. Learn runs never promote: they feed the bar heat
 *  map, the next drill and the scaffold fade-out, which drops one reading aid for
 *  every two clean runs of any kind.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const PROMOTION = {
  notes: 0.9,
  timing: 0.8,
  wrongPerNote: 0.1,
  pauseSec: 2,
  tempo: 0.8,
  runs: 2,
  fadeRuns: 2,
};

export function scoreAttempt(meta: AttemptMeta, results: StepResult[], level: Level, beatsPerBar: number, totalBars: number): AttemptScore {
  const bars = new Map<string, BarScore>();
  const barOf = (bar: number, hand: Hand): BarScore => {
    const k = `${bar}:${hand}`;
    let b = bars.get(k);
    if (!b) { b = { bar, hand, notes: 0, hits: 0, wrong: 0, timed: 0, onTime: 0, pauses: 0 }; bars.set(k, b); }
    return b;
  };
  const causes = new Map<string, ErrorCause>();
  const blame = (n: Note, count = 1) => {
    const prev = previousNote(level.notes, n);
    const key = prev ? `${name(prev)}>${name(n)}` : name(n);
    const c = causes.get(key) ?? { key, label: prev ? `the ${name(prev)}→${name(n)} ${jumpWord(prev, n)}` : `the first note ${name(n)}`, bar: Math.floor(n.startBeat / beatsPerBar), hand: n.hand, count: 0 };
    c.count += count;
    causes.set(key, c);
  };
  for (const r of results) {
    if (r.notes.length === 0) continue;
    for (const { note, hit, offsetSec } of r.notes) {
      const b = barOf(Math.floor(note.startBeat / beatsPerBar), note.hand);
      b.notes++;
      if (hit) b.hits++; else blame(note);
      if (offsetSec !== undefined) { b.timed++; if (Math.abs(offsetSec) <= TIMING.goodSec) b.onTime++; }
    }
    const first = r.notes[0].note;
    const b = barOf(Math.floor(first.startBeat / beatsPerBar), first.hand);
    b.wrong += r.wrong;
    if (r.wrong) blame(first, r.wrong);
    if (r.waitSec !== undefined && r.waitSec > PROMOTION.pauseSec) b.pauses++;
  }
  const list = [...bars.values()].sort((a, b) => a.bar - b.bar || (a.hand === 'rh' ? -1 : 1));
  const sum = (k: keyof Omit<BarScore, 'bar' | 'hand'>) => list.reduce((s, b) => s + b[k], 0);
  const notes = sum('notes'), hits = sum('hits'), wrong = sum('wrong'), timed = sum('timed'), onTime = sum('onTime'), pauses = sum('pauses');
  const timedMode = meta.mode !== 'learn';
  const noteAccuracy = notes ? round2(hits / notes) : 0;
  const timingAccuracy = timedMode ? (timed ? round2(onTime / timed) : 0) : undefined;
  const clean = notes > 0 && noteAccuracy >= PROMOTION.notes && wrong <= notes * PROMOTION.wrongPerNote
    && (timedMode ? (timingAccuracy ?? 0) >= PROMOTION.timing : pauses === 0);
  return {
    ...meta, notes, hits, wrong, timed, onTime, pauses, noteAccuracy, timingAccuracy, bars: list,
    causes: [...causes.values()].sort((a, b) => b.count - a.count), clean,
    wholePiece: meta.startBar <= 0 && meta.endBar >= totalBars - 1,
  };
}

/** Does this attempt count toward earning the stage? */
export function qualifiesForPromotion(s: AttemptScore, handsNeeded: Hands): boolean {
  return s.wholePiece && s.mode !== 'learn' && s.hands === handsNeeded && s.tempoScale >= PROMOTION.tempo - 1e-6;
}

/** "The G4→D5 jump caused 4 of your 6 errors." Empty when no single cause dominates. */
export function describeCause(s: { causes: ErrorCause[]; hits: number; notes: number; wrong: number }): string {
  const errors = s.notes - s.hits + s.wrong;
  const top = s.causes[0];
  if (!top || errors < 2 || top.count < 2 || top.count / errors < 0.4) return '';
  return `${cap(top.label)} caused ${top.count} of your ${errors} error${errors === 1 ? '' : 's'}.`;
}

/** 0..1 quality of one bar-hand: hits, timing when measured, minus wrong presses and pauses. */
export function barQuality(b: { notes: number; hits: number; wrong: number; timed: number; onTime: number; pauses: number }): number {
  if (b.notes <= 0) return 1;
  const hit = b.hits / b.notes;
  const timing = b.timed > 0 ? 0.5 + 0.5 * (b.onTime / b.timed) : 1;
  return Math.max(0, Math.min(1, hit * timing - 0.3 * (b.wrong / b.notes) - 0.2 * Math.min(1, b.pauses / b.notes)));
}

function previousNote(notes: Note[], n: Note): Note | undefined {
  let best: Note | undefined;
  for (const x of notes) {
    if (x.hand !== n.hand || x.startBeat >= n.startBeat - 1e-6) continue;
    if (!best || x.startBeat > best.startBeat || (x.startBeat === best.startBeat && x.midi > best.midi)) best = x;
  }
  return best;
}

function name(n: Note): string { return `${n.letter}${n.octave}`; }
function jumpWord(a: Note, b: Note): string {
  const d = Math.abs(a.midi - b.midi);
  return d === 0 ? 'repeat' : d <= 2 ? 'step' : d <= 4 ? 'move' : 'jump';
}
function cap(s: string): string { return s[0].toUpperCase() + s.slice(1); }
function round2(x: number): number { return Math.round(x * 100) / 100; }
