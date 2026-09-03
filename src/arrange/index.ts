import type { Arrangement, Song } from '../types';
import { detectChords } from './chords';
import { suggestFingers } from './fingers';
import { buildLevels } from './levels';
import { extractMelody, pickMelodyTrack } from './melody';
import { detectSections } from './sections';
import { detectKey } from './theory';
import { suggestStartLevel } from './suggest';
import { pianoParts } from './levels';
import { easeHardSections, markNewNotes } from './ladder';

export interface ArrangeOptions {
  melodyTrack?: number;      // override the automatic choice
  transposeEarly?: boolean;  // stages 1–3 in the key with the fewest black keys (default true)
  easeHardSections?: boolean; // show much harder sections one stage lower (default true)
}

export function buildArrangement(song: Song, opts: ArrangeOptions = {}): Arrangement {
  const key = detectKey(song.notes);
  const melodyTrack = opts.melodyTrack ?? pickMelodyTrack(song);
  const melody = extractMelody(song, melodyTrack);
  const chords = detectChords(song.notes, song.beatsPerBar, song.totalBeats, key);
  const levels = buildLevels(song, melody, chords, key, melodyTrack, { transposeEarly: opts.transposeEarly });
  const totalBars = Math.max(1, Math.ceil(song.totalBeats / song.beatsPerBar));
  const sections = detectSections(levels[1].notes, totalBars, song.beatsPerBar);
  if (opts.easeHardSections !== false) easeHardSections(levels, sections, song.beatsPerBar, song.bpm);
  markNewNotes(levels);
  for (const id of [1, 2, 3, 4, 5] as const) suggestFingers(levels[id].notes);
  const suggestedLevel = suggestStartLevel(levels, song.bpm);
  return {
    title: song.title, key, bpm: song.bpm, timeSig: song.timeSig, beatsPerBar: song.beatsPerBar,
    totalBars, chords, levels, sections, melodyTrack, partnerTrack: pianoParts(song, melodyTrack).partnerTrack,
    tracks: song.tracks, suggestedLevel,
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
