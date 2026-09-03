import type { Chord, KeyInfo, Level, LevelId, LhPattern, Note, RawNote, Song } from '../types';
import { LEVEL_META } from '../types';
import { chordAt } from './chords';
import { bassLine, blockChords, defaultPattern, fifths, lhNotes, lhNotesBySection } from './patterns';
import { quantize, round3, spell } from './theory';
import { easyTransposition, transposeChords, transposeNotes } from './transpose';

function toNote(n: RawNote, hand: Note['hand'], key: KeyInfo): Note {
  const { letter, octave } = spell(n.midi, key);
  return {
    midi: n.midi, startBeat: round3(n.startBeat), durationBeats: round3(n.durationBeats),
    hand, letter, octave, velocity: n.velocity,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 60;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  YOUR DECISION POINT #1 — what does "beginner-friendly melody" mean?
 *
 *  This function turns the raw melody (already reduced to one voice) into the
 *  Level 1 melody. The default below:
 *    • drops ornaments (notes followed almost immediately by the next note),
 *    • snaps starts and lengths to an eighth-note grid, or a sixteenth grid when
 *      the tune itself moves in sixteenths,
 *    • folds notes more than a 10th above/below the median down/up an octave,
 *      so the hand rarely has to jump.
 *
 *  Alternatives worth considering: keep the rhythm exact but only fold the
 *  range; drop repeated fast notes (e.g. tremolo) into one long note; keep only
 *  notes on strong beats for very dense passages. Change the rules here and the
 *  whole app (sheet, falling notes, steps) follows.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function simplifyMelodyForBeginner(melody: RawNote[], grid = 0.5): RawNote[] {
  if (melody.length === 0) return [];
  const sorted = [...melody].sort((a, b) => a.startBeat - b.startBeat);
  // Adapt the grid to how the tune actually moves: a piece built from sixteenths
  // (Für Elise) keeps a sixteenth grid, otherwise fast notes would collapse.
  const iois = sorted.slice(1).map((n, i) => n.startBeat - sorted[i].startBeat).filter((d) => d > 0.02);
  const typicalIoi = median(iois.length ? iois : [grid]);
  const g = Math.max(0.25, Math.min(grid, quantize(typicalIoi, 0.25) || grid));
  // Ornaments: notes followed almost immediately by another note (grace notes, trills faster than the grid).
  const kept = sorted.filter((n, i) => {
    const next = sorted[i + 1];
    return !next || next.startBeat - n.startBeat >= g * 0.6;
  });
  const center = median(kept.map((n) => n.midi));
  const out: RawNote[] = [];
  for (const n of kept) {
    let midi = n.midi;
    while (midi - center > 16) midi -= 12;
    while (center - midi > 16) midi += 12;
    const start = quantize(n.startBeat, g);
    const dur = Math.max(g, quantize(n.durationBeats, g));
    const last = out[out.length - 1];
    if (last && last.startBeat === start) {
      // two notes collapsed onto the same grid slot: keep the higher one
      if (midi > last.midi) out[out.length - 1] = { ...n, midi, startBeat: start, durationBeats: dur };
      continue;
    }
    if (last && last.startBeat + last.durationBeats > start) last.durationBeats = start - last.startBeat;
    out.push({ ...n, midi, startBeat: start, durationBeats: dur });
  }
  return out.filter((n) => n.durationBeats > 0);
}

/**
 * Stage 6, "original piano parts": the melody track in the right hand and one partner
 * track in the left. On a two-track piano file that is simply the two tracks. On a band
 * MIDI the partner is the most piano-like accompaniment (polyphonic, well covered, below
 * the melody, or named as such), never every remaining track, so drums, strings and
 * guitars stay out of the learner's left hand.
 */
export function pianoParts(song: Song, melodyTrack: number): { rh: RawNote[]; lh: RawNote[]; partnerTrack?: number } {
  const tracks = song.tracks;
  const byTrack = (idx: number[]) => song.notes.filter((n) => idx.includes(n.track));
  if (tracks.length <= 1) return { rh: song.notes.filter((n) => n.midi >= 60), lh: song.notes.filter((n) => n.midi < 60) };
  const namedLeft = tracks.filter((t) => /\b(left|lh|l\.h)\b/i.test(t.name) || /bass/i.test(t.name) && tracks.length === 2).map((t) => t.index);
  const namedRight = tracks.filter((t) => /\b(right|rh|r\.h)\b/i.test(t.name) || /melod|lead/i.test(t.name)).map((t) => t.index);
  if (tracks.length === 2) {
    const [a, b] = tracks;
    let lower = a.meanPitch < b.meanPitch ? a.index : b.index;
    if (namedLeft.length) lower = namedLeft[0];
    else if (namedRight.length) lower = namedRight[0] === a.index ? b.index : a.index;
    return { rh: byTrack([lower === a.index ? b.index : a.index]), lh: byTrack([lower]), partnerTrack: lower };
  }
  const mel = tracks.find((t) => t.index === melodyTrack) ?? tracks[0];
  let partner = namedLeft.find((i) => i !== melodyTrack);
  if (partner === undefined) {
    const scored = tracks
      .filter((t) => t.index !== melodyTrack && t.noteCount >= 8 && t.coverage >= 0.2)
      .map((t) => ({
        t,
        score: 0.35 * t.polyphony + 0.3 * t.coverage + (t.meanPitch < mel.meanPitch ? 0.25 : 0)
          + (/piano|keys|keyboard|accomp|chord|harmony|organ|e\.?piano|rhodes/i.test(t.name) ? 0.3 : 0)
          + (/string|pad|guitar|brass|sax|flute|vocal|voice|choir|synth lead/i.test(t.name) ? -0.3 : 0)
          + (/\bbass\b/i.test(t.name) ? -0.1 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    partner = scored[0]?.t.index;
  }
  return { rh: byTrack([melodyTrack]), lh: partner === undefined ? [] : byTrack([partner]), partnerTrack: partner };
}

/** @deprecated use pianoParts */
export function assignHandsOriginal(song: Song, melodyTrack: number): { rh: RawNote[]; lh: RawNote[] } {
  return pianoParts(song, melodyTrack);
}

export interface SectionPattern { start: number; end: number; pattern: LhPattern }

export interface LevelOptions {
  /** Stage 5 left-hand texture per section; defaults to `defaultPattern` for the whole piece. */
  sectionPatterns?: SectionPattern[];
  /** Move stages 1–3 to the key with the fewest black keys. Default true. */
  transposeEarly?: boolean;
}

/**
 * The ladder. Stages 1–3 share the simplified melody; 4–5 use the full melody rhythm.
 * Each stage adds exactly one left-hand skill over the stage below it.
 */
export function buildLevels(
  song: Song, melody: RawNote[], chords: Chord[], key: KeyInfo, melodyTrack: number, opts: LevelOptions = {},
): Record<LevelId, Level> {
  const easyMelody = simplifyMelodyForBeginner(melody, 0.5);
  const fullMelody = simplifyMelodyForBeginner(melody, 0.25);
  const bpb = song.beatsPerBar;
  const mk = (id: LevelId, rh: RawNote[], lh: RawNote[], lhPattern?: LhPattern, k = key, ch = chords, transpose = 0): Level => ({
    id, ...LEVEL_META[id], key: k, chords: ch, transpose, lhPattern,
    notes: [...rh.map((n) => toNote(n, 'rh', k)), ...lh.map((n) => toNote(n, 'lh', k))]
      .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi),
  });
  // Early stages in an easy key: judged on the notes the learner will actually play at stage 2.
  const easy = opts.transposeEarly === false
    ? { semitones: 0, key }
    : easyTransposition([...easyMelody, ...bassLine(chords)], key);
  const eKey = easy.key;
  const eChords = transposeChords(chords, easy.semitones, eKey);
  const eMelody = transposeNotes(easyMelody, easy.semitones);
  const early = (id: LevelId, lh: RawNote[], p?: LhPattern) => mk(id, eMelody, lh, p, eKey, eChords, easy.semitones);
  const pattern = defaultPattern(song.timeSig, song.bpm);
  const stage5 = opts.sectionPatterns?.length
    ? lhNotesBySection(opts.sectionPatterns, chords, bpb)
    : lhNotes(pattern, chords, bpb);
  const orig = pianoParts(song, melodyTrack);
  return {
    1: early(1, []),
    2: early(2, bassLine(eChords), 'bass'),
    3: early(3, fifths(eChords, bpb), 'fifths'),
    4: mk(4, fullMelody, blockChords(chords, bpb), 'block'),
    5: mk(5, fullMelody, stage5, opts.sectionPatterns?.length ? undefined : pattern),
    6: mk(6, orig.rh, orig.lh),
  };
}

export { chordAt, bassLine, blockChords };
