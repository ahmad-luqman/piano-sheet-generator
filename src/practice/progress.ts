import type { Arrangement, LevelId, Section, Song } from '../types';
import type { Hands } from './player';
import { barQuality, describeCause, PROMOTION, qualifiesForPromotion, type AttemptScore, type ErrorCause } from './score';

/**
 * Saved progress: per song, per stage, in localStorage. No backend. Bar statistics
 * decay so recent attempts weigh more; fragments (the detected sections) carry a
 * spaced-repetition due date so a daily set can be built from them.
 */

export const STORAGE_KEY = 'psg.progress.v1';
export const DECAY = 0.6;          // weight kept by older attempts when a new one touches the same bar
export const MAX_ATTEMPTS = 30;
export const MAX_INTERVAL_DAYS = 30;

export interface BarStat { notes: number; hits: number; wrong: number; timed: number; onTime: number; pauses: number; attempts: number }

export interface AttemptSummary {
  at: string;
  mode: AttemptScore['mode'];
  hands: Hands;
  tempoScale: number;
  startBar: number;
  endBar: number;
  noteAccuracy: number;
  timingAccuracy?: number;
  wrong: number;
  pauses: number;
  clean: boolean;
  wholePiece: boolean;
  durationSec: number;
  cause?: string;
}

export interface FragmentState {
  section: number;        // canonical section index (a repeat maps to its original)
  attempts: number;
  cleanCount: number;
  lastClean: boolean;
  intervalDays: number;
  due: string;            // ISO date-time
  lastAt: string;
}

export interface StageProgress {
  attempts: AttemptSummary[];
  bars: Record<string, BarStat>;         // "bar:hand"
  causes: Record<string, ErrorCause>;    // decayed counts
  cleanRuns: number;                     // consecutive qualifying clean runs
  cleanReps: number;                     // clean attempts of any kind, for the scaffold
  bestCleanTempo: number;
  earned: boolean;
  fragments: Record<string, FragmentState>;
  /** Difficulty fingerprint values (arrange/difficulty.ts METRIC_KEYS order) of this stage's notes at the song's tempo; feeds the skill profile. */
  fingerprint?: number[];
}

export interface SongProgress {
  key: string;
  title: string;
  stages: Partial<Record<LevelId, StageProgress>>;
  updatedAt: string;
  journal: { at: string; text: string }[];
}

export interface KeyValueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

function browserStorage(): KeyValueStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export class ProgressStore {
  private all: Record<string, SongProgress> | null = null;

  constructor(private storage: KeyValueStorage | null = browserStorage()) {}

  load(): Record<string, SongProgress> {
    if (this.all) return this.all;
    let parsed: unknown = null;
    try { const raw = this.storage?.getItem(STORAGE_KEY); parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    this.all = isRecord(parsed) && parsed.v === 1 && isRecord(parsed.songs) ? (parsed.songs as Record<string, SongProgress>) : {};
    return this.all;
  }

  save(): void {
    if (!this.all) return;
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, songs: this.all })); } catch { /* quota or private mode */ }
  }

  song(key: string, title: string): SongProgress {
    const all = this.load();
    let s = all[key];
    if (!s) { s = { key, title, stages: {}, updatedAt: new Date().toISOString(), journal: [] }; all[key] = s; }
    return s;
  }

  /** The stage record if any attempts were made, without creating one. */
  peek(key: string, level: LevelId): StageProgress | undefined {
    return this.load()[key]?.stages[level];
  }

  stage(song: SongProgress, level: LevelId): StageProgress {
    let st = song.stages[level];
    if (!st) { st = emptyStage(); song.stages[level] = st; }
    return st;
  }

  touch(song: SongProgress): void { song.updatedAt = new Date().toISOString(); this.save(); }
}

export function emptyStage(): StageProgress {
  return { attempts: [], bars: {}, causes: {}, cleanRuns: 0, cleanReps: 0, bestCleanTempo: 0, earned: false, fragments: {} };
}

/** Distinguishes uploads of the same title without depending on the URL. */
export function songKey(arr: Arrangement, song: Song): string {
  return `${arr.title}|${arr.totalBars}|${song.notes.length}|${arr.melodyTrack}`;
}

export interface RecordOutcome { earned: boolean; justEarned: boolean; scaffoldBefore: number; scaffoldAfter: number }

