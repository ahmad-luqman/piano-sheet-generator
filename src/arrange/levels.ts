import type { Chord, KeyInfo, Level, LevelId, Note, RawNote, Song } from '../types';
import { LEVEL_META } from '../types';
import { chordAt, voiceChord } from './chords';
import { quantize, round3, spell } from './theory';

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

/** Level 2 left hand: one root note per chord, held for the chord's duration. */
export function bassLine(chords: Chord[], low = 41): RawNote[] {
  return chords.map((c) => ({
    midi: voiceChord(c.root, c.quality, low, 1)[0],
    startBeat: c.startBeat, durationBeats: c.durationBeats, velocity: 0.7, track: -1,
  }));
}

/** Level 3 left hand: root-position triads on each chord change, plus a repeat on beat 3 in 4/4 (or the downbeat of every bar the chord spans). */
export function blockChords(chords: Chord[], beatsPerBar: number, low = 48): RawNote[] {
  const out: RawNote[] = [];
  const hitEvery = beatsPerBar >= 4 ? beatsPerBar / 2 : beatsPerBar;
  for (const c of chords) {
    const pitches = voiceChord(c.root, c.quality, low, 3);
    for (let t = c.startBeat; t < c.startBeat + c.durationBeats - 1e-6; t += hitEvery) {
      // Align to the hit grid (chord changes at a half bar still get a hit at the next grid point).
      const dur = Math.min(hitEvery, c.startBeat + c.durationBeats - t);
      for (const p of pitches) out.push({ midi: p, startBeat: t, durationBeats: dur * 0.95, velocity: 0.6, track: -1 });
    }
  }
  return out;
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

export function buildLevels(
  song: Song, melody: RawNote[], chords: Chord[], key: KeyInfo, melodyTrack: number,
): Record<LevelId, Level> {
  const l1Melody = simplifyMelodyForBeginner(melody, 0.5);
  const l3Melody = simplifyMelodyForBeginner(melody, 0.25);
  const mk = (id: LevelId, rh: RawNote[], lh: RawNote[]): Level => ({
    id, ...LEVEL_META[id],
    notes: [...rh.map((n) => toNote(n, 'rh', key)), ...lh.map((n) => toNote(n, 'lh', key))]
      .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi),
  });
  const orig = assignHandsOriginal(song, melodyTrack);
  return {
    1: mk(1, l1Melody, []),
    2: mk(2, l1Melody, bassLine(chords)),
    3: mk(3, l3Melody, blockChords(chords, song.beatsPerBar)),
    4: mk(4, orig.rh, orig.lh),
  };
}

export { chordAt };
