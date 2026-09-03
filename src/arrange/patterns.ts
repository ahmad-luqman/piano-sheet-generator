import type { Chord, LhPattern, RawNote } from '../types';
import { chordIntervals, voiceChord } from './chords';

export const LH_PATTERNS: readonly LhPattern[] = ['bass', 'fifths', 'block', 'broken', 'alberti', 'waltz'];

export const PATTERN_META: Record<LhPattern, { name: string; description: string }> = {
  bass: { name: 'Bass note', description: 'One root note held for each chord.' },
  fifths: { name: 'Root and fifth', description: 'Two notes, root and fifth, held together.' },
  block: { name: 'Block chords', description: 'The whole triad struck together on each chord change.' },
  broken: { name: 'Broken chord', description: 'Root, third, fifth, octave, one note at a time.' },
  alberti: { name: 'Alberti bass', description: 'Low, high, middle, high: the classical rocking pattern.' },
  waltz: { name: 'Waltz bass', description: 'Root on the downbeat, chord on the other beats.' },
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — which moving pattern does stage 5 use by default?
 *
 *  Triple meters get a waltz bass. Compound meters (6/8) get a broken chord that
 *  rolls through the six eighths. Common time gets Alberti when the tempo is
 *  moderate and a plain broken chord when it is fast, because Alberti at speed is
 *  the hardest of the three. The LLM "accompaniment taste" call can override this
 *  per section, but it only ever picks from LH_PATTERNS.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function defaultPattern(timeSig: { num: number; den: number }, bpm: number): LhPattern {
  if (timeSig.num === 3) return 'waltz';
  if (timeSig.num === 6 || timeSig.num === 9 || timeSig.num === 12) return 'broken';
  return bpm <= 120 ? 'alberti' : 'broken';
}

interface Window { start: number; end: number }

/** Generate left-hand notes for one pattern over the chords, optionally clipped to a window. */
export function lhNotes(pattern: LhPattern, chords: Chord[], beatsPerBar: number, low = 48, window?: Window): RawNote[] {
  const clipped = window ? clipChords(chords, window) : chords;
  switch (pattern) {
    case 'bass': return bassLine(clipped);
    case 'fifths': return fifths(clipped, beatsPerBar, low);
    case 'block': return blockChords(clipped, beatsPerBar, low);
    case 'broken': return brokenChords(clipped, beatsPerBar, low);
    case 'alberti': return alberti(clipped, low);
    case 'waltz': return waltz(clipped, beatsPerBar, low);
  }
}

/** Per-section patterns: each entry covers [startBeat, endBeat) and chords are clipped to it. */
export function lhNotesBySection(plan: { start: number; end: number; pattern: LhPattern }[], chords: Chord[], beatsPerBar: number, low = 48): RawNote[] {
  return plan.flatMap((p) => lhNotes(p.pattern, chords, beatsPerBar, low, { start: p.start, end: p.end }));
}

function clipChords(chords: Chord[], w: Window): Chord[] {
  const out: Chord[] = [];
  for (const c of chords) {
    const s = Math.max(c.startBeat, w.start), e = Math.min(c.startBeat + c.durationBeats, w.end);
    if (e - s > 1e-6) out.push({ ...c, startBeat: s, durationBeats: e - s });
  }
  return out;
}

const note = (midi: number, startBeat: number, durationBeats: number, velocity = 0.6): RawNote =>
  ({ midi, startBeat, durationBeats, velocity, track: -1 });

/** Stage 2: one root note per chord, held for the chord's duration. */
export function bassLine(chords: Chord[], low = 41): RawNote[] {
  return chords.map((c) => note(voiceChord(c.root, c.quality, low, 1)[0], c.startBeat, c.durationBeats, 0.7));
}

/** Hit grid shared by the held patterns: every half bar in 4/4, every bar otherwise. */
function hits(c: Chord, beatsPerBar: number): { t: number; dur: number }[] {
  const every = beatsPerBar >= 4 ? beatsPerBar / 2 : beatsPerBar;
  const out: { t: number; dur: number }[] = [];
  for (let t = c.startBeat; t < c.startBeat + c.durationBeats - 1e-6; t += every) {
    out.push({ t, dur: Math.min(every, c.startBeat + c.durationBeats - t) });
  }
  return out;
}

/** Stage 3: root and fifth held together. */
export function fifths(chords: Chord[], beatsPerBar: number, low = 48): RawNote[] {
  const out: RawNote[] = [];
  for (const c of chords) {
    const root = voiceChord(c.root, c.quality, low, 1)[0];
    const fifth = root + (chordIntervals(c.quality)[2] ?? 7);
    for (const h of hits(c, beatsPerBar)) out.push(note(root, h.t, h.dur * 0.95), note(fifth, h.t, h.dur * 0.95));
  }
  return out;
}

/** Stage 4: root-position triads on each hit. */
export function blockChords(chords: Chord[], beatsPerBar: number, low = 48): RawNote[] {
  const out: RawNote[] = [];
  for (const c of chords) {
    const pitches = voiceChord(c.root, c.quality, low, 3);
    for (const h of hits(c, beatsPerBar)) for (const p of pitches) out.push(note(p, h.t, h.dur * 0.95));
  }
  return out;
}

/** Walk a cycle of chord tones at a fixed step across the chord's span. */
function cycle(chords: Chord[], low: number, step: number, order: number[]): RawNote[] {
  const out: RawNote[] = [];
  for (const c of chords) {
    const tri = voiceChord(c.root, c.quality, low, 3);
    const tones = [tri[0], tri[1], tri[2], tri[0] + 12];
    const end = c.startBeat + c.durationBeats;
    let i = 0;
    for (let t = c.startBeat; t < end - 1e-6; t += step, i++) {
      out.push(note(tones[order[i % order.length]], t, Math.min(step, end - t) * 0.9));
    }
  }
  return out;
}

/** Stage 5 option: root, third, fifth, octave, in quarters (4/4) or eighths (shorter bars). */
export function brokenChords(chords: Chord[], beatsPerBar: number, low = 48): RawNote[] {
  const step = beatsPerBar >= 4 ? 1 : 0.5;
  return cycle(chords, low, step, beatsPerBar >= 4 ? [0, 1, 2, 3] : [0, 1, 2, 3, 2, 1]);
}

/** Stage 5 option: Alberti bass in eighths, low-high-middle-high. */
export function alberti(chords: Chord[], low = 48): RawNote[] {
  return cycle(chords, low, 0.5, [0, 2, 1, 2]);
}

/** Stage 5 option: root on the downbeat, upper two chord tones on each remaining beat. */
export function waltz(chords: Chord[], beatsPerBar: number, low = 48): RawNote[] {
  const out: RawNote[] = [];
  const unit = beatsPerBar >= 3 ? 1 : 0.5;
  for (const c of chords) {
    const tri = voiceChord(c.root, c.quality, low, 3);
    const end = c.startBeat + c.durationBeats;
    for (let bar = c.startBeat; bar < end - 1e-6; bar += beatsPerBar) {
      const barEnd = Math.min(end, bar + beatsPerBar);
      out.push(note(tri[0], bar, Math.min(unit, barEnd - bar) * 0.9, 0.7));
      for (let t = bar + unit; t < barEnd - 1e-6; t += unit) {
        out.push(note(tri[1], t, Math.min(unit, barEnd - t) * 0.8), note(tri[2], t, Math.min(unit, barEnd - t) * 0.8));
      }
    }
  }
  return out;
}
