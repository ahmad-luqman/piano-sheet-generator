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
}

export type LevelId = 1 | 2 | 3 | 4;

export interface Level {
  id: LevelId;
  name: string;
  description: string;
  notes: Note[];                 // both hands, sorted by startBeat
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
  tracks: TrackInfo[];
}

export const LEVEL_META: Record<LevelId, { name: string; description: string }> = {
  1: { name: 'Melody', description: 'Right hand only. One note at a time, simplified rhythm.' },
  2: { name: 'Melody + Bass', description: 'Right hand melody with one left-hand bass note per chord.' },
  3: { name: 'Melody + Chords', description: 'Right hand melody with left-hand block chords.' },
  4: { name: 'Original', description: 'The arrangement exactly as written in the file.' },
};
