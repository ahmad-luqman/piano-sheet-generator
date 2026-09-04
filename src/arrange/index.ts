import type { Arrangement, ChordQuality, Song } from '../types';
import { chordName, detectChords, voiceChord, type ChordVocabulary } from './chords';
import { suggestFingers } from './fingers';
import { buildLevels } from './levels';
import { extractMelody, pickMelodyTrack } from './melody';
import { detectSections } from './sections';
import { detectKey } from './theory';
import { suggestStartLevel } from './suggest';
import { pianoParts, type SectionPattern } from './levels';
import { easeHardSections, markNewNotes } from './ladder';
import { applyConstraints, isDefault, type ConstraintReport, type HandConstraints } from './constraints';

export interface ArrangeOptions {
  melodyTrack?: number;      // override the automatic choice
  transposeEarly?: boolean;  // stages 1–3 in the key with the fewest black keys (default true)
  easeHardSections?: boolean; // show much harder sections one stage lower (default true)
  sectionPatterns?: SectionPattern[]; // stage 5 left-hand texture per section
  constraints?: HandConstraints; // keyboard size and hand span; default 88 keys, an octave
  /** Chords to use as given (a chord chart), instead of detecting them. */
  chords?: { startBeat: number; durationBeats: number; root: number; quality: ChordQuality }[];
  /** Restrict detection to these chords (a chart's vocabulary) when the notes are noisy. */
  chordVocabulary?: ChordVocabulary;
}

export function buildArrangement(song: Song, opts: ArrangeOptions = {}): Arrangement {
  const key = detectKey(song.notes);
  const melodyTrack = opts.melodyTrack ?? pickMelodyTrack(song);
  const melody = extractMelody(song, melodyTrack);
  const chords = opts.chords?.length
    ? opts.chords.map((c) => ({ ...c, name: chordName(c.root, c.quality, key), pitches: voiceChord(c.root, c.quality), confidence: 1 }))
    : detectChords(song.notes, song.beatsPerBar, song.totalBeats, key, opts.chordVocabulary);
  const levels = buildLevels(song, melody, chords, key, melodyTrack, { transposeEarly: opts.transposeEarly, sectionPatterns: opts.sectionPatterns });
  const totalBars = Math.max(1, Math.ceil(song.totalBeats / song.beatsPerBar));
  const sections = detectSections(levels[1].notes, totalBars, song.beatsPerBar);
  if (opts.easeHardSections !== false) easeHardSections(levels, sections, song.beatsPerBar, song.bpm);
  let constraintReport: ConstraintReport | undefined;
  if (opts.constraints && !isDefault(opts.constraints)) {
    constraintReport = { moved: 0, folded: 0, revoiced: 0, dropped: 0 };
    for (const id of [1, 2, 3, 4, 5, 6] as const) {
      const r = applyConstraints(levels[id], opts.constraints);
      for (const k of ['moved', 'folded', 'revoiced', 'dropped'] as const) constraintReport[k] += r[k];
    }
  }
  markNewNotes(levels);
  for (const id of [1, 2, 3, 4, 5] as const) suggestFingers(levels[id].notes);
  const suggestedLevel = suggestStartLevel(levels, song.bpm);
  return {
    title: song.title, key, bpm: song.bpm, timeSig: song.timeSig, beatsPerBar: song.beatsPerBar,
    totalBars, chords, levels, sections, melodyTrack, partnerTrack: pianoParts(song, melodyTrack).partnerTrack,
    tracks: song.tracks, suggestedLevel, constraintReport,
  };
}

export * from './theory';
export * from './chords';
export * from './melody';
export * from './levels';
export * from './sections';
export * from './fingers';
export * from './patterns';
export * from './transpose';
export * from './suggest';
export * from './ladder';
export * from './difficulty';
export * from './constraints';
export * from './motifs';
