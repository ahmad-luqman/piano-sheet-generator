import type { Level, Note } from '../types';
import type { AudioEngine } from '../audio/engine';
import type { InputBus } from '../input/bus';
import { isCorrectKey, isStepSatisfied, matchPress, TIMING, type OpenStep } from './match';

/**
 * listen: everything auto-plays. learn: pauses at each learner onset until it is played.
 * rhythm: keeps time, scores each press against the beat, shows what is coming.
 * perform: keeps time with no hints; the attempt is what counts toward promotion.
 */
export type PlayMode = 'listen' | 'learn' | 'rhythm' | 'perform';
export type Hands = 'both' | 'rh' | 'lh';

/** What happened at one learner onset, reported as soon as the step is settled. */
export interface StepResult {
  beat: number;
  notes: { note: Note; hit: boolean; offsetSec?: number }[];
  wrong: number;        // presses that matched nothing while this step was open
  waitSec?: number;     // learn mode: how long the app waited for the step
}

export interface PlayerCallbacks {
  onPosition?(beat: number): void;
  onWaiting?(required: Note[] | null): void;
  onFeedback?(midi: number, correct: boolean): void;
  onStateChange?(playing: boolean): void;
  onEnd?(): void;
  onStepResult?(result: StepResult): void;
  /** The loop wrapped around: one repetition finished, the next begins. */
  onLoopRestart?(): void;
}

interface Step { beat: number; notes: Note[] }

/**
 * Drives playback. Position is in beats; a fixed-rate tick advances it, schedules
 * audio slightly ahead of time, and in learn mode pauses at each onset the
 * learner is responsible for until they play it. In rhythm and perform modes it
 * keeps going and matches presses to onsets within a time window.
 */
export class Player {
  mode: PlayMode = 'listen';
  hands: Hands = 'both';          // hands the learner plays in practice mode
  tempoScale = 1;
  metronome = false;
  loop: { start: number; end: number } | null = null;
  countInBeats = 0;

  private level: Level | null = null;
  private bpm = 120;
  private beatsPerBar = 4;
  private totalBeats = 0;
  private playing = false;
  private position = 0;              // beats
  private lastTickTime = 0;          // performance.now ms
  private scheduledUpTo = 0;         // beats already handed to the audio engine
  private timer: number | null = null;
  private steps: Step[] = [];
  private stepIdx = 0;
  private waiting: Step | null = null;
  private pressedSinceWait = new Set<number>();
  private waitStarted = 0;           // performance.now ms
  private wrongDuringWait = 0;
  private open: OpenStep[] = [];     // rhythm/perform: onsets currently listening
  private strayWrong = 0;            // wrong presses with no open step, charged to the next one
  private hinted: OpenStep | null = null;
  private activeVisual = new Map<number, { midi: number; end: number }>(); // scheduled note-off in beats for playback highlights
  private nextClickBeat = 0;
  private lookaheadSec = 0.12;

  constructor(private audio: AudioEngine, private bus: InputBus, private cb: PlayerCallbacks = {}) {
    bus.on((ev, on) => { if (on && ev.source !== 'playback') this.userNoteOn(ev.midi); });
  }

