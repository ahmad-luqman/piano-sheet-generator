import { describe, expect, it } from 'vitest';
import { matchPress, TIMING, type OpenStep } from '../src/practice/match';
import type { Note } from '../src/types';

const note = (midi: number, startBeat: number, hand: 'rh' | 'lh' = 'rh'): Note =>
  ({ midi, startBeat, durationBeats: 1, hand, letter: 'C', octave: 4, velocity: 0.8 });
const step = (beat: number, ...midis: number[]): OpenStep => ({ beat, notes: midis.map((m) => note(m, beat)), matched: new Map(), wrong: 0 });

describe('matchPress', () => {
  it('hits the open step that expects the key and reports the offset', () => {
    const s = step(4, 60);
    const out = matchPress([s], 60, 4.2, 0.5);
    expect(out.kind).toBe('hit');
    if (out.kind === 'hit') { expect(out.step).toBe(s); expect(out.offsetBeats).toBeCloseTo(0.2); }
  });
  it('prefers the nearest of two steps expecting the same pitch', () => {
    const a = step(4, 60), b = step(5, 60);
    const out = matchPress([a, b], 60, 4.8, 0.5);
    expect(out.kind === 'hit' && out.step).toBe(b);
  });
  it('does not match a note already matched, so a repeated key goes to the next step', () => {
    const a = step(4, 60), b = step(4.5, 60);
    a.matched.set(a.notes[0], 0);
    const out = matchPress([a, b], 60, 4.1, 0.5);
    expect(out.kind === 'hit' && out.step).toBe(b);
  });
  it('charges a wrong key to the nearest open step, or to nobody', () => {
    const a = step(4, 60), b = step(5, 62);
    const out = matchPress([a, b], 65, 4.9, 0.5);
    expect(out.kind === 'wrong' && out.step).toBe(b);
    expect(matchPress([], 65, 4.9, 0.5)).toEqual({ kind: 'wrong', step: null });
  });
  it('treats a press outside the window as wrong even for the right pitch', () => {
    const out = matchPress([step(4, 60)], 60, 4.8, 0.5);
    expect(out.kind).toBe('wrong');
  });
  it('matches chord notes one at a time', () => {
    const s = step(4, 60, 64, 67);
    for (const m of [64, 60]) { const out = matchPress([s], m, 4, 0.5); expect(out.kind).toBe('hit'); if (out.kind === 'hit') s.matched.set(out.note, out.offsetBeats); }
    expect(s.matched.size).toBe(2);
    expect(TIMING.goodSec).toBeLessThan(TIMING.windowSec);
  });
});
