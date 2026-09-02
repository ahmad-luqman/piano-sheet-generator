import type { Level, Note } from '../types';
import type { AudioEngine } from '../audio/engine';
import type { InputBus } from '../input/bus';
import { isCorrectKey, isStepSatisfied } from './match';

export type PlayMode = 'listen' | 'practice';
export type Hands = 'both' | 'rh' | 'lh';

export interface PlayerCallbacks {
  onPosition?(beat: number): void;
  onWaiting?(required: Note[] | null): void;
  onFeedback?(midi: number, correct: boolean): void;
  onStateChange?(playing: boolean): void;
  onEnd?(): void;
}

interface Step { beat: number; notes: Note[] }

/**
 * Drives playback. Position is in beats; a fixed-rate tick advances it, schedules
 * audio slightly ahead of time, and in practice mode pauses at each onset the
 * learner is responsible for until they play it.
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

  setHands(h: Hands): void { this.hands = h; this.rebuildSteps(); }
  setMode(m: PlayMode): void { this.mode = m; this.clearWait(); this.rebuildSteps(); }

  private userHand(n: Note): boolean { return this.hands === 'both' || n.hand === this.hands; }

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
    this.timer = window.setInterval(() => this.tick(), 20);
    this.cb.onStateChange?.(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.releaseVisuals();
    this.clearWait();
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

    // In practice mode, never run past the next learner step.
    const nextStep = this.mode === 'practice' ? this.steps[this.stepIdx] : undefined;
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

    const end = this.loop ? this.loop.end : this.totalBeats;
    if (this.position >= end) {
      if (this.loop) { this.seek(this.loop.start); this.scheduledUpTo = this.position; }
      else { this.pause(); this.seek(0); this.cb.onEnd?.(); return; }
    }
    this.cb.onPosition?.(this.position);
  }

  /** Schedule every non-learner note whose onset is in [from, to). */
  private scheduleRange(from: number, to: number, immediate: boolean): void {
    if (!this.level) return;
    const spb = this.secPerBeat();
    const audioNow = this.audio.now();
    for (const n of this.level.notes) {
      if (n.startBeat < from || n.startBeat >= to) continue;
      if (this.mode === 'practice' && this.userHand(n)) continue;
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
    if (!this.waiting) return;
    const correct = isCorrectKey(this.waiting.notes, midi);
    this.cb.onFeedback?.(midi, correct);
    if (correct) this.pressedSinceWait.add(midi);
    this.checkSatisfied();
  }

  private checkSatisfied(): void {
    if (!this.waiting) return;
    if (!isStepSatisfied(this.waiting.notes, this.pressedSinceWait, this.bus.held)) return;
    const step = this.waiting;
    this.waiting = null;
    this.cb.onWaiting?.(null);
    this.stepIdx++;
    // Resume just after the step so it is not re-triggered.
    this.position = step.beat + 1e-4;
    this.scheduledUpTo = this.position;
    this.lastTickTime = performance.now();
  }
}