  load(level: Level, bpm: number, beatsPerBar: number): void {
    this.stop();
    this.level = level;
    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
    this.totalBeats = level.notes.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0);
    this.rebuildSteps();
  }

  get isPlaying(): boolean { return this.playing; }
  get beat(): number { return this.position; }
  get isWaiting(): boolean { return this.waiting !== null; }
  get duration(): number { return this.totalBeats; }

  setHands(h: Hands): void { this.hands = h; this.closeOpen(true); this.rebuildSteps(); }
  setMode(m: PlayMode): void { this.mode = m; this.clearWait(); this.closeOpen(true); this.rebuildSteps(); }

  private userHand(n: Note): boolean { return this.hands === 'both' || n.hand === this.hands; }
  private get timed(): boolean { return this.mode === 'rhythm' || this.mode === 'perform'; }
  private get learner(): boolean { return this.mode !== 'listen'; }

  private rebuildSteps(): void {
    this.steps = [];
    if (!this.level) return;
    const groups = new Map<number, Note[]>();
    for (const n of this.level.notes) {
      if (!this.userHand(n)) continue;
      const k = Math.round(n.startBeat * 64);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(n);
    }
    this.steps = [...groups.entries()].map(([k, notes]) => ({ beat: k / 64, notes })).sort((a, b) => a.beat - b.beat);
    this.stepIdx = this.steps.findIndex((s) => s.beat >= this.position - 1e-6);
    if (this.stepIdx < 0) this.stepIdx = this.steps.length;
  }

  play(): void {
    if (this.playing || !this.level) return;
    void this.audio.start();
    this.playing = true;
    this.lastTickTime = performance.now();
    if (this.countInBeats > 0) this.position -= this.countInBeats;
    // Scheduling starts from the (possibly negative) count-in position so the clicks are heard.
    this.scheduledUpTo = this.position;
    this.nextClickBeat = Math.ceil(this.position - 1e-6);
    if (this.timed) this.updateOpen(); // an onset on the first beat must be open before the first tick
    this.timer = window.setInterval(() => this.tick(), 20);
    this.cb.onStateChange?.(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.releaseVisuals();
    this.clearWait();
    this.closeOpen(true);
    this.cb.onStateChange?.(false);
  }

  stop(): void {
    this.pause();
    this.seek(this.loop ? this.loop.start : 0);
  }

  seek(beat: number): void {
    this.position = Math.max(0, Math.min(this.totalBeats, beat));
    this.scheduledUpTo = this.position;
    this.releaseVisuals();
    this.clearWait();
    this.closeOpen(true);
    this.stepIdx = this.steps.findIndex((s) => s.beat >= this.position - 1e-6);
    if (this.stepIdx < 0) this.stepIdx = this.steps.length;
    this.nextClickBeat = Math.ceil(this.position - 1e-6);
    this.cb.onPosition?.(this.position);
  }

  setLoop(startBar: number, endBar: number): void {
    this.loop = { start: startBar * this.beatsPerBar, end: (endBar + 1) * this.beatsPerBar };
  }
  clearLoop(): void { this.loop = null; }

  private secPerBeat(): number { return 60 / (this.bpm * this.tempoScale); }

  private tick(): void {
    if (!this.playing || !this.level) return;
    const now = performance.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    if (this.waiting) {
      this.cb.onPosition?.(this.position);
      return; // paused until the learner plays the step
    }

    const prev = this.position;
    this.position += dt / this.secPerBeat();

    // In learn mode, never run past the next learner step.
    const nextStep = this.mode === 'learn' ? this.steps[this.stepIdx] : undefined;
    if (nextStep && this.position >= nextStep.beat) {
      this.position = nextStep.beat;
      this.scheduleRange(prev, this.position + 1e-6, true); // auto-hand notes exactly up to the step
      this.beginWait(nextStep);
      this.expireVisuals();
      this.cb.onPosition?.(this.position);
      return;
    }

    // Audio lookahead: hand notes to the engine slightly before they are due.
    const aheadBeats = this.lookaheadSec / this.secPerBeat();
    let target = this.position + aheadBeats;
    if (nextStep) target = Math.min(target, nextStep.beat);
    if (target > this.scheduledUpTo) {
      this.scheduleRange(this.scheduledUpTo, target, false);
      this.scheduledUpTo = target;
    }
    this.expireVisuals();
    if (this.timed) this.updateOpen();

    const end = this.loop ? this.loop.end : this.totalBeats;
    if (this.position >= end) {
      if (this.loop) { this.closeOpen(true); this.seek(this.loop.start); this.scheduledUpTo = this.position; this.cb.onLoopRestart?.(); if (this.timed) this.updateOpen(); }
      else { this.closeOpen(true); this.pause(); this.seek(0); this.cb.onEnd?.(); return; }
    }
    this.cb.onPosition?.(this.position);
  }

  // ───────────────────────── rhythm / perform ─────────────────────────

  private windowBeats(): number { return TIMING.windowSec / this.secPerBeat(); }

  /** Open every step within the window ahead; settle every step that fell out of the window behind. */
  private updateOpen(): void {
    const w = this.windowBeats();
    while (this.stepIdx < this.steps.length && this.steps[this.stepIdx].beat <= this.position + w) {
      const s = this.steps[this.stepIdx++];
      this.open.push({ beat: s.beat, notes: s.notes, matched: new Map(), wrong: this.strayWrong });
      this.strayWrong = 0;
    }
    while (this.open.length && this.open[0].beat + w < this.position) this.settle(this.open.shift()!);
    this.refreshHint();
  }

  /** Report a step and drop it. `all` settles everything still open (a boundary was reached). */
  private closeOpen(all: boolean): void {
    if (!all) return;
    for (const s of this.open) this.settle(s);
    this.open = [];
    this.strayWrong = 0;
    this.refreshHint();
  }

  private settle(s: OpenStep): void {
    const spb = this.secPerBeat();
    this.cb.onStepResult?.({
      beat: s.beat,
      notes: s.notes.map((note) => { const off = s.matched.get(note); return off === undefined ? { note, hit: false } : { note, hit: true, offsetSec: off * spb }; }),
      wrong: s.wrong,
    });
  }

  /** Rhythm mode shows the earliest onset still expecting a key; perform mode shows nothing. */
  private refreshHint(): void {
    const next = this.mode === 'rhythm' ? this.open.find((s) => s.notes.some((n) => !s.matched.has(n))) ?? null : null;
    if (next === this.hinted) return;
    this.hinted = next;
    this.cb.onWaiting?.(next ? next.notes : null);
  }

  /** Schedule every non-learner note whose onset is in [from, to). */
  private scheduleRange(from: number, to: number, immediate: boolean): void {
    if (!this.level) return;
    const spb = this.secPerBeat();
    const audioNow = this.audio.now();
    for (const n of this.level.notes) {
      if (n.startBeat < from || n.startBeat >= to) continue;
      if (this.learner && this.userHand(n)) continue;
      const delay = immediate ? 0 : Math.max(0, (n.startBeat - this.position) * spb);
      const when = audioNow + delay;
      const durSec = Math.max(0.08, n.durationBeats * spb * 0.95);
      this.audio.play(n.midi, n.velocity, durSec, when);
      window.setTimeout(() => this.visualOn(n), delay * 1000);
    }
    if (this.metronome) {
      while (this.nextClickBeat < to) {
        if (this.nextClickBeat >= from) {
          const accent = Math.abs((this.nextClickBeat % this.beatsPerBar)) < 1e-6;
          this.audio.click(accent, audioNow + Math.max(0, (this.nextClickBeat - this.position) * spb));
        }
        this.nextClickBeat += 1;
      }
    }
  }

  private visualOn(n: Note): void {
    if (!this.playing) return;
    const key = n.midi;
    const end = n.startBeat + n.durationBeats;
    const existing = this.activeVisual.get(key);
    if (existing && existing.end > end) return;
    this.activeVisual.set(key, { midi: key, end });
    this.bus.noteOn(key, n.velocity, 'playback');
  }

  private expireVisuals(): void {
    for (const [k, v] of this.activeVisual) {
      if (this.position >= v.end - 0.02) { this.activeVisual.delete(k); this.bus.noteOff(k, 'playback'); }
    }
  }

  private releaseVisuals(): void {
    for (const k of [...this.activeVisual.keys()]) this.bus.noteOff(k, 'playback');
    this.activeVisual.clear();
    this.audio.releaseAll();
  }

  private beginWait(step: Step): void {
    this.waiting = step;
    this.waitStarted = performance.now();
    this.wrongDuringWait = 0;
    this.pressedSinceWait.clear();
    // Keys already held when the step arrives count (the learner is early).
    for (const m of this.bus.held) if (isCorrectKey(step.notes, m)) this.pressedSinceWait.add(m);
    this.cb.onWaiting?.(step.notes);
    this.checkSatisfied();
  }

  private clearWait(): void {
    if (this.waiting) { this.waiting = null; this.cb.onWaiting?.(null); }
  }

  private userNoteOn(midi: number): void {
    if (this.playing && this.timed) {
      // Position as of this press, not of the last 20 ms tick.
      const live = this.position + (performance.now() - this.lastTickTime) / 1000 / this.secPerBeat();
      const out = matchPress(this.open, midi, live, this.windowBeats());
      if (out.kind === 'hit') out.step.matched.set(out.note, out.offsetBeats);
      else if (out.step) out.step.wrong++;
      else this.strayWrong++;
      this.cb.onFeedback?.(midi, out.kind === 'hit');
      this.refreshHint();
      return;
    }
    if (!this.waiting) return;
    const correct = isCorrectKey(this.waiting.notes, midi);
    this.cb.onFeedback?.(midi, correct);
    if (correct) this.pressedSinceWait.add(midi); else this.wrongDuringWait++;
    this.checkSatisfied();
  }

  private checkSatisfied(): void {
    if (!this.waiting) return;
    if (!isStepSatisfied(this.waiting.notes, this.pressedSinceWait, this.bus.held)) return;
    const step = this.waiting;
    this.waiting = null;
    this.cb.onWaiting?.(null);
    this.cb.onStepResult?.({ beat: step.beat, notes: step.notes.map((note) => ({ note, hit: true })), wrong: this.wrongDuringWait, waitSec: (performance.now() - this.waitStarted) / 1000 });
    this.stepIdx++;
    // Resume just after the step so it is not re-triggered.
    this.position = step.beat + 1e-4;
    this.scheduledUpTo = this.position;
    this.lastTickTime = performance.now();
  }
}
