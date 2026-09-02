import type { Hand, Note } from '../types';

export type KeyState = 'off' | 'user' | 'playback' | 'hint' | 'wrong';

export interface PianoView {
  /** Notes to show as falling notes, plus timing. */
  setNotes(notes: Note[]): void;
  setPosition(beat: number): void;
  setKeyState(midi: number, state: KeyState, hand?: Hand): void;
  setHints(notes: Note[] | null): void;
  setKeyLabels(labels: Map<number, string>): void;
  setShowLabels(on: boolean): void;
  /** Frame the camera on a key range (3D) — called when a level loads. */
  setFocusRange(lowMidi: number, highMidi: number): void;
  resetView(): void;
  dispose(): void;
  onKeyPress?: (midi: number) => void;
  onKeyRelease?: (midi: number) => void;
  readonly kind: '3d' | '2d';
}

export const HAND_COLORS: Record<Hand, string> = { rh: '#3b82f6', lh: '#f97316' };
export const STATE_COLORS: Record<Exclude<KeyState, 'off' | 'playback'>, string> = {
  user: '#22c55e', hint: '#facc15', wrong: '#ef4444',
};

/** Boomwhacker-style rainbow per pitch class; used on the beginner sheet. */
export const PC_COLORS = ['#e53935', '#f4511e', '#fb8c00', '#ffb300', '#fdd835', '#c0ca33', '#43a047', '#00897b', '#00acc1', '#1e88e5', '#5e35b1', '#8e24aa'];

export const FIRST_KEY = 21;   // A0
export const LAST_KEY = 108;   // C8
