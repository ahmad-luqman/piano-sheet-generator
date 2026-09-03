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

/** Assign hands to the original notes: by track name if possible, else split at middle C. */
export function assignHandsOriginal(song: Song, melodyTrack: number): { rh: RawNote[]; lh: RawNote[] } {
  const named = song.tracks.filter((t) => /left|lh|bass/i.test(t.name)).map((t) => t.index);
  const namedRight = song.tracks.filter((t) => /right|rh|melod|lead/i.test(t.name)).map((t) => t.index);
  if (named.length && song.tracks.length >= 2) {
    return {
      lh: song.notes.filter((n) => named.includes(n.track)),
      rh: song.notes.filter((n) => !named.includes(n.track)),
    };
  }
  if (namedRight.length && song.tracks.length >= 2) {
    return {
      rh: song.notes.filter((n) => namedRight.includes(n.track)),
      lh: song.notes.filter((n) => !namedRight.includes(n.track)),
    };
  }
  if (song.tracks.length === 2) {
    const [a, b] = song.tracks;
    const lower = a.meanPitch < b.meanPitch ? a.index : b.index;
    return { lh: song.notes.filter((n) => n.track === lower), rh: song.notes.filter((n) => n.track !== lower) };
  }
  void melodyTrack;
  return { rh: song.notes.filter((n) => n.midi >= 60), lh: song.notes.filter((n) => n.midi < 60) };
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
  const orig = assignHandsOriginal(song, melodyTrack);
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
