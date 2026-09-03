/** Core data model shared by the whole app. All times are in quarter-note beats. */

export type Hand = 'rh' | 'lh';

export interface RawNote {
  midi: number;          // 0..127
  startBeat: number;
  durationBeats: number;
  velocity: number;      // 0..1
  track: number;
}

export interface Song {
  title: string;
  source: string;                // "bitmidi", "catalog", "upload", "url"
  ppq: number;
  bpm: number;                   // base tempo used for playback
  timeSig: { num: number; den: number };
  beatsPerBar: number;           // in quarter notes
  tracks: TrackInfo[];
  notes: RawNote[];              // all non-percussion notes
  totalBeats: number;
}

export interface TrackInfo {
  index: number;
  name: string;
  noteCount: number;
  meanPitch: number;
  polyphony: number;             // 0 = monophonic, 1 = always chords
  coverage: number;              // fraction of the song where this track sounds
  isMelodyCandidate: boolean;
}

export interface KeyInfo {
  tonic: number;                 // pitch class 0..11
  mode: 'major' | 'minor';
  name: string;                  // "G major"
  useFlats: boolean;
  sharps: number;                // -7..7, negative = flats
}

export interface Chord {
  startBeat: number;
  durationBeats: number;
  root: number;                  // pitch class
  quality: ChordQuality;
  name: string;                  // "Am", "G7"
  pitches: number[];             // midi notes voiced in LH range
  confidence: number;            // 0..1
}

export type ChordQuality = 'maj' | 'min' | 'dim' | 'aug' | '7' | 'maj7' | 'min7';

export interface Note {
  midi: number;
  startBeat: number;
  durationBeats: number;
  hand: Hand;
  finger?: number;               // 1..5 suggestion
  letter: string;                // "C", "F#", "Bb" — spelled for the key
  octave: number;                // scientific pitch octave (C4 = middle C)
  velocity: number;
  isNew?: boolean;               // not present one stage lower ("what changed")
}

/** Six stages: one new left-hand skill per step, so no stage is a cliff. */
export type LevelId = 1 | 2 | 3 | 4 | 5 | 6;

/** Left-hand accompaniment textures, easiest first. `bass` and `block` are stages 2 and 4; the rest are stage 5 choices. */
export type LhPattern = 'bass' | 'fifths' | 'block' | 'broken' | 'alberti' | 'waltz';

export interface EasedSection {
  section: number;               // index into Arrangement.sections
  fromLevel: LevelId;            // the stage whose notes were used instead
}

export interface Level {
  id: LevelId;
  name: string;
  description: string;
  notes: Note[];                 // both hands, sorted by startBeat
  key: KeyInfo;                  // the key these notes are in (may differ from the piece when transposed)
  chords: Chord[];               // chords in this level's key
  transpose: number;             // semitones added to the original pitches (0 = original key)
  lhPattern?: LhPattern;         // accompaniment texture of the left hand, when generated
  eased?: EasedSection[];        // sections rendered one stage lower because they were much harder
}

export interface Section {
  index: number;
  startBar: number;              // 0-based inclusive
  endBar: number;                // 0-based inclusive
  label: string;                 // "A", "B", "A'" etc.
  repeatOf?: number;             // section index this one repeats
}

export interface Arrangement {
  title: string;
  key: KeyInfo;
  bpm: number;
  timeSig: { num: number; den: number };
  beatsPerBar: number;
  totalBars: number;
  chords: Chord[];
  levels: Record<LevelId, Level>;
  sections: Section[];
  melodyTrack: number;
  partnerTrack?: number;         // the track paired with the melody as the original left hand
  tracks: TrackInfo[];
  suggestedLevel?: { level: LevelId; reason: string };
}

export const LEVEL_META: Record<LevelId, { name: string; description: string }> = {
  1: { name: 'Melody', description: 'Right hand only. One note at a time, simplified rhythm.' },
  2: { name: '+ Bass', description: 'Melody with one left-hand bass note per chord.' },
  3: { name: '+ Fifths', description: 'Melody with a two-note root-and-fifth in the left hand.' },
  4: { name: '+ Chords', description: 'Full melody rhythm with left-hand block chords.' },
  5: { name: '+ Pattern', description: 'Full melody with a moving left hand: broken chord, Alberti or waltz bass by meter.' },
  6: { name: 'Original', description: 'The melody track and its piano partner exactly as written in the file.' },
};
