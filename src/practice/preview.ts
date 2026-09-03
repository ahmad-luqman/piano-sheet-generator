import type { Note } from '../types';
import type { AudioEngine } from '../audio/engine';

/**
 * Plays a short note list once through the piano sound, independent of the Player so
 * the loaded song is untouched. Notes are handed to the engine a third of a second
 * ahead, so stopping takes effect almost at once.
 */
export class Preview {
  onStop?: () => void;
  private timer: number | null = null;
  private endTimer: number | null = null;

  constructor(private audio: AudioEngine) {}

  get active(): boolean { return this.timer !== null || this.endTimer !== null; }

  play(notes: Note[], bpm: number): void {
    this.stop();
    if (notes.length === 0) return;
    const spb = 60 / Math.max(1, bpm);
    const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
    const first = sorted[0].startBeat;
    const t0 = this.audio.now() + 0.08;
    const lookahead = 0.35;
    let i = 0;
    const tick = () => {
      const horizon = this.audio.now() + lookahead;
      while (i < sorted.length) {
        const n = sorted[i];
        const when = t0 + (n.startBeat - first) * spb;
        if (when > horizon) break;
        this.audio.play(n.midi, n.velocity, n.durationBeats * spb, when);
        i++;
      }
      if (i < sorted.length) return;
      if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
      const last = sorted[sorted.length - 1];
      const endsIn = (t0 + (last.startBeat - first + last.durationBeats) * spb - this.audio.now()) * 1000;
      this.endTimer = window.setTimeout(() => { this.endTimer = null; this.onStop?.(); }, Math.max(0, endsIn) + 150);
    };
    this.timer = window.setInterval(tick, 100);
    tick();
  }

  stop(): void {
    if (!this.active) return;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.timer = null; this.endTimer = null;
    this.audio.releaseAll();
    this.onStop?.();
  }
}
