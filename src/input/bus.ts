export type NoteSource = 'keyboard' | 'midi' | 'pointer' | 'playback';

export interface NoteEvent { midi: number; velocity: number; source: NoteSource }
export type NoteListener = (ev: NoteEvent, on: boolean) => void;

/** Central note-event hub: every input device and the auto-player publish here. */
export class InputBus {
  private listeners = new Set<NoteListener>();
  readonly held = new Set<number>();          // keys held by the human
  readonly playbackHeld = new Set<number>();  // keys held by the auto-player

  on(l: NoteListener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  noteOn(midi: number, velocity = 0.8, source: NoteSource = 'keyboard'): void {
    if (midi < 21 || midi > 108) return;
    (source === 'playback' ? this.playbackHeld : this.held).add(midi);
    for (const l of this.listeners) l({ midi, velocity, source }, true);
  }

  noteOff(midi: number, source: NoteSource = 'keyboard'): void {
    (source === 'playback' ? this.playbackHeld : this.held).delete(midi);
    for (const l of this.listeners) l({ midi, velocity: 0, source }, false);
  }

  releaseAll(source: NoteSource): void {
    const set = source === 'playback' ? this.playbackHeld : this.held;
    for (const m of [...set]) this.noteOff(m, source);
  }
}
