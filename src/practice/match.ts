import type { Note } from '../types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  YOUR DECISION POINT #2 — when has the learner "played" a step?
 *
 *  Practice mode pauses at each onset until this returns true. `required` are the
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
