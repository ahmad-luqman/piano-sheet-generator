import type { Note } from '../types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  YOUR DECISION POINT #2 — when has the learner "played" a step?
 *
 *  Learn mode pauses at each onset until this returns true. `required` are the
 *  notes the learner is responsible for at this onset (one melody note, or a
 *  chord of two to four notes). `pressedSinceWait` is every key pressed since the
 *  pause began; `heldNow` is what is currently held down.
 *
 *  Default: every required pitch must have been pressed since the pause began
 *  (octave-exact), and wrong notes are tolerated. Alternatives: accept the same
 *  pitch class in any octave for very young learners; require all chord notes to
 *  be held simultaneously; or accept a majority of a chord.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function isStepSatisfied(required: Note[], pressedSinceWait: Set<number>, heldNow: Set<number>): boolean {
  void heldNow;
  return required.every((n) => pressedSinceWait.has(n.midi));
}

/** Is this key part of the required set (used to colour feedback)? */
export function isCorrectKey(required: Note[], midi: number): boolean {
  return required.some((n) => n.midi === midi);
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — how far from the beat still counts?
 *
 *  Rhythm and Perform modes keep time. A press within `windowSec` of an expected
 *  onset is matched to it (the nearest one when several are open); anything
 *  further is a wrong note. Of the matched presses, those within `goodSec` count
 *  as on time. Both are in seconds, so they widen in beats at slow tempos.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const TIMING = {
  windowSec: 0.35,
  goodSec: 0.15,
};

/** A learner onset that Rhythm/Perform mode is currently listening for. */
export interface OpenStep {
  beat: number;
  notes: Note[];
  matched: Map<Note, number>;   // note → offset in beats (positive = late)
  wrong: number;
}

export type MatchOutcome =
  | { kind: 'hit'; step: OpenStep; note: Note; offsetBeats: number }
  | { kind: 'wrong'; step: OpenStep | null };

/**
 * Attribute one key press to the open steps. A hit is the nearest open step that
 * still expects this pitch within `windowBeats` of `position`; otherwise the press
 * is wrong and charged to the nearest open step, if any.
 */
export function matchPress(open: OpenStep[], midi: number, position: number, windowBeats: number): MatchOutcome {
  let best: { step: OpenStep; note: Note; offset: number } | null = null;
  let nearest: OpenStep | null = null;
  for (const step of open) {
    const offset = position - step.beat;
    if (!nearest || Math.abs(offset) < Math.abs(position - nearest.beat)) nearest = step;
    if (Math.abs(offset) > windowBeats) continue;
    const note = step.notes.find((n) => n.midi === midi && !step.matched.has(n));
    if (note && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { step, note, offset };
  }
  if (best) return { kind: 'hit', step: best.step, note: best.note, offsetBeats: best.offset };
  return { kind: 'wrong', step: nearest };
}