/** Fold one scored attempt into the stage record. */
export function recordAttempt(stage: StageProgress, score: AttemptScore, sections: Section[], handsNeeded: Hands, now = new Date(), fingerprint?: number[]): RecordOutcome {
  const scaffoldBefore = scaffoldLevel(stage);
  if (fingerprint) stage.fingerprint = fingerprint;
  const summary: AttemptSummary = {
    at: score.startedAt, mode: score.mode, hands: score.hands, tempoScale: score.tempoScale, startBar: score.startBar, endBar: score.endBar,
    noteAccuracy: score.noteAccuracy, timingAccuracy: score.timingAccuracy, wrong: score.wrong, pauses: score.pauses,
    clean: score.clean, wholePiece: score.wholePiece, durationSec: score.durationSec, cause: describeCause(score) || undefined,
  };
  stage.attempts.push(summary);
  if (stage.attempts.length > MAX_ATTEMPTS) stage.attempts.splice(0, stage.attempts.length - MAX_ATTEMPTS);

  for (const b of score.bars) {
    const k = `${b.bar}:${b.hand}`;
    const s = stage.bars[k] ?? { notes: 0, hits: 0, wrong: 0, timed: 0, onTime: 0, pauses: 0, attempts: 0 };
    for (const f of ['notes', 'hits', 'wrong', 'timed', 'onTime', 'pauses'] as const) s[f] = round2(s[f] * DECAY + b[f]);
    s.attempts++;
    stage.bars[k] = s;
  }
  for (const c of Object.values(stage.causes)) c.count = round2(c.count * DECAY);
  for (const c of score.causes) {
    const cur = stage.causes[c.key];
    stage.causes[c.key] = cur ? { ...cur, count: round2(cur.count + c.count) } : { ...c };
  }
  for (const [k, c] of Object.entries(stage.causes)) if (c.count < 0.3) delete stage.causes[k];

  // A run the ghost hand helped with proves nothing about the aids or the sections it played.
  const ghosted = score.ghost ?? [];
  const ghostBars = new Set(ghosted.map((c) => parseInt(c, 10)));
  if (score.clean && ghosted.length === 0) stage.cleanReps++;
  const wasEarned = stage.earned;
  if (qualifiesForPromotion(score, handsNeeded)) {
    stage.cleanRuns = score.clean ? stage.cleanRuns + 1 : 0;
    if (score.clean) stage.bestCleanTempo = Math.max(stage.bestCleanTempo, score.tempoScale);
    if (stage.cleanRuns >= PROMOTION.runs) stage.earned = true;
  }

  for (const sec of sections) {
    if (score.startBar > sec.startBar || score.endBar < sec.endBar) continue;
    if ([...ghostBars].some((b) => b >= sec.startBar && b <= sec.endBar)) continue;
    const canon = sec.repeatOf ?? sec.index;
    const key = String(canon);
    const fr = stage.fragments[key] ?? { section: canon, attempts: 0, cleanCount: 0, lastClean: false, intervalDays: 1, due: now.toISOString(), lastAt: now.toISOString() };
    const sectionClean = score.bars.filter((b) => b.bar >= sec.startBar && b.bar <= sec.endBar).every((b) => barQuality(b) >= PROMOTION.notes);
    fr.attempts++;
    fr.lastAt = now.toISOString();
    if (sectionClean) {
      fr.cleanCount++;
      fr.lastClean = true;
      fr.intervalDays = fr.cleanCount === 1 ? 1 : Math.min(MAX_INTERVAL_DAYS, fr.intervalDays * 2);
      fr.due = addDays(now, fr.intervalDays).toISOString();
    } else {
      fr.lastClean = false;
      fr.intervalDays = 1;
      fr.due = now.toISOString();
    }
    stage.fragments[key] = fr;
  }
  return { earned: stage.earned, justEarned: stage.earned && !wasEarned, scaffoldBefore, scaffoldAfter: scaffoldLevel(stage) };
}

/** 0 = every aid, 1 = finger numbers gone, 2 = letters gone too, 3 = falling notes gone: notation only. */
export function scaffoldLevel(stage: StageProgress | undefined): number {
  if (!stage) return 0;
  return Math.min(3, Math.floor(stage.cleanReps / PROMOTION.fadeRuns));
}

export const SCAFFOLD_NAMES = ['finger numbers', 'letter names', 'falling notes'];

export type FragmentKind = 'new' | 'weak' | 'mastered';

export function fragmentKind(stage: StageProgress | undefined, section: Section): FragmentKind {
  const fr = stage?.fragments[String(section.repeatOf ?? section.index)];
  if (!fr) return 'new';
  return fr.cleanCount >= 2 && fr.lastClean ? 'mastered' : 'weak';
}

/** Average bar quality across a section, 1 when nothing was recorded there. */
export function sectionQuality(stage: StageProgress, section: Section): number {
  const qs: number[] = [];
  for (const [k, b] of Object.entries(stage.bars)) {
    const bar = parseInt(k, 10);
    if (bar >= section.startBar && bar <= section.endBar) qs.push(barQuality(b));
  }
  return qs.length ? qs.reduce((s, q) => s + q, 0) / qs.length : 1;
}

export interface DailyItem { kind: FragmentKind; section: Section }

/**
 * Today's set: one section never tried, the weakest section, and one mastered section
 * whose spaced-repetition date has come. Repeats count as their original.
 */
export function dailySet(stage: StageProgress | undefined, sections: Section[], now = new Date()): DailyItem[] {
  const originals = sections.filter((s) => s.repeatOf === undefined);
  const out: DailyItem[] = [];
  const fresh = originals.find((s) => fragmentKind(stage, s) === 'new');
  if (fresh) out.push({ kind: 'new', section: fresh });
  if (stage) {
    const weak = originals.filter((s) => fragmentKind(stage, s) === 'weak')
      .sort((a, b) => sectionQuality(stage, a) - sectionQuality(stage, b))[0];
    if (weak) out.push({ kind: 'weak', section: weak });
    const due = originals.filter((s) => fragmentKind(stage, s) === 'mastered' && new Date(stage.fragments[String(s.index)].due) <= now)
      .sort((a, b) => new Date(stage.fragments[String(a.index)].due).getTime() - new Date(stage.fragments[String(b.index)].due).getTime())[0];
    if (due) out.push({ kind: 'mastered', section: due });
  }
  return out;
}

function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * 86400000); }
function isRecord(x: unknown): x is Record<string, unknown> { return typeof x === 'object' && x !== null; }
function round2(x: number): number { return Math.round(x * 100) / 100; }
